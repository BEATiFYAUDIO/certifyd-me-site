import crypto from 'node:crypto';

export const TRENDING_CATEGORIES = ['Music', 'Technology', 'AI', 'Creator Economy', 'Media', 'Sports'];

const SEEDED_OPPORTUNITIES = [
  {
    id: 'spotify-creator-business',
    category: 'Music',
    title: 'Compare Certifyd to Spotify',
    whyTrending: 'Artists keep looking for better ways to earn beyond streaming payout models.',
    whyCertifyd: 'This lets Certifyd explain the difference between renting attention and building a creator business.',
    brainCoverage: 'Strong',
    topic: 'Compare Certifyd to Spotify',
  },
  {
    id: 'creator-ownership-explainer',
    category: 'Creator Economy',
    title: 'Explain creator ownership',
    whyTrending: 'Creators increasingly sell memberships, releases, services and direct access.',
    whyCertifyd: 'This is the cleanest way to explain why Certifyd reduces platform dependency.',
    brainCoverage: 'Strong',
    topic: 'Explain what creator ownership means in Certifyd',
  },
  {
    id: 'local-ai-publishing',
    category: 'AI',
    title: 'Write about local AI',
    whyTrending: 'Teams are adopting local models for private workflows and lower operating costs.',
    whyCertifyd: 'Certifyd can show how local AI supports internal editorial work without turning it into a public claim about automation.',
    brainCoverage: 'Partial',
    topic: 'Write about local AI and Certifyd editorial workflows',
  },
  {
    id: 'media-response',
    category: 'Media',
    title: 'Respond to this article',
    whyTrending: 'Industry articles often surface problems around attribution, payments and platform dependency.',
    whyCertifyd: 'This creates timely commentary when a source is supplied and approved for research.',
    brainCoverage: 'Needs source',
    topic: 'Respond to this article from a Certifyd perspective',
  },
  {
    id: 'sports-creator-commerce',
    category: 'Sports',
    title: 'Creator-owned sports media',
    whyTrending: 'Athletes, teams and independent sports publishers are becoming direct media businesses.',
    whyCertifyd: 'This can position Certifyd as infrastructure for identity, discovery and direct commerce without overstating live sports features.',
    brainCoverage: 'Partial',
    topic: 'Write about creator-owned sports media and direct fan commerce',
  },
  {
    id: 'open-web-publishing',
    category: 'Technology',
    title: 'Why publishing should be portable',
    whyTrending: 'More companies want content and commerce systems that are not locked inside one platform.',
    whyCertifyd: 'This connects Certifyd Core, public profiles and discovery surfaces into one business story.',
    brainCoverage: 'Strong',
    topic: 'Explain why creator publishing should be portable',
  },
];

export async function getTrendingOpportunities(config, options = {}) {
  const provider = String(config.trendResearch?.provider || config.trendResearchProvider || 'fixture').toLowerCase();
  const urls = Array.isArray(config.trendResearch?.sourceUrls) ? config.trendResearch.sourceUrls : [];
  if (provider === 'rss' && urls.length) {
    const live = await collectRssOpportunities(urls, {
      fetchImpl: options.fetchImpl || globalThis.fetch,
      timeoutMs: config.trendResearch?.timeoutMs || 8000,
    });
    if (live.items.length) return live;
    return seededResult(`RSS trend sources are configured, but no usable items were returned. ${live.errors.join(' ')}`.trim());
  }
  return seededResult(provider === 'fixture' ? 'Seeded editorial opportunities. Configure CONTENT_TREND_PROVIDER=rss and CONTENT_TREND_SOURCE_URLS to scan approved sources.' : `${provider} trend provider is not implemented yet.`);
}

export function filterTrendingOpportunities(trends, category) {
  const items = Array.isArray(trends?.items) ? trends.items : [];
  if (!category || category === 'All') return items;
  return items.filter((item) => item.category === category);
}

function seededResult(note) {
  return {
    provider: 'fixture',
    sourceLabels: ['Seeded'],
    lastScannedAt: null,
    note,
    items: SEEDED_OPPORTUNITIES.map((item) => ({ ...item, sourceType: 'seeded', sourceLabel: 'Seeded' })),
  };
}

