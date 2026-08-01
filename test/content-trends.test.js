import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildSourceRegistry,
  clusterSourceItems,
  computeNextScanDelayMs,
  dedupeSourceItems,
  dismissTrendOpportunity,
  filterTrendingOpportunities,
  getTrendingOpportunities,
  parseFeedItems,
  readTrendSourceDetail,
  saveTrendOpportunity,
  scanTrendOpportunities,
  startTrendDailyScheduler,
} from '../scripts/content-dashboard/trends.js';
import { getDashboardConfig } from '../scripts/content-dashboard/config.js';

async function tempAgentRoot() {
  const agentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-trends-'));
  await fs.mkdir(path.join(agentRoot, 'knowledge', 'facts'), { recursive: true });
  await fs.writeFile(path.join(agentRoot, 'knowledge', 'facts', 'approved-public-claims.md'), [
    '# Approved Public Claims',
    '',
    'Certifyd supports creator-controlled public profiles, publishing, discovery and direct commerce.',
    'Certifyd Fan is a discovery and playback surface for public creator works.',
    'Certifyd connects creator identity, attribution, receipts and direct creator commerce.',
    'Do not claim permanent records, legal guarantees or complete ownership of creative rights.',
  ].join('\n'));
  return agentRoot;
}

function config(agentRoot, overrides = {}) {
  return {
    siteRoot: agentRoot,
    agentRoot,
    trendResearchProvider: overrides.trendResearchProvider || 'rss',
    trendResearch: {
      provider: 'rss',
      sourceUrls: ['https://example.test/feed.xml'],
      timeoutMs: 1000,
      maxItemsPerSource: 30,
      maxItemAgeDays: 30,
      maxConcurrentFetches: 2,
      dailyScanEnabled: false,
      scanHour: 7,
      ...(overrides.trendResearch || {}),
    },
    ollama: {
      enabled: false,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b',
      timeoutMs: 1000,
      maxContextChars: 4096,
      ...(overrides.ollama || {}),
    },
  };
}

function rssFeed(items) {
  return `<?xml version="1.0"?><rss><channel>${items.map((item) => `<item><title>${item.title}</title><description>${item.description}</description><link>${item.link}</link><pubDate>${item.pubDate || new Date().toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
}

function atomFeed() {
  return `<?xml version="1.0"?><feed><entry><title>Local AI changes creator publishing workflows</title><summary>Open models and local AI tools are reducing editorial workflow friction.</summary><link href="https://example.test/local-ai"/><updated>${new Date().toISOString()}</updated></entry></feed>`;
}

function response(body, { status = 200, contentType = 'application/rss+xml' } = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('trend opportunities default to clearly labeled seeded examples only when seeded is configured', async () => {
  const trends = await getTrendingOpportunities({ trendResearch: { provider: 'seeded', sourceUrls: [] } });
  assert.equal(trends.provider, 'seeded');
  assert.ok(trends.items.length > 0);
  assert.match(trends.note, /editorial examples/i);
  assert.equal(trends.items[0].sourceType, 'seeded');
});

test('dashboard trend configuration defaults to source-backed composite scanning', () => {
  const dashboardConfig = getDashboardConfig({});
  assert.equal(dashboardConfig.trendResearch.provider, 'composite');
  assert.equal(dashboardConfig.trendResearchProvider, 'composite');
});

test('RSS scans approved sources, categorizes opportunities, persists state and exposes source details', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Music streaming bot farms are distorting creator payouts',
      description: 'Artists are questioning fake engagement, bot farming and how paid customer activity should be measured.',
      link: 'https://example.test/music-bot-farms',
    },
  ]);
  const scan = await scanTrendOpportunities(config(agentRoot), { fetchImpl: async () => response(feed) });

  assert.equal(scan.provider, 'rss');
  assert.ok(scan.items.length >= 1);
  assert.equal(scan.items[0].category, 'Music');
  assert.match(scan.items[0].whyCertifyd, /paid customer activity|creator commerce|engagement metrics/i);
  assert.equal(filterTrendingOpportunities(scan, 'Music').length, 1);
  assert.equal(filterTrendingOpportunities(scan, 'Sports').length, 0);

  const persisted = await getTrendingOpportunities(config(agentRoot));
  assert.equal(persisted.items.length, scan.items.length);
  const detail = await readTrendSourceDetail(config(agentRoot), scan.items[0].id);
  assert.equal(detail.sources.length, scan.items[0].sourceItemIds.length);
  assert.match(detail.sources[0].title, /bot farms/i);
});

