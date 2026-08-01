import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const TRENDING_CATEGORIES = [
  'Music',
  'Technology',
  'AI',
  'Creator Economy',
  'Media',
  'Sports',
  'Digital Identity',
  'Creator Commerce',
  'Certifyd News',
];

export const TREND_PROVIDER_IDS = ['seeded', 'rss', 'manual', 'search', 'social', 'composite'];

export const CATEGORY_DEFINITIONS = {
  Music: ['music industry', 'artist revenue', 'streaming', 'royalties', 'labels', 'independent artists', 'music rights', 'music distribution', 'fan membership', 'ticketing', 'creator ownership'],
  Technology: ['open networks', 'distributed systems', 'identity', 'publishing infrastructure', 'digital commerce', 'local software', 'interoperability', 'platform dependency', 'provenance', 'authentication'],
  AI: ['local ai', 'open models', 'ai copyright', 'ai attribution', 'model ownership', 'ai agents', 'creator tools', 'synthetic media', 'training data', 'content authenticity', 'openai'],
  'Creator Economy': ['creator business', 'subscriptions', 'memberships', 'audience ownership', 'direct-to-fan', 'creator monetization', 'platform fees', 'brand partnerships', 'independent publishing', 'creator tools'],
  Media: ['digital publishing', 'independent media', 'newsletters', 'audience relationships', 'platform distribution', 'journalism technology', 'portable publishing', 'media ownership', 'content authenticity'],
  Sports: ['athlete media', 'athlete brands', 'direct fan access', 'sports streaming', 'athlete-owned content', 'sports rights', 'fan membership', 'sports publishing'],
  'Digital Identity': ['verified identity', 'portable identity', 'cryptographic identity', 'attribution', 'authorship', 'impersonation', 'digital proof', 'account portability', 'provenance'],
  'Creator Commerce': ['direct sales', 'memberships', 'digital products', 'fan support', 'subscriptions', 'payments', 'creator storefronts', 'licensing', 'customer relationships'],
  'Certifyd News': ['certifyd', 'certifyd core', 'certifyd network', 'certifyd fan', 'certifyd awards', 'creator profiles', 'network nodes', 'creator publishing', 'direct commerce'],
};

const DEFAULT_SOURCE_REGISTRY = [
  { id: 'music-business-worldwide', publisher: 'Music Business Worldwide', feedUrl: 'https://www.musicbusinessworldwide.com/feed/', categories: ['Music', 'Creator Economy'], enabled: true, priority: 90, reliability: 'Established industry publication' },
  { id: 'techcrunch', publisher: 'TechCrunch', feedUrl: 'https://techcrunch.com/feed/', categories: ['Technology', 'AI', 'Creator Economy', 'Creator Commerce'], enabled: true, priority: 70, reliability: 'Established technology publication' },
  { id: 'openai-news', publisher: 'OpenAI News', feedUrl: 'https://openai.com/news/rss.xml', categories: ['AI', 'Technology'], enabled: true, priority: 85, reliability: 'Official company newsroom' },
  { id: 'nieman-lab', publisher: 'Nieman Journalism Lab', feedUrl: 'https://www.niemanlab.org/feed/', categories: ['Media', 'Technology'], enabled: true, priority: 75, reliability: 'Established journalism and media publication' },
];

const SEEDED_OPPORTUNITIES = [
  { id: 'spotify-creator-business', category: 'Music', title: 'Compare Certifyd to Spotify', whyTrending: 'Seeded example: artists keep looking for better ways to earn beyond streaming payout models.', whyItMattersToCertifyd: 'This lets Certifyd explain the difference between renting attention and building a creator business.', suggestedAngle: 'Traditional platforms make money from attention. Certifyd makes money from creator businesses.', brainCoverage: 'Strong', topic: 'Compare Certifyd to Spotify' },
  { id: 'creator-ownership-explainer', category: 'Creator Economy', title: 'Explain creator ownership', whyTrending: 'Seeded example: creators increasingly sell memberships, releases, services and direct access.', whyItMattersToCertifyd: 'This explains why Certifyd reduces platform dependency without making absolute ownership claims.', suggestedAngle: 'Creator ownership is about running more of the creator business directly.', brainCoverage: 'Strong', topic: 'Explain what creator ownership means in Certifyd' },
  { id: 'local-ai-publishing', category: 'AI', title: 'Write about local AI', whyTrending: 'Seeded example: teams are adopting local models for private workflows and lower operating costs.', whyItMattersToCertifyd: 'This can explain internal editorial workflows without claiming automated public publishing.', suggestedAngle: 'Local AI can assist internal content work while founder review remains required.', brainCoverage: 'Partial', topic: 'Write about local AI and Certifyd editorial workflows' },
];

let activeScan = null;

const schedulerHandles = new WeakMap();

export function getTrendProvider(config, options = {}) {
  const provider = String(config.trendResearch?.provider || config.trendResearchProvider || 'composite').toLowerCase();
  if (provider === 'fixture') return new SeededTrendProvider(config, options);
  if (provider === 'seeded') return new SeededTrendProvider(config, options);
  if (provider === 'manual') return new ManualTrendProvider(config, options);
  if (provider === 'rss') return new RssTrendProvider(config, options);
  if (provider === 'composite') return new CompositeTrendProvider(config, options);
  if (provider === 'search') return new UnavailableTrendProvider('search', 'Search provider', 'Search is not connected. Configure an approved search/news API before using it.');
  if (provider === 'social') return new UnavailableTrendProvider('social', 'Social provider', 'Social trends are not connected. Use official integrations only.');
  return new SeededTrendProvider(config, options);
}