async function collectRssOpportunities(urls, { fetchImpl, timeoutMs }) {
  const errors = [];
  const entries = [];
  for (const url of urls.slice(0, 12)) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      entries.push(...parseFeedItems(text).map((item) => ({ ...item, sourceUrl: url, sourceLabel: labelFromUrl(url) })));
    } catch (error) {
      errors.push(`${labelFromUrl(url)} failed: ${String(error?.message || error).slice(0, 120)}.`);
    }
  }
  const items = entries
    .map((entry) => toOpportunity(entry))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 18)
    .map(({ score, ...item }) => item);
  return {
    provider: 'rss',
    sourceLabels: [...new Set(entries.map((entry) => entry.sourceLabel))],
    lastScannedAt: new Date().toISOString(),
    note: errors.length ? `Some sources failed: ${errors.join(' ')}` : 'Live RSS scan from approved configured sources.',
    errors,
    items,
  };
}

function toOpportunity(entry) {
  const haystack = `${entry.title} ${entry.description}`.toLowerCase();
  const category = categorize(haystack);
  const score = scoreEntry(haystack, category, entry.publishedAt);
  return {
    id: hashId(`${entry.sourceUrl}:${entry.link || entry.title}`),
    category,
    title: trim(entry.title, 92),
    whyTrending: `Seen in ${entry.sourceLabel}${entry.publishedAt ? ` on ${entry.publishedAt.slice(0, 10)}` : ''}. ${trim(entry.description || entry.title, 180)}`,
    whyCertifyd: certifydRelevance(category, haystack),
    brainCoverage: ['Creator Economy', 'Technology', 'AI', 'Music'].includes(category) ? 'Partial' : 'Needs source',
    topic: `Respond to this trend: ${entry.title}`,
    sourceType: 'rss',
    sourceLabel: entry.sourceLabel,
    sourceUrl: entry.sourceUrl,
    link: entry.link,
    publishedAt: entry.publishedAt,
    score,
  };
}

function parseFeedItems(text) {
  const clean = String(text || '');
  const itemBlocks = [...clean.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const entryBlocks = [...clean.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  return [...itemBlocks, ...entryBlocks].map((block) => ({
    title: decodeXml(readTag(block, 'title')),
    description: decodeXml(readTag(block, 'description') || readTag(block, 'summary') || readTag(block, 'content')),
    link: decodeXml(readTag(block, 'link') || readLinkHref(block)),
    publishedAt: normalizeDate(readTag(block, 'pubDate') || readTag(block, 'published') || readTag(block, 'updated')),
  })).filter((item) => item.title);
}

function readTag(block, tag) {
  return block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').trim() || '';
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
    .replace(/\s+/g, ' ')
    .trim();
}

function categorize(text) {
  if (/\b(ai|artificial intelligence|model|llm|machine learning|openai|anthropic|ollama|local ai)\b/.test(text)) return 'AI';
  if (/\b(music|artist|song|streaming|spotify|label|royalty|playlist|album)\b/.test(text)) return 'Music';
  if (/\b(creator|influencer|patreon|youtube|substack|audience|fan|creator economy)\b/.test(text)) return 'Creator Economy';
  if (/\b(media|publisher|journalism|film|podcast|newsletter|broadcast)\b/.test(text)) return 'Media';
  if (/\b(sport|athlete|league|team|club|game day)\b/.test(text)) return 'Sports';
  return 'Technology';
}

function certifydRelevance(category, text) {
  if (/\b(bot|fake|fraud|streaming manipulation|click farm|payola)\b/.test(text)) return 'This gives Certifyd a direct angle on why paid customer activity is stronger than empty engagement metrics.';
  if (category === 'Music') return 'This connects to creator commerce, direct fan relationships and alternatives to attention-only music economics.';
  if (category === 'AI') return 'This connects to trusted identity, attribution and source context as discovery becomes more machine-assisted.';
  if (category === 'Creator Economy') return 'This connects to creator-controlled profiles, publishing, discovery and direct commerce.';
  if (category === 'Media') return 'This connects to public attribution, source context and audience ownership.';
  return 'This connects to Certifyd as infrastructure for identity, publishing, discovery and commerce.';
}

function scoreEntry(text, category, publishedAt) {
  let score = ['Music', 'Creator Economy', 'AI'].includes(category) ? 4 : 2;
  for (const term of ['creator', 'direct', 'commerce', 'ownership', 'attribution', 'ai', 'music', 'fan', 'payments', 'bot', 'fake']) {
    if (text.includes(term)) score += 1;
  }
  if (publishedAt && Date.now() - Date.parse(publishedAt) < 1000 * 60 * 60 * 24 * 14) score += 2;
  return score;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  return fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8' } });
}

function labelFromUrl(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'source'; }
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function hashId(value) {
  return `trend-${crypto.createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

function trim(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trim()}…` : clean;
}