test('seeded scans do not overwrite existing source-backed trend results', async () => {
  const agentRoot = await tempAgentRoot();
  const trendStateDir = path.join(agentRoot, 'dashboard', 'trends');
  await fs.mkdir(trendStateDir, { recursive: true });
  await fs.writeFile(path.join(trendStateDir, 'trend-state.json'), JSON.stringify({
    provider: 'rss',
    lastScannedAt: '2026-07-27T00:00:00.000Z',
    summary: { provider: 'rss', sourcesChecked: 1, opportunitiesCreated: 1 },
    sourceItems: [{ id: 'source-1', title: 'Source-backed story' }],
    opportunities: [{ id: 'rss-opportunity', title: 'Source-backed opportunity', category: 'Music' }],
    errors: [],
    dismissed: [],
    savedIdeas: [],
  }, null, 2));

  const scan = await scanTrendOpportunities(config(agentRoot, {
    trendResearchProvider: 'seeded',
    trendResearch: { provider: 'seeded', sourceUrls: [] },
  }));

  assert.equal(scan.provider, 'rss');
  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].id, 'rss-opportunity');
  assert.match(scan.errors[0], /Seeded scan ignored/);
});

test('RSS scan reports unavailable sources without replacing them with fake live trends', async () => {
  const agentRoot = await tempAgentRoot();
  const scan = await scanTrendOpportunities(config(agentRoot), {
    fetchImpl: async () => response('', { status: 503, contentType: 'text/plain' }),
  });

  assert.equal(scan.provider, 'rss');
  assert.equal(scan.items.length, 0);
  assert.equal(scan.summary.opportunitiesCreated, 0);
  assert.ok(scan.providerStatus.every((source) => source.status === 'unavailable'));
  assert.match(scan.note, /unavailable|no recent stories|some unavailable/i);
});

test('RSS provider refuses private or non-HTTPS feed URLs by default', async () => {
  const agentRoot = await tempAgentRoot();
  const cfg = config(agentRoot, { trendResearch: { provider: 'rss', sourceUrls: ['http://127.0.0.1/feed.xml'] } });
  let calls = 0;
  const scan = await scanTrendOpportunities(cfg, { fetchImpl: async () => { calls += 1; return response(''); } });

  assert.ok(calls > 0);
  assert.equal(scan.items.length, 0);
  assert.ok(scan.providerStatus.some((source) => /private|local|HTTPS/i.test(source.latestError || '')));
});

test('Atom parsing, dedupe and clustering keep source summaries compact', () => {
  const items = parseFeedItems(atomFeed(), { id: 'example', publisher: 'Example', feedUrl: 'https://example.test/atom.xml', categories: ['AI'] }, 'https://example.test/atom.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].category, undefined);
  assert.ok(items[0].categories.includes('AI'));

  const duplicate = { ...items[0], id: 'different-id' };
  const deduped = dedupeSourceItems([items[0], duplicate]);
  assert.equal(deduped.length, 1);
  const clusters = clusterSourceItems(deduped);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].category, 'AI');
});

test('Qwen trend ranking falls back when local model returns malformed analysis', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Creators want direct commerce and customer relationships',
      description: 'Creator economy companies are discussing memberships, direct-to-fan sales and audience relationships.',
      link: 'https://example.test/direct-commerce',
    },
  ]);
  const cfg = config(agentRoot, { ollama: { enabled: true }, trendResearch: { qwenEvaluationEnabled: true } });
  const scan = await scanTrendOpportunities(cfg, {
    fetchImpl: async (url) => {
      if (String(url).includes('/api/chat')) return response(JSON.stringify({ message: { content: '{"recommended":true,"suggestedTitle":"Creator commerce" "whyItMatters":"bad json"}' } }), { contentType: 'application/json' });
      return response(feed);
    },
  });

  assert.equal(scan.items.length, 1);
  assert.match(scan.items[0].generatedBy, /deterministic|source-cluster/);
  assert.equal(scan.items[0].riskFlags.some((flag) => /Qwen unavailable|Expected ','|position 406/i.test(flag)), false);
});