export async function getTrendingOpportunities(config, options = {}) {
  const persisted = await readTrendState(config).catch(() => null);
  const provider = getTrendProvider(config, options);
  if (persisted?.opportunities?.length) {
    return trendStateResult({ ...persisted, provider: provider.id, providerStatus: await provider.getSourceStatus().catch(() => []) });
  }
  if (provider.id === 'rss' || provider.id === 'composite') {
    return {
      provider: provider.id,
      sourceLabels: [],
      lastScannedAt: null,
      note: 'No live trend scan has been saved yet. Use Scan for trends to collect source-backed opportunities.',
      providerStatus: await provider.getSourceStatus().catch(() => []),
      summary: emptySummary(provider.id),
      items: [],
    };
  }
  return provider.scan({ readOnly: true });
}

export async function scanTrendOpportunities(config, options = {}) {
  if (activeScan) throw Object.assign(new Error('A trend scan is already running.'), { statusCode: 409 });
  activeScan = runTrendScan(config, options).finally(() => { activeScan = null; });
  return activeScan;
}

async function runTrendScan(config, options) {
  const started = Date.now();
  const provider = getTrendProvider(config, options);
  const scan = await provider.scan({ ...options, force: true });
  const previousState = await readTrendState(config).catch(() => null);
  if (shouldPreserveSourceBackedState(scan, previousState)) {
    const warning = 'Seeded scan ignored because source-backed trend results already exist. Configure CONTENT_TREND_PROVIDER=composite or rss to refresh live sources.';
    return trendStateResult({
      ...previousState,
      errors: [warning, ...(previousState.errors || []).filter((error) => error !== warning)],
    });
  }
  const state = {
    provider: scan.provider,
    lastScannedAt: new Date().toISOString(),
    summary: {
      ...scan.summary,
      scanDurationMs: Date.now() - started,
      progress: [
        'Checking sources',
        'Fetching recent stories',
        'Removing duplicates',
        'Grouping related topics',
        'Checking Certifyd Brain coverage',
        'Asking Qwen for article opportunities',
        'Saving suggestions',
      ],
    },
    sourceItems: scan.sourceItems || [],
    opportunities: scan.items || [],
    sourceStatus: scan.providerStatus || scan.sourceStatus || [],
    errors: scan.errors || [],
    dismissed: previousState?.dismissed || [],
    savedIdeas: previousState?.savedIdeas || [],
  };
  state.opportunities = state.opportunities.filter((item) => !state.dismissed.includes(item.id));
  await writeTrendState(config, state);
  return trendStateResult(state);
}

function shouldPreserveSourceBackedState(scan, previousState) {
  if (scan.provider !== 'seeded') return false;
  if (!previousState?.opportunities?.length) return false;
  if (previousState.provider && previousState.provider !== 'seeded') return true;
  return Boolean(previousState.sourceItems?.length);
}

export async function dismissTrendOpportunity(config, id) {
  const state = await readTrendState(config);
  const dismissed = [...new Set([...(state.dismissed || []), String(id)])];
  const opportunities = (state.opportunities || []).filter((item) => item.id !== id);
  await writeTrendState(config, { ...state, dismissed, opportunities });
  return { ok: true, output: 'Trend opportunity dismissed.' };
}

export async function saveTrendOpportunity(config, id, actor = {}) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) throw Object.assign(new Error('Trend opportunity ID is required.'), { statusCode: 400 });
  const state = await readTrendState(config);
  const opportunity = (state.opportunities || []).find((item) => item.id === normalizedId)
    || (state.savedIdeas || []).find((item) => item.id === normalizedId);
  if (!opportunity) throw Object.assign(new Error('Trend opportunity not found.'), { statusCode: 404 });
  const savedAt = new Date().toISOString();
  const savedBy = actor?.email || actor?.id || 'unknown';
  const savedIdea = { ...opportunity, status: 'SAVED', savedAt, savedBy };
  const savedIdeas = [
    savedIdea,
    ...(state.savedIdeas || []).filter((item) => item.id !== normalizedId),
  ];
  await writeTrendState(config, { ...state, savedIdeas });
  return { ok: true, output: 'Idea saved for review.' };
}

export async function readTrendSourceDetail(config, opportunityId) {
  const state = await readTrendState(config);
  const opportunity = (state.opportunities || []).find((item) => item.id === opportunityId);
  if (!opportunity) throw Object.assign(new Error('Trend opportunity not found.'), { statusCode: 404 });
  const sourceIds = new Set(opportunity.sourceItemIds || []);
  const sources = (state.sourceItems || []).filter((item) => sourceIds.has(item.id));
  return { opportunity, sources };
}

export function filterTrendingOpportunities(trends, category) {
  const items = Array.isArray(trends?.items) ? trends.items : [];
  if (!category || category === 'All') return items;
  return items.filter((item) => item.category === category || item.categories?.includes(category));
}