test('trend scans skip source items without a Certifyd-relevant creator angle', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Ten advances in mathematics and theoretical computer science',
      description: 'Researchers share new results on geometry, cryptography and complexity theory.',
      link: 'https://example.test/math-advances',
    },
  ]);
  const scan = await scanTrendOpportunities(config(agentRoot), {
    fetchImpl: async (url) => response(String(url).includes('example.test') ? feed : rssFeed([])),
  });

  assert.equal(scan.summary.storiesRetained, 1);
  assert.equal(scan.items.length, 0);
});

test('unfaithful Qwen trend analysis is discarded in favour of deterministic source-backed copy', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Music artists test direct fan memberships',
      description: 'Independent artists are building audience relationships with direct-to-fan subscriptions and commerce.',
      link: 'https://example.test/music-memberships',
    },
  ]);
  const cfg = config(agentRoot, { ollama: { enabled: true }, trendResearch: { qwenEvaluationEnabled: true } });
  const scan = await scanTrendOpportunities(cfg, {
    fetchImpl: async (url) => {
      if (String(url).includes('/api/chat')) {
        return response(JSON.stringify({ message: { content: JSON.stringify({ recommended: true, suggestedTitle: 'Not applicable', whyItMatters: 'This is unrelated to the category.', certifydAngle: 'Not applicable as it pertains to a different topic.', riskFlags: [] }) } }), { contentType: 'application/json' });
      }
      return response(feed);
    },
  });

  assert.equal(scan.items.length, 1);
  assert.doesNotMatch(scan.items[0].suggestedAngle, /not applicable|unrelated|different topic/i);
  assert.match(scan.items[0].generatedBy, /deterministic|source-cluster/);
});

test('dismissing an opportunity removes it from active saved trend results', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Creator commerce grows through memberships and direct access',
      description: 'Creators are selling memberships, digital products and direct access to their fans.',
      link: 'https://example.test/creator-commerce',
    },
  ]);
  const scan = await scanTrendOpportunities(config(agentRoot), { fetchImpl: async () => response(feed) });
  const id = scan.items[0].id;
  await dismissTrendOpportunity(config(agentRoot), id);
  const after = await getTrendingOpportunities(config(agentRoot));
  assert.equal(after.items.some((item) => item.id === id), false);
});

test('saving a trend opportunity persists and deduplicates it without removing active results', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Creator commerce grows through memberships and direct access',
      description: 'Creators are selling memberships, digital products and direct access to their fans.',
      link: 'https://example.test/creator-commerce',
    },
  ]);
  const cfg = config(agentRoot);
  const scan = await scanTrendOpportunities(cfg, { fetchImpl: async () => response(feed) });
  const id = scan.items[0].id;

  await saveTrendOpportunity(cfg, id, { email: 'founder@certifyd.me' });
  await saveTrendOpportunity(cfg, id, { email: 'founder@certifyd.me' });
  const after = await getTrendingOpportunities(cfg);

  assert.equal(after.items.some((item) => item.id === id), true);
  assert.equal(after.items.find((item) => item.id === id).saved, true);
  assert.equal(after.savedIdeas.length, 1);
  assert.equal(after.savedIdeas[0].id, id);
  assert.equal(after.savedIdeas[0].savedBy, 'founder@certifyd.me');
});

test('daily trend scheduler is explicit, stoppable and disabled by default', async () => {
  const agentRoot = await tempAgentRoot();
  assert.equal(startTrendDailyScheduler(config(agentRoot)), null);

  const enabledConfig = config(agentRoot, { trendResearch: { dailyScanEnabled: true, provider: 'seeded', sourceUrls: [] } });
  const handle = startTrendDailyScheduler(enabledConfig, { intervalMs: 10, once: true, logger: { info() {}, warn() {} } });
  assert.ok(handle);
  handle.stop();

  const delay = computeNextScanDelayMs(new Date('2026-07-26T08:00:00Z'), 9);
  assert.ok(delay > 0);
});

test('source registry includes approved default feeds and env-configured feeds without duplicates', () => {
  const registry = buildSourceRegistry(config('/tmp/unused', { trendResearch: { sourceUrls: ['https://techcrunch.com/feed/', 'https://example.test/custom.xml'] } }));
  const urls = registry.map((source) => source.feedUrl);
  assert.equal(urls.filter((url) => url === 'https://techcrunch.com/feed/').length, 1);
  assert.ok(urls.includes('https://example.test/custom.xml'));
});