export function computeNextScanDelayMs(now = new Date(), scanHour = 7) {
  const hour = Math.min(23, Math.max(0, Number.parseInt(String(scanHour), 10) || 0));
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function startTrendDailyScheduler(config, options = {}) {
  if (!config?.trendResearch?.dailyScanEnabled) return null;
  const existing = schedulerHandles.get(config);
  if (existing) return existing;

  const logger = options.logger || console;
  let stopped = false;
  let timer = null;

  const schedule = () => {
    if (stopped) return;
    const delayMs = Number.isFinite(options.intervalMs)
      ? Math.max(1, Number(options.intervalMs))
      : computeNextScanDelayMs(new Date(), config.trendResearch.scanHour);
    timer = setTimeout(run, delayMs);
    timer.unref?.();
  };

  const run = async () => {
    if (stopped) return;
    try {
      await scanTrendOpportunities(config, { scheduled: true });
      logger.info?.('[content-dashboard] Scheduled trend scan completed.');
    } catch (error) {
      logger.warn?.(`[content-dashboard] Scheduled trend scan failed: ${error.message}`);
    } finally {
      if (options.once) stop();
      else schedule();
    }
  };

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    schedulerHandles.delete(config);
  };

  const handle = { stop };
  schedulerHandles.set(config, handle);
  logger.info?.(`[content-dashboard] Daily trend scan enabled for hour ${config.trendResearch.scanHour}.`);
  if (options.runImmediately) {
    timer = setTimeout(run, 1);
    timer.unref?.();
  } else {
    schedule();
  }
  return handle;
}

export function buildSourceRegistry(config = {}) {
  const fromEnv = (config.trendResearch?.sourceUrls || []).map((feedUrl, index) => ({
    id: `env-${hashText(feedUrl).slice(0, 10)}`,
    publisher: labelFromUrl(feedUrl),
    feedUrl,
    categories: [],
    enabled: true,
    priority: 50 - index,
    reliability: 'Environment-configured feed',
  }));
  const known = DEFAULT_SOURCE_REGISTRY.map((source) => ({ ...source }));
  const byUrl = new Map();
  for (const source of [...known, ...fromEnv]) byUrl.set(normalizeUrl(source.feedUrl), source);
  return [...byUrl.values()].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
}

class SeededTrendProvider {
  constructor(config) { this.config = config; this.id = 'seeded'; this.displayName = 'Seeded examples'; }
  isConfigured() { return true; }
  async healthCheck() { return { configured: true, available: true }; }
  async getSourceStatus() { return [{ id: 'seeded', publisher: 'Seeded examples', status: 'available', enabled: true }]; }
  async scan() {
    return seededResult('These are editorial examples, not live trend results.');
  }
}

class ManualTrendProvider {
  constructor(config) { this.config = config; this.id = 'manual'; this.displayName = 'Manual ideas'; }
  isConfigured() { return true; }
  async healthCheck() { return { configured: true, available: true }; }
  async getSourceStatus() { return [{ id: 'manual', publisher: 'Manual ideas', status: 'available', enabled: true }]; }
  async scan() { return { provider: 'manual', sourceLabels: ['Manual'], note: 'Create an idea manually or enable RSS/composite trend research.', items: [], summary: emptySummary('manual'), sourceItems: [] }; }
}

class UnavailableTrendProvider {
  constructor(id, displayName, reason) { this.id = id; this.displayName = displayName; this.reason = reason; }
  isConfigured() { return false; }
  async healthCheck() { return { configured: false, available: false, reason: this.reason }; }
  async getSourceStatus() { return [{ id: this.id, publisher: this.displayName, status: 'unavailable', enabled: false, error: this.reason }]; }
  async scan() { return { provider: this.id, sourceLabels: [], note: this.reason, items: [], summary: emptySummary(this.id), sourceItems: [], providerStatus: await this.getSourceStatus() }; }
}

class CompositeTrendProvider {
  constructor(config, options = {}) { this.config = config; this.options = options; this.id = 'composite'; this.displayName = 'Composite trend provider'; this.rss = new RssTrendProvider(config, options); }
  isConfigured() { return this.rss.isConfigured(); }
  async healthCheck() { return this.rss.healthCheck(); }
  async getSourceStatus() { return [...await this.rss.getSourceStatus(), { id: 'search', publisher: 'Search provider', status: 'future', enabled: false, error: 'Search not connected.' }, { id: 'social', publisher: 'Social provider', status: 'future', enabled: false, error: 'Social not connected.' }]; }
  async scan(options = {}) {
    const result = await this.rss.scan(options);
    return { ...result, provider: 'composite', note: result.note || 'Composite scan used configured RSS sources. Search and social providers are not connected.' };
  }
}

class RssTrendProvider {
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
    this.id = 'rss';
    this.displayName = 'RSS/Atom sources';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.registry = buildSourceRegistry(config).filter((source) => source.enabled !== false);
  }
  isConfigured() { return this.registry.length > 0; }
  async healthCheck() { return { configured: this.isConfigured(), available: this.isConfigured(), sourceCount: this.registry.length }; }
  async getSourceStatus() {
    return this.registry.map((source) => ({ id: source.id, publisher: source.publisher, feedUrl: source.feedUrl, categories: source.categories, enabled: source.enabled !== false, status: 'configured', reliability: source.reliability }));
  }
  async scan(options = {}) {
    if (!this.isConfigured()) return { provider: 'rss', sourceLabels: [], note: 'No live trend sources are configured. Add approved RSS feeds or create an idea manually.', items: [], sourceItems: [], summary: emptySummary('rss') };
    const maxAgeDays = this.config.trendResearch?.maxItemAgeDays || 7;
    const timeoutMs = this.config.trendResearch?.timeoutMs || 20000;
    const maxPerSource = this.config.trendResearch?.maxItemsPerSource || 30;
    const sources = this.registry.slice(0, 24);
    const errors = [];
    const sourceStatus = [];
    const allItems = [];
    const settled = await mapWithConcurrency(sources, this.config.trendResearch?.maxConcurrentFetches || 3, async (source) => {
      try {
        const feed = await fetchFeed(source, { fetchImpl: this.fetchImpl, timeoutMs, allowPrivate: Boolean(options.allowPrivateSources) });
        const parsed = parseFeedItems(feed.body, source, feed.finalUrl).slice(0, maxPerSource);
        sourceStatus.push({ ...sourceStatusBase(source), status: 'available', latestFetchAt: new Date().toISOString(), itemCount: parsed.length });
        allItems.push(...parsed);
      } catch (error) {
        const message = safeError(error);
        errors.push(`${source.publisher} failed: ${message}.`);
        sourceStatus.push({ ...sourceStatusBase(source), status: 'unavailable', latestError: message, latestFetchAt: new Date().toISOString() });
      }
    });
    void settled;
    const recentItems = filterRecentItems(allItems, maxAgeDays);
    const deduped = dedupeSourceItems(recentItems);
    const clusters = clusterSourceItems(deduped);
    const brainRecords = await loadApprovedBrainRecords(this.config);
    const evaluated = [];
    for (const cluster of clusters.slice(0, 30)) {
      if (!isCertifydRelevantCluster(cluster)) continue;
      const coverage = computeBrainCoverage(cluster, brainRecords);
      const qwen = await evaluateClusterWithQwen(this.config, cluster, coverage, this.options).catch(() => fallbackEvaluation(cluster, coverage));
      if (qwen.recommended === false) continue;
      evaluated.push(opportunityFromCluster(cluster, coverage, qwen));
    }
    const items = evaluated.sort((a, b) => scoreOpportunity(b) - scoreOpportunity(a)).slice(0, 18);
    return {
      provider: 'rss',
      sourceLabels: [...new Set(deduped.map((item) => item.publisher))],
      lastScannedAt: new Date().toISOString(),
      note: errors.length ? 'Trend scan completed with some unavailable sources.' : (items.length ? 'RSS sources scanned successfully.' : 'The configured sources returned no recent stories.'),
      errors,
      sourceStatus,
      providerStatus: sourceStatus,
      sourceItems: deduped,
      items,
      summary: {
        provider: 'rss',
        sourcesChecked: sources.length,
        sourceFailures: errors.length,
        storiesCollected: allItems.length,
        storiesRetained: deduped.length,
        duplicatesRemoved: Math.max(0, recentItems.length - deduped.length),
        opportunitiesCreated: items.length,
      },
    };
  }
}

function seededResult(note) {
  return {
    provider: 'seeded',
    sourceLabels: ['Seeded'],
    lastScannedAt: null,
    note,
    summary: emptySummary('seeded', SEEDED_OPPORTUNITIES.length),
    providerStatus: [{ id: 'seeded', publisher: 'Seeded examples', status: 'available', enabled: true }],
    sourceItems: [],
    items: SEEDED_OPPORTUNITIES.map((item) => ({
      ...item,
      sourceType: 'seeded',
      sourceLabel: 'Seeded example',
      evidenceLabel: 'Seeded example',
      sourceCount: 0,
      sourcePublishers: [],
      sourceItemIds: [],
      firstDetectedAt: new Date().toISOString(),
      lastDetectedAt: new Date().toISOString(),
      freshness: 'Seeded example',
      status: 'ACTIVE',
      confidence: 'Development example',
      riskFlags: ['Seeded example'],
      generatedBy: 'seeded',
    })),
  };
}

async function fetchFeed(source, { fetchImpl, timeoutMs, allowPrivate = false }) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  assertSafeFeedUrl(source.feedUrl, { allowPrivate });
  let currentUrl = source.feedUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.2',
          'User-Agent': 'CertifydBlogEngine/1.0 (+https://certifyd.me)',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location');
      if (!location) throw new Error(`Redirect without Location: HTTP ${response.status}`);
      currentUrl = new URL(location, currentUrl).toString();
      assertSafeFeedUrl(currentUrl, { allowPrivate });
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers?.get?.('content-type') || '';
    const text = await readLimitedResponse(response, 1_500_000);
    if (!looksLikeFeed(text, contentType)) throw new Error('Response did not look like RSS or Atom.');
    return { body: text, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects.');
}

async function readLimitedResponse(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Feed response exceeded size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error('Feed response exceeded size limit.');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function looksLikeFeed(text, contentType) {
  const trimmed = String(text || '').trim().slice(0, 800).toLowerCase();
  return /xml|rss|atom/.test(contentType) || trimmed.includes('<rss') || trimmed.includes('<feed') || trimmed.includes('<item') || trimmed.includes('<entry');
}

export function parseFeedItems(text, source = {}, finalUrl = '') {
  const clean = String(text || '');
  const itemBlocks = [...clean.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const entryBlocks = [...clean.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  return [...itemBlocks, ...entryBlocks].map((block) => {
    const title = sanitizeText(decodeXml(readTag(block, 'title')));
    const summary = sanitizeText(decodeXml(readTag(block, 'description') || readTag(block, 'summary') || readTag(block, 'content')));
    const articleUrl = absolutizeUrl(decodeXml(readTag(block, 'link') || readLinkHref(block)), finalUrl || source.feedUrl || '');
    const publishedAt = normalizeDate(readTag(block, 'pubDate') || readTag(block, 'published') || readTag(block, 'updated'));
    const rawFingerprint = hashText(`${source.id}:${articleUrl || title}:${publishedAt}`);
    const categories = classifyCategories(`${title} ${summary}`, source.categories || []);
    return {
      id: `src-${rawFingerprint.slice(0, 16)}`,
      provider: 'rss',
      publisher: source.publisher || labelFromUrl(source.feedUrl),
      sourceName: source.publisher || labelFromUrl(source.feedUrl),
      sourceUrl: source.feedUrl || '',
      articleUrl,
      title,
      summary: trim(summary, 500),
      publishedAt,
      retrievedAt: new Date().toISOString(),
      categories,
      keywords: extractKeywords(`${title} ${summary}`, categories),
      author: sanitizeText(decodeXml(readTag(block, 'author') || readTag(block, 'dc:creator'))),
      language: 'en',
      sourceType: 'rss',
      rawFingerprint,
    };
  }).filter((item) => item.title && item.articleUrl);
}

function readTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').trim() || '';
}

function readLinkHref(block) {
  return block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || '';
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([a-f0-9]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeText(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function filterRecentItems(items, maxAgeDays) {
  const cutoff = Date.now() - Number(maxAgeDays || 7) * 24 * 60 * 60 * 1000;
  return items.filter((item) => !item.publishedAt || Date.parse(item.publishedAt) >= cutoff);
}

export function dedupeSourceItems(items) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const key = canonicalKey(item.articleUrl) || normalizeTitle(item.title);
    const titleKey = normalizeTitle(item.title);
    if (seen.has(key) || seen.has(titleKey)) continue;
    seen.add(key);
    seen.add(titleKey);
    result.push(item);
  }
  return result;
}

export function clusterSourceItems(items) {
  const clusters = [];
  for (const item of items) {
    const match = clusters.find((cluster) => shouldCluster(cluster, item));
    if (match) {
      match.items.push(item);
      match.keywords = [...new Set([...match.keywords, ...item.keywords])];
      match.categories = [...new Set([...match.categories, ...item.categories])];
    } else {
      clusters.push({ id: `cluster-${hashText(item.title).slice(0, 12)}`, items: [item], keywords: item.keywords || [], categories: item.categories || [] });
    }
  }
  return clusters.map((cluster) => ({ ...cluster, category: primaryCategory(cluster), title: clusterTitle(cluster), summary: clusterSummary(cluster) }));
}

function shouldCluster(cluster, item) {
  const first = cluster.items[0];
  const overlap = intersection(new Set(cluster.keywords), new Set(item.keywords || [])).length;
  return titleSimilarity(first.title, item.title) > 0.7 || overlap >= 3;
}

function primaryCategory(cluster) {
  const counts = new Map();
  for (const category of cluster.categories) counts.set(category, (counts.get(category) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Technology';
}

function clusterTitle(cluster) {
  return trim(cluster.items[0]?.title || 'Untitled opportunity', 120);
}

function clusterSummary(cluster) {
  return trim(cluster.items.map((item) => item.summary || item.title).filter(Boolean).join(' '), 420);
}

function classifyCategories(text, sourceCategories = []) {
  const haystack = String(text || '').toLowerCase();
  const scores = new Map();
  for (const [category, keywords] of Object.entries(CATEGORY_DEFINITIONS)) {
    let score = sourceCategories.includes(category) ? 1 : 0;
    for (const keyword of keywords) if (haystack.includes(keyword.toLowerCase())) score += keyword.split(/\s+/).length > 1 ? 2 : 1;
    if (score > 0) scores.set(category, score);
  }
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  return sorted.length ? sorted.slice(0, 3) : ['Technology'];
}

function extractKeywords(text, categories) {
  const haystack = String(text || '').toLowerCase();
  const matches = new Set();
  for (const category of categories) {
    for (const keyword of CATEGORY_DEFINITIONS[category] || []) if (haystack.includes(keyword.toLowerCase())) matches.add(keyword.toLowerCase());
  }
  for (const word of haystack.match(/\b[a-z][a-z0-9-]{4,}\b/g) || []) {
    if (!STOPWORDS.has(word)) matches.add(word);
    if (matches.size >= 18) break;
  }
  return [...matches].slice(0, 18);
}

const STOPWORDS = new Set(['about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'would', 'could', 'should', 'through', 'because', 'company', 'announced', 'latest', 'first', 'using']);

async function loadApprovedBrainRecords(config) {
  const brainRoot = path.resolve(config.agentRoot || path.join(config.siteRoot, 'content-agent'), 'knowledge');
  const records = [];
  await walkMarkdown(brainRoot, async (file) => {
    const relative = path.relative(brainRoot, file);
    const text = await fs.readFile(file, 'utf8');
    if (!/approved|current|verified|definition|capability|product|claim|business|revenue|model|monetization|mission|vision|brand|vocabulary/i.test(text + relative)) return;
    records.push({ id: `brain:${relative.replace(/\.md$/, '').replace(/\\/g, '/')}`, path: `content-agent/knowledge/${relative.replace(/\\/g, '/')}`, title: markdownTitle(text) || path.basename(file, '.md'), excerpt: sanitizeText(text).slice(0, 800), text: sanitizeText(text) });
  });
  return records;
}

async function walkMarkdown(dir, callback) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkMarkdown(full, callback);
    else if (entry.isFile() && entry.name.endsWith('.md')) await callback(full);
  }
}

function computeBrainCoverage(cluster, brainRecords) {
  const terms = new Set([...cluster.keywords, cluster.category.toLowerCase(), ...String(cluster.title).toLowerCase().split(/\W+/).filter((word) => word.length > 4)]);
  const relevant = brainRecords.map((record) => ({ record, score: scoreBrainRecord(record, terms) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  const conflict = relevant.some(({ record }) => /prohibited|risky|ambiguous|needs founder decision/i.test(record.text));
  const level = conflict ? 'Conflict' : relevant.length >= 3 ? 'Strong' : relevant.length ? 'Partial' : 'Needs source';
  return { level, records: relevant.map(({ record }) => record), explanation: relevant.length ? `Matched ${relevant.length} approved Brain record${relevant.length === 1 ? '' : 's'}.` : 'No relevant approved Brain record was found.' };
}

function scoreBrainRecord(record, terms) {
  const text = `${record.title} ${record.path} ${record.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) if (term && text.includes(term)) score += term.includes(' ') ? 2 : 1;
  return score;
}

async function evaluateClusterWithQwen(config, cluster, coverage, options = {}) {
  if (options.evaluateWithQwen === false || !config.ollama?.enabled) return fallbackEvaluation(cluster, coverage);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fallbackEvaluation(cluster, coverage);
  const baseUrl = config.ollama.baseUrl || 'http://127.0.0.1:11434';
  const prompt = buildOpportunityPrompt(cluster, coverage);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.ollama.timeoutMs || 120000, 45000));
  try {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model || 'qwen2.5:1.5b',
        stream: false,
        think: false,
        messages: [
          { role: 'system', content: 'Evaluate supplied feed items. Do not claim you searched the web. Return only compact JSON.' },
          { role: 'user', content: prompt },
        ],
        options: { temperature: 0.2, num_predict: 320, num_ctx: Math.min(config.ollama.maxContextChars || 4096, 4096) },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json().catch(() => ({}));
    return parseQwenOpportunity(String(body?.message?.content || '')) || fallbackEvaluation(cluster, coverage);
  } finally {
    clearTimeout(timeout);
  }
}

function buildOpportunityPrompt(cluster, coverage) {
  const sources = cluster.items.slice(0, 4).map((item) => `- ${item.publisher} (${dateOnly(item.publishedAt)}): ${item.title}. ${trim(item.summary, 180)}`).join('\n');
  const brain = coverage.records.slice(0, 3).map((record) => `- ${record.id}: ${trim(record.excerpt, 180)}`).join('\n') || '- No approved Brain match.';
  return `Category: ${cluster.category}\nSources:\n${sources}\nApproved Brain excerpts:\n${brain}\nReturn JSON exactly like {"recommended":true,"suggestedTitle":"string","whyItMatters":"string","certifydAngle":"string","riskFlags":["string"]}.`;
}

function parseQwenOpportunity(content) {
  const json = extractJson(content);
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const suggestedTitle = trim(parsed.suggestedTitle, 120);
  const whyItMatters = trim(parsed.whyItMatters, 240);
  const certifydAngle = trim(parsed.certifydAngle, 240);
  const riskFlags = Array.isArray(parsed.riskFlags) ? parsed.riskFlags.map((item) => trim(item, 80)).filter(Boolean).slice(0, 5) : [];
  if (parsed.recommended === false) return { recommended: false, suggestedTitle, whyItMatters, certifydAngle, riskFlags };
  if (isUnfaithfulQwenEvaluation(`${suggestedTitle} ${whyItMatters} ${certifydAngle}`)) return null;
  return {
    recommended: true,
    suggestedTitle,
    whyItMatters,
    certifydAngle,
    riskFlags,
  };
}

function extractJson(content) {
  const clean = String(content || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end <= start) return '';
  return clean.slice(start, end + 1);
}

function fallbackEvaluation(cluster, coverage) {
  return {
    recommended: true,
    fallback: true,
    suggestedTitle: cluster.title,
    whyItMatters: certifydRelevance(cluster.category, `${cluster.title} ${cluster.summary}`),
    certifydAngle: certifydRelevance(cluster.category, `${cluster.title} ${cluster.summary}`),
    riskFlags: coverage.level === 'Needs source' ? ['Needs external source before article generation'] : [],
  };
}

function opportunityFromCluster(cluster, coverage, qwen) {
  const newest = newestDate(cluster.items);
  const publishers = [...new Set(cluster.items.map((item) => item.publisher))];
  const sourceCount = cluster.items.length;
  const evidenceLabel = sourceCount > 2 ? 'Repeated coverage' : sourceCount > 1 ? `Appearing across ${sourceCount} sources` : 'Recent source';
  const title = qwen.suggestedTitle || cluster.title;
  return {
    id: `opp-${hashText(cluster.items.map((item) => item.id).join('|')).slice(0, 14)}`,
    title: trim(title, 120),
    category: cluster.category,
    categories: cluster.categories,
    summary: trim(cluster.summary, 360),
    whyTrending: whyTrending(cluster),
    whyItMattersToCertifyd: qwen.whyItMatters || certifydRelevance(cluster.category, `${cluster.title} ${cluster.summary}`),
    whyCertifyd: qwen.whyItMatters || certifydRelevance(cluster.category, `${cluster.title} ${cluster.summary}`),
    suggestedAngle: qwen.certifydAngle || certifydRelevance(cluster.category, `${cluster.title} ${cluster.summary}`),
    sourceItemIds: cluster.items.map((item) => item.id),
    sourceCount,
    sourcePublishers: publishers,
    newestSourceDate: newest,
    firstDetectedAt: new Date().toISOString(),
    lastDetectedAt: new Date().toISOString(),
    freshness: freshnessLabel(newest),
    brainCoverage: coverage.level,
    BrainCoverage: coverage.level,
    brainRecordIds: coverage.records.map((record) => record.id),
    brainRecords: coverage.records.map((record) => ({ id: record.id, title: record.title, path: record.path })),
    confidence: sourceCount > 1 && coverage.level !== 'Needs source' ? 'Medium' : 'Low',
    status: 'ACTIVE',
    riskFlags: [...new Set(qwen.riskFlags || [])],
    generatedBy: qwen.recommended === false ? 'source-cluster' : (qwen.fallback ? 'deterministic-analysis' : (qwen.certifydAngle ? 'qwen' : 'deterministic-analysis')),
    evidenceLabel,
    topic: `Write a Certifyd article about: ${title}. Use this angle: ${qwen.certifydAngle || certifydRelevance(cluster.category, cluster.summary)}`,
    sourceType: 'rss',
    sourceLabel: publishers.join(', '),
  };
}

function whyTrending(cluster) {
  if (cluster.items.length > 2) return `Repeated coverage across ${cluster.items.length} recent source items from ${[...new Set(cluster.items.map((item) => item.publisher))].join(', ')}.`;
  if (cluster.items.length > 1) return `Appearing across ${cluster.items.length} recent source items.`;
  const item = cluster.items[0];
  return `Recent source from ${item?.publisher || 'an approved feed'}${item?.publishedAt ? ` on ${dateOnly(item.publishedAt)}` : ''}.`;
}

function isCertifydRelevantCluster(cluster) {
  const lead = cluster.items?.[0];
  const leadText = `${lead?.title || cluster.title || ''} ${lead?.summary || ''} ${(lead?.keywords || []).join(' ')}`.toLowerCase();
  const sourceText = `${cluster.title || ''} ${cluster.summary || ''} ${(cluster.keywords || []).join(' ')}`.toLowerCase();
  if (!leadText.trim() || !sourceText.trim()) return false;
  return matchesCertifydRelevance(leadText) && matchesCertifydRelevance(sourceText);
}

function matchesCertifydRelevance(text) {
  return CERTIFYD_RELEVANCE_TERMS.some((pattern) => pattern.test(text));
}

function isUnfaithfulQwenEvaluation(value) {
  const text = String(value || '').toLowerCase();
  return /\bnot applicable\b|\bunrelated\b|\bdifferent topic\b|\bnot about\b|\bnot focused on\b|\bunrelated to\b|\bevaluating feed items\b/.test(text);
}

const CERTIFYD_RELEVANCE_TERMS = [
  /\bcreator(s)?\b/,
  /\bartist(s)?\b/,
  /\bmusic\b/,
  /\brelease(s)?\b/,
  /\broyalt(y|ies)\b/,
  /\bright(s)?\b/,
  /\battribution\b/,
  /\bauthorship\b/,
  /\bprovenance\b/,
  /\bauthenticity\b/,
  /\bcopyright\b/,
  /\bpublishing\b/,
  /\bcontent authenticity\b/,
  /\bcreator content\b/,
  /\bdigital content\b/,
  /\bmedia ownership\b/,
  /\bpublic media\b/,
  /\bjournalis(m|t|ts)\b/,
  /\bnewsletter(s)?\b/,
  /\bplatform distribution\b/,
  /\bplatform dependency\b/,
  /\bcreator discovery\b/,
  /\bfan discovery\b/,
  /\bcommerce\b/,
  /\bpayment(s)?\b/,
  /\bsubscription(s)?\b/,
  /\bmembership(s)?\b/,
  /\bdirect-to-fan\b/,
  /\bfan attendance\b/,
  /\bfan relationship(s)?\b/,
  /\bfan support\b/,
  /\baudience relationship(s)?\b/,
  /\baudience ownership\b/,
  /\bcustomer relationship(s)?\b/,
  /\bidentity\b/,
  /\bprofile(s)?\b/,
  /\bownership\b/,
  /\bfraud\b/,
  /\bbot(s)?\b/,
  /\bstreaming\b/,
  /\blicens(e|ing)\b/,
];

function certifydRelevance(category, text) {
  const haystack = String(text || '').toLowerCase();
  if (/\b(bot|fake|fraud|streaming manipulation|click farm|payola)\b/.test(haystack)) return 'This gives Certifyd a direct angle on why paid customer activity is stronger than empty engagement metrics.';
  if (category === 'Music') return 'This connects to creator commerce, direct fan relationships and alternatives to attention-only music economics.';
  if (category === 'AI') return 'This connects to trusted identity, attribution and source context as discovery becomes more machine-assisted.';
  if (category === 'Creator Economy') return 'This connects to creator-controlled profiles, publishing, discovery and direct commerce.';
  if (category === 'Digital Identity') return 'This connects to portable identity, attribution and source-of-truth creator profiles.';
  if (category === 'Creator Commerce') return 'This connects to direct sales, receipts, access and customer relationships around creator businesses.';
  if (category === 'Media') return 'This connects to public attribution, source context and audience relationships.';
  return 'This connects to Certifyd as infrastructure for identity, publishing, discovery and commerce.';
}

function trendStateResult(state) {
  const savedIdeas = state.savedIdeas || [];
  const savedIds = new Set(savedIdeas.map((item) => item.id));
  return {
    provider: state.provider || 'rss',
    sourceLabels: [...new Set((state.sourceItems || []).map((item) => item.publisher))],
    lastScannedAt: state.lastScannedAt || null,
    note: state.errors?.length ? 'Trend scan completed with some unavailable sources.' : 'Source-backed opportunities from the latest saved scan.',
    summary: state.summary || emptySummary(state.provider || 'rss'),
    errors: state.errors || [],
    providerStatus: state.providerStatus || state.sourceStatus || [],
    savedIdeas,
    items: (state.opportunities || []).map((item) => savedIds.has(item.id) ? { ...item, saved: true } : item),
  };
}

function emptySummary(provider, opportunitiesCreated = 0) {
  return { provider, sourcesChecked: 0, sourceFailures: 0, storiesCollected: 0, storiesRetained: 0, duplicatesRemoved: 0, opportunitiesCreated };
}

export async function readTrendState(config) {
  const file = trendStateFile(config);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function writeTrendState(config, state) {
  const file = trendStateFile(config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function trendStateFile(config) {
  return path.join(config.agentRoot, 'dashboard', 'trends', 'trend-state.json');
}

function assertSafeFeedUrl(value, { allowPrivate = false } = {}) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Feed URL must use HTTP or HTTPS.');
  if (url.protocol !== 'https:' && !allowPrivate) throw new Error('Feed URL must use HTTPS unless explicitly allowed for tests.');
  const host = url.hostname;
  if (!allowPrivate && isPrivateHostname(host)) throw new Error('Feed URL points to a private or local network address.');
}

function isPrivateHostname(host) {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  if (net.isIP(lower)) {
    if (lower.startsWith('10.') || lower.startsWith('127.') || lower.startsWith('169.254.') || lower.startsWith('192.168.')) return true;
    const first = Number(lower.split('.')[0]);
    const second = Number(lower.split('.')[1]);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (lower === '::1') return true;
  }
  return false;
}

async function mapWithConcurrency(items, limit, callback) {
  const executing = new Set();
  const results = [];
  for (const item of items) {
    const promise = Promise.resolve().then(() => callback(item));
    results.push(promise);
    executing.add(promise);
    promise.finally(() => executing.delete(promise));
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.allSettled(results);
}

function sourceStatusBase(source) {
  return { id: source.id, publisher: source.publisher, feedUrl: source.feedUrl, categories: source.categories, enabled: source.enabled !== false, reliability: source.reliability };
}

function scoreOpportunity(item) {
  return (item.sourceCount || 0) * 3 + (item.brainCoverage === 'Strong' ? 4 : item.brainCoverage === 'Partial' ? 2 : 0) + (item.freshness === 'Fresh' ? 2 : 0);
}

function newestDate(items) {
  return items.map((item) => item.publishedAt).filter(Boolean).sort().at(-1) || '';
}

function freshnessLabel(value) {
  if (!value) return 'Recent source';
  const ageMs = Date.now() - Date.parse(value);
  if (ageMs < 2 * 24 * 60 * 60 * 1000) return 'Fresh';
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return 'Recent';
  return 'Older source';
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : 'undated';
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeUrl(value) {
  try { return new URL(value).toString(); } catch { return String(value || ''); }
}

function absolutizeUrl(value, base) {
  try { return new URL(value, base).toString(); } catch { return ''; }
}

function canonicalKey(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/utm_|fbclid|gclid/i.test(key)) url.searchParams.delete(key);
    return url.toString().toLowerCase();
  } catch { return ''; }
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|and|for|with|from|that|this|into|over)\b/g, '').replace(/\s+/g, ' ').trim();
}

function titleSimilarity(a, b) {
  const one = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const two = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!one.size || !two.size) return 0;
  return intersection(one, two).length / Math.max(one.size, two.size);
}

function intersection(one, two) {
  return [...one].filter((item) => two.has(item));
}

function hashText(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function labelFromUrl(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'source'; }
}

function trim(value, max) {
  const clean = sanitizeText(value);
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trim()}…` : clean;
}

function markdownTitle(text) {
  return String(text || '').match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error').replace(/[\r\n]+/g, ' ').slice(0, 180);
}
