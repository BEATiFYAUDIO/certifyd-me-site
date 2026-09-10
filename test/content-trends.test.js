import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildSourceRegistry,
  clusterSourceItems,
  computeNextScanDelayMs,
  DEFAULT_SOURCE_REGISTRY,
  dedupeSourceItems,
  dismissTrendOpportunity,
  eventClusterDecision,
  filterTrendingOpportunities,
  getTrendingOpportunities,
  isGenericCertifydRelevance,
  parseFeedItems,
  readTrendSourceDetail,
  retainSourceStories,
  saveTrendOpportunity,
  scanTrendOpportunities,
  selectRecommendedOpportunities,
  SEEDED_OPPORTUNITIES,
  startTrendDailyScheduler,
  storyFingerprint,
  TREND_CLUSTERING_VERSION,
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

function sourceStory(title, summary, overrides = {}) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return {
    id: `src-${slug}`,
    provider: 'rss',
    publisher: overrides.publisher || 'Example News',
    sourceName: overrides.publisher || 'Example News',
    articleUrl: overrides.articleUrl || `https://example.test/${slug}`,
    sourceUrl: overrides.articleUrl || `https://example.test/${slug}`,
    sourceTitle: title,
    feedUrl: 'https://example.test/feed.xml',
    title,
    summary,
    publishedAt: overrides.publishedAt || new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    categories: overrides.categories || ['AI', 'Music'],
    keywords: overrides.keywords || [],
    sourcePriority: overrides.sourcePriority ?? 80,
    sourceType: 'rss',
    certifydRelevanceScore: overrides.certifydRelevanceScore ?? 12,
    certifydRelevanceReasons: overrides.certifydRelevanceReasons || ['rights, permissions or licensing pressure'],
    certifydRelevanceMatched: overrides.certifydRelevanceMatched ?? true,
  };
}

test('trend opportunities default to clearly labeled seeded examples only when seeded is configured', async () => {
  const trends = await getTrendingOpportunities({ trendResearch: { provider: 'seeded', sourceUrls: [] } });
  assert.equal(trends.provider, 'seeded');
  assert.ok(trends.items.length > 0);
  assert.match(trends.note, /editorial examples/i);
  assert.equal(trends.items[0].sourceType, 'seeded');
});

test('seeded mode has at least five useful editorial ideas per core category', async () => {
  const required = ['Music', 'Technology', 'AI', 'Creator Economy', 'Media', 'Sports', 'Digital Identity', 'Creator Commerce'];
  for (const category of required) {
    const count = SEEDED_OPPORTUNITIES.filter((item) => item.category === category).length;
    assert.ok(count >= 5, `${category} has ${count} seeded ideas`);
  }
  const trends = await getTrendingOpportunities({ trendResearch: { provider: 'seeded', sourceUrls: [] } });
  assert.ok(trends.items.every((item) => item.sourceType === 'seeded' && item.evidenceLabel === 'Seeded example'));
});

test('expanded source registry uses real RSS-backed sources and disables failed candidates', () => {
  const enabled = DEFAULT_SOURCE_REGISTRY.filter((source) => source.enabled !== false);
  const disabled = DEFAULT_SOURCE_REGISTRY.filter((source) => source.enabled === false);
  for (const category of ['Music', 'Technology', 'AI', 'Creator Economy', 'Media', 'Sports', 'Digital Identity', 'Creator Commerce']) {
    assert.ok(enabled.some((source) => source.categories.includes(category)), `${category} has enabled source`);
  }
  assert.ok(enabled.every((source) => /^https:\/\//.test(source.feedUrl)));
  assert.ok(disabled.length >= 1);
  assert.ok(disabled.every((source) => /disabled|404|returned html/i.test(source.reliability)));
});

test('dashboard trend configuration defaults to source-backed composite scanning', () => {
  const dashboardConfig = getDashboardConfig({});
  assert.equal(dashboardConfig.trendResearch.provider, 'composite');
  assert.equal(dashboardConfig.trendResearchProvider, 'composite');
});

test('recommendation selection allows up to twenty total while capping each category at five', () => {
  const categories = ['Music', 'Technology', 'AI', 'Creator Economy', 'Media'];
  const opportunities = [];
  for (const category of categories) {
    for (let index = 0; index < 8; index += 1) {
      opportunities.push({
        id: category + '-' + index,
        title: category + ' opportunity ' + index,
        category,
        sourceCount: 8 - index,
        brainCoverage: index < 3 ? 'Strong' : 'Partial',
        newestSourceDate: new Date(Date.now() - index * 1000).toISOString(),
      });
    }
  }
  const selected = selectRecommendedOpportunities(opportunities, { trendResearch: { recommendationTotalLimit: 20, recommendationCategoryLimit: 5 } });
  assert.equal(selected.length, 20);
  for (const category of categories) {
    const count = selected.filter((item) => item.category === category).length;
    assert.ok(count <= 5, category + ' is capped at five');
  }
  assert.ok(new Set(selected.map((item) => item.category)).size > 1);
});

test('recommendation selection returns fewer than twenty when credible candidates are scarce', () => {
  const opportunities = Array.from({ length: 6 }, (_, index) => ({
    id: 'music-' + index,
    title: 'Music opportunity ' + index,
    category: 'Music',
    sourceCount: 1,
    brainCoverage: 'Strong',
    newestSourceDate: new Date(Date.now() - index * 1000).toISOString(),
  }));
  const selected = selectRecommendedOpportunities(opportunities, { trendResearch: { recommendationTotalLimit: 20, recommendationCategoryLimit: 5 } });
  assert.equal(selected.length, 5);
  assert.ok(selected.every((item) => item.category === 'Music'));
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
  assert.equal(persisted.sourceStories.length, scan.summary.storiesRetained);
  assert.equal(persisted.sourceStories[0].sourceUrl, 'https://example.test/music-bot-farms');
  assert.equal(persisted.sourceStories[0].sourceTitle, 'Music streaming bot farms are distorting creator payouts');
  assert.deepEqual(persisted.sourceStories[0].opportunityIds, [scan.items[0].id]);
  assert.equal(persisted.sourceStories[0].retentionStatus, 'Recommended');
  assert.match(persisted.sourceStories[0].retentionReason, /Grouped into recommended opportunity/);
  assert.ok(persisted.sourceStories[0].publishedAt);
  assert.ok(persisted.sourceStories[0].fetchedAt);
  const detail = await readTrendSourceDetail(config(agentRoot), scan.items[0].id);
  assert.ok(scan.items[0].sourceUrls.includes('https://example.test/music-bot-farms'));
  assert.equal(scan.items[0].originalSources[0].sourceUrl, 'https://example.test/music-bot-farms');
  assert.equal(detail.sources.length, scan.items[0].sourceItemIds.length);
  assert.equal(detail.sources[0].sourceUrl, 'https://example.test/music-bot-farms');
  assert.equal(detail.sources[0].sourceTitle, 'Music streaming bot farms are distorting creator payouts');
  assert.match(detail.sources[0].title, /bot farms/i);
});

test('source stories are classified, scored and promoted into opportunities without losing original URLs', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Merlin and Spotify expand licensed fan remix permissions',
      description: 'Music creators, fan-made works, royalties, attribution and licensing workflows are becoming core infrastructure for creator commerce.',
      link: 'https://example.test/merlin-spotify-remix-rights',
    },
    {
      title: 'Routine quarterly office lease renewals continue downtown',
      description: 'A real estate update covers leases, office vacancy rates and construction timelines for downtown landlords.',
      link: 'https://example.test/office-leases',
    },
  ]);

  const scan = await scanTrendOpportunities(config(agentRoot), { fetchImpl: async () => response(feed) });
  const promoted = scan.items.find((item) => item.sourceUrls.includes('https://example.test/merlin-spotify-remix-rights'));
  const retainedOnly = scan.sourceStories.find((item) => item.sourceUrl === 'https://example.test/office-leases');

  assert.ok(promoted);
  assert.ok(promoted.categories.includes('Music'));
  assert.ok(promoted.categories.includes('Creator Commerce') || promoted.categories.includes('Creator Economy'));
  assert.ok(promoted.certifydRelevanceScore >= 8);
  assert.match(promoted.whyItMattersToCertifyd, /creator|commerce|rights|attribution|fan|identity/i);
  assert.equal(promoted.originalSources[0].sourceUrl, 'https://example.test/merlin-spotify-remix-rights');
  assert.equal(promoted.originalSources[0].sourceTitle, 'Merlin and Spotify expand licensed fan remix permissions');

  assert.ok(retainedOnly);
  assert.equal(retainedOnly.retentionStatus, 'Retained');
  assert.deepEqual(retainedOnly.opportunityIds, []);
  assert.ok(Number.isFinite(retainedOnly.certifydRelevanceScore));
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

test('same lawsuit coverage clusters as one event', () => {
  const items = [
    sourceStory('SOCAN sues Suno over copyrighted songs', 'Canadian collecting society SOCAN files a copyright lawsuit against Suno over music training and output.'),
    sourceStory("Canada's SOCAN files lawsuit against Suno", 'SOCAN filed suit against Suno alleging infringement of copyrighted compositions and recordings.'),
  ];
  const clusters = clusterSourceItems(items);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 2);
  assert.equal(clusters[0].clusterDecisions[0].decision, 'same-event');
  assert.match(clusters[0].title, /SOCAN.*Suno/i);
});

test('different Suno lawsuits remain separate stories', () => {
  const socan = sourceStory('SOCAN sues Suno over copyrighted songs', 'SOCAN filed a copyright lawsuit against Suno in Canada.');
  const gerencia = sourceStory('Gerencia 360 sues Suno over Latin music catalog', 'Gerencia 360 filed a separate copyright lawsuit against Suno over alleged infringement.');
  const clusters = clusterSourceItems([socan, gerencia]);
  const decision = eventClusterDecision(socan, gerencia);

  assert.equal(clusters.length, 2);
  assert.equal(decision.decision, 'separate-events');
  assert.deepEqual(decision.overlappingEntities, ['suno']);
});

test('same company with different event does not cluster', () => {
  const lawsuit = sourceStory('SOCAN sues Suno over copyrighted songs', 'SOCAN filed a copyright lawsuit against Suno.');
  const controversy = sourceStory('Suno pulls Mary J. Blige ad after representative controversy', 'Suno removed a campaign after someone falsely represented themselves as Mary J. Blige representative.');
  const clusters = clusterSourceItems([lawsuit, controversy]);

  assert.equal(clusters.length, 2);
});

test('broad AI similarity is not event identity', () => {
  const policy = sourceStory('DOJ sides with OpenAI in New York Times fair use case', 'The U.S. Department of Justice argued about AI training and fair use in the New York Times litigation against OpenAI.');
  const acquisition = sourceStory('Nvidia buys Hugging Face in AI infrastructure deal', 'Nvidia agreed to acquire Hugging Face in a major AI infrastructure acquisition.');
  const clusters = clusterSourceItems([policy, acquisition]);
  const decision = eventClusterDecision(policy, acquisition);

  assert.equal(clusters.length, 2);
  assert.equal(decision.decision, 'separate-events');
  assert.equal(decision.sameEventType, false);
});

test('broad creator economy similarity is not enough to cluster', () => {
  const pricing = sourceStory('Spotify changes creator subscription pricing', 'Spotify updated pricing terms for creator subscriptions and direct fan products.', { categories: ['Creator Economy'] });
  const appointment = sourceStory('Spotify names new podcast chief', 'Spotify appointed a new executive to lead its podcast creator business.', { categories: ['Creator Economy'] });
  const clusters = clusterSourceItems([pricing, appointment]);

  assert.equal(clusters.length, 2);
});

test('same acquisition coverage clusters as one event', () => {
  const items = [
    sourceStory('Nvidia buys Hugging Face for $13B', 'Nvidia acquired Hugging Face for $13B in an AI infrastructure transaction.'),
    sourceStory('Hugging Face acquired by Nvidia in $13 billion deal', 'Nvidia completed a $13 billion acquisition of Hugging Face.'),
  ];
  const clusters = clusterSourceItems(items);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 2);
  assert.equal(clusters[0].storyFingerprint.eventType, 'acquisition');
});

test('same SOCAN and Suno legal event corroborates despite headline wording', () => {
  const items = [
    sourceStory(
      'When It Rains, It Pours: SOCAN Sues Suno for Allegedly ‘Engaging in Rampant Copyright Infringement on a Massive Scale’',
      'SOCAN sues Suno in Canada for alleged copyright infringement.',
      { publisher: 'Digital Music News' },
    ),
    sourceStory(
      "Canada's Socan files latest music-industry lawsuit against Suno",
      "Canada's SOCAN filed the latest music-industry lawsuit against Suno over alleged copyright infringement.",
      { publisher: 'Music Ally' },
    ),
  ];
  const clusters = clusterSourceItems(items);
  const decision = eventClusterDecision(items[0], items[1]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 2);
  assert.equal(decision.decision, 'same-event');
  assert.equal(decision.corroboratedSameEvent, true);
});

test('same Wilson Pickett and Primary Wave rights deal corroborates across deal wording', () => {
  const items = [
    sourceStory(
      'Wilson Pickett estate strikes deal with Primary Wave covering publishing catalog and name, image & likeness rights',
      'The Wilson Pickett estate struck a deal with Primary Wave covering publishing catalog and name, image and likeness rights.',
      { publisher: 'Music Business Worldwide' },
    ),
    sourceStory(
      'Primary Wave Music Partners With the Estate of Wilson Pickett',
      'Primary Wave Music partners with the estate of Wilson Pickett on publishing catalog and name, image and likeness rights.',
      { publisher: 'Digital Music News' },
    ),
  ];
  const clusters = clusterSourceItems(items);
  const decision = eventClusterDecision(items[0], items[1]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 2);
  assert.equal(decision.decision, 'same-event');
  assert.equal(decision.corroboratedSameEvent, true);
});

test('event identity v2 keeps same-company product and development stories separate without a concrete anchor', () => {
  const pairs = [
    [
      'Apple AirPods 5 and iPhone 18 Pro pricing',
      sourceStory('Apple AirPods 5 leak points to camera controls', 'Apple is developing AirPods 5 features for future audio devices.'),
      sourceStory('Apple iPhone 18 Pro price tipped by analysts', 'Apple may increase iPhone 18 Pro pricing next year.'),
    ],
    [
      'iPhone Duo history and black iPhone Pro color',
      sourceStory('Apple iPhone Duo launch history resurfaces', 'A report looks back at the rumored iPhone Duo product history.'),
      sourceStory('Apple black iPhone 18 Pro color could return', 'A supply-chain note discusses a possible black iPhone 18 Pro finish.'),
    ],
    [
      'GPT-6 Astra and journalism support',
      sourceStory('OpenAI GPT-6 Astra details surface in model roadmap', 'OpenAI GPT-6 Astra is described as a future model development.'),
      sourceStory('OpenAI expands initiatives to support journalism classrooms', 'OpenAI announced support programs for journalism educators.'),
    ],
    [
      'GPT-6 Astra and Navier-Stokes',
      sourceStory('OpenAI GPT-6 Astra details surface in model roadmap', 'OpenAI GPT-6 Astra is described as a future model development.'),
      sourceStory("OpenAI's Navier-Stokes breakthrough claims draw scrutiny", 'Researchers debate a reported Navier-Stokes mathematics result.'),
    ],
    [
      'CrowdTangle and Meta AI child-abuse ads enforcement',
      sourceStory('Meta CrowdTangle replacement draws publisher criticism', 'Meta faces questions from researchers after retiring CrowdTangle.'),
      sourceStory('Meta and San Francisco officials target AI child abuse ads', 'Meta, Facebook and Instagram enforcement actions address AI child abuse ads.'),
    ],
    [
      'NFL halftime and generic season boundaries',
      sourceStory('NFL taps Cage the Elephant for Munich halftime show', 'The NFL announced Cage the Elephant for the Munich halftime show.'),
      sourceStory('NFL clarifies broadcast boundaries for new season', 'The NFL outlined generic media policies and season boundaries.'),
    ],
    [
      'Italy and Spain recorded music H1',
      sourceStory('Italy recorded-music H1 revenue rises', 'Italy recorded-music H1 results show local streaming growth.'),
      sourceStory('Spain recorded-music H1 revenue rises', 'Spain recorded-music H1 results show local streaming growth.'),
    ],
    [
      'Italy and France recorded music H1',
      sourceStory('Italy recorded-music H1 revenue rises', 'Italy recorded-music H1 results show local streaming growth.'),
      sourceStory('France recorded-music H1 revenue rises', 'France recorded-music H1 results show local streaming growth.'),
    ],
  ];

  for (const [label, one, two] of pairs) {
    const decision = eventClusterDecision(one, two);
    assert.equal(decision.decision, 'separate-events', label);
    assert.equal(clusterSourceItems([one, two]).length, 2, label);
    assert.ok(decision.blockingReasons.length > 0, label);
  }
});

test('roundups can corroborate one concrete story without bridging distinct events transitively', () => {
  const airpods = sourceStory('Apple AirPods 5 debuts with improved noise cancellation', 'Apple shows off AirPods 5 with updated audio hardware.');
  const roundup = sourceStory('Everything Apple announced: AirPods 5, iPhone Duo and more', 'Apple announced AirPods 5, iPhone Duo, Apple Watch updates and other product news in a roundup.');
  const iphoneDuo = sourceStory('Apple iPhone Duo launches as foldable phone project', 'Apple introduces iPhone Duo as a separate foldable iPhone product.');
  const clusters = clusterSourceItems([airpods, roundup, iphoneDuo]);

  assert.equal(eventClusterDecision(airpods, roundup).decision, 'separate-events');
  assert.equal(eventClusterDecision(roundup, iphoneDuo).decision, 'separate-events');
  assert.equal(eventClusterDecision(airpods, iphoneDuo).decision, 'separate-events');
  assert.equal(clusters.length, 3);
  assert.ok(clusters.every((cluster) => cluster.items.length === 1));
});

test('launch synonyms and normalized objects merge coverage of the same product launch', () => {
  const pairs = [
    [
      sourceStory('Suno rolls out Warner- and BMG-backed v6 AI music models', 'Suno is rolling out v6 AI music models backed by Warner Music and BMG.', { publisher: 'Digital Music News' }),
      sourceStory('Suno launches v6 models after label deals', 'Suno launched new v6 models following label partnerships.', { publisher: 'Music Ally' }),
    ],
    [
      sourceStory('Suno rolls out Warner- and BMG-backed v6 AI music models', 'Suno is rolling out v6 AI music models backed by Warner Music and BMG.', { publisher: 'Digital Music News' }),
      sourceStory("Suno's new v6 models are here", 'The Verge reports that Suno released its v6 models with licensed music support.', { publisher: 'The Verge' }),
    ],
    [
      sourceStory('Suno rolls out Warner- and BMG-backed v6 AI music models', 'Suno is rolling out v6 AI music models backed by Warner Music and BMG.', { publisher: 'Digital Music News' }),
      sourceStory('Suno v6 model launch follows Warner and BMG agreements', 'Music Business Worldwide covers the Suno v6 launch and label agreements.', { publisher: 'Music Business Worldwide' }),
    ],
    [
      sourceStory('Apple shows off AirPods 5 with new audio features', 'TechCrunch reports Apple showed off AirPods 5 during its product event.', { publisher: 'TechCrunch' }),
      sourceStory('Apple debuts AirPods 5 at hardware event', 'Ars Technica reports Apple debuted AirPods 5 with updated audio features.', { publisher: 'Ars Technica' }),
    ],
  ];

  for (const [one, two] of pairs) {
    const decision = eventClusterDecision(one, two);
    assert.equal(decision.decision, 'same-event', `${one.title} should merge with ${two.title}`);
    assert.ok(decision.concreteAnchorMatches.length > 0);
    assert.equal(clusterSourceItems([one, two]).length, 1);
  }

  const sunoFingerprint = storyFingerprint(pairs[0][0]);
  assert.equal(sunoFingerprint.eventType, 'product-launch');
  assert.equal(sunoFingerprint.action, 'launches');
  assert.equal(sunoFingerprint.normalizedObject, 'suno v6');
});

test('same legal ruling and same acquisition coverage still merge with concrete corroboration', () => {
  const legal = [
    sourceStory('Federal judge rejects MLC interlocutory appeal in Spotify bundling case', 'A federal judge rejected the Mechanical Licensing Collective interlocutory appeal in the Spotify bundling lawsuit.'),
    sourceStory('Spotify bundling lawsuit ruling denies MLC appeal push', 'The court denied the MLC interlocutory appeal in the Spotify bundling case.'),
  ];
  const acquisition = [
    sourceStory('HarbourView acquires David Kershenbaum catalog in rights transaction', 'HarbourView acquired David Kershenbaum catalog interests and producer royalties in a rights transaction.'),
    sourceStory('David Kershenbaum catalog acquired by HarbourView', 'HarbourView completed a catalog acquisition covering David Kershenbaum rights.'),
  ];

  assert.equal(eventClusterDecision(legal[0], legal[1]).decision, 'same-event');
  assert.equal(clusterSourceItems(legal).length, 1);
  assert.equal(eventClusterDecision(acquisition[0], acquisition[1]).decision, 'same-event');
  assert.equal(clusterSourceItems(acquisition).length, 1);
});

test('Spotify RNB X Live Dallas festival announcement continues to merge', () => {
  const one = sourceStory('Spotify announces RNB X Live Dallas festival', 'Spotify announced RNB X Live Dallas as a live music festival event.');
  const two = sourceStory('Spotify brings RNB X Live to Dallas', 'Spotify will launch the RNB X Live Dallas festival with artists and fans.');
  const decision = eventClusterDecision(one, two);

  assert.equal(decision.decision, 'same-event');
  assert.equal(clusterSourceItems([one, two]).length, 1);
  assert.ok(decision.concreteAnchorMatches.includes('rnb x live dallas') || decision.concreteAnchorMatches.includes('rnb x live'));
});

test('source-level clustering diagnostics persist with source stories and opportunities', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Suno rolls out Warner- and BMG-backed v6 AI music models',
      description: 'Suno is rolling out v6 AI music models after label deals involving rights, permissions and creators.',
      link: 'https://example.test/suno-v6-dmn',
    },
    {
      title: 'Suno launches v6 models after label deals',
      description: 'Suno launched v6 models with licensing, creator permission and AI music context.',
      link: 'https://example.test/suno-v6-music-ally',
    },
  ]);
  const scan = await scanTrendOpportunities(config(agentRoot), { fetchImpl: async () => response(feed) });

  assert.equal(scan.clusteringVersion, TREND_CLUSTERING_VERSION);
  assert.equal(scan.sourceStories.length, 2);
  assert.ok(scan.sourceStories.every((story) => story.storyFingerprint));
  assert.ok(scan.sourceStories.every((story) => story.clusterDiagnostics?.clusteringVersion === TREND_CLUSTERING_VERSION));
  assert.ok(scan.sourceStories.every((story) => story.clusterDiagnostics?.normalizedObject === 'suno v6'));
  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].sourceCount, 2);
  assert.equal(scan.items[0].storyFingerprint.normalizedObject, 'suno v6');
  assert.ok(scan.items[0].clusterDecisions[0].concreteAnchorMatches.includes('suno v6'));
});

test('event identity v2.1 does not treat ordinary case language as legal classification', () => {
  const fingerprint = storyFingerprint(sourceStory(
    "Apple's new CEO is reviving a Steve Jobs strategy from 25 years ago",
    "John Ternus made the case in his first keynote as Apple CEO that the iPhone isn't going anywhere.",
  ));

  assert.notEqual(fingerprint.eventType, 'lawsuit');
  assert.notEqual(fingerprint.canonicalAction, 'lawsuit');
  assert.notEqual(fingerprint.normalizedObject, 'lawsuit');
  assert.equal(fingerprint.concreteAnchors.includes('lawsuit'), false);
  assert.equal(fingerprint.concreteAnchors.some((anchor) => /^case\b/.test(anchor)), false);
});

test('event identity v2.1 does not treat consumer buy language as acquisition', () => {
  const fingerprint = storyFingerprint(sourceStory(
    "Kacey Musgraves' Middle of Nowhere Tour 2026: Here's Where to Buy Affordable Tickets Online",
    'Fans can buy tickets online for the tour.',
  ));

  assert.notEqual(fingerprint.eventType, 'acquisition');
  assert.notEqual(fingerprint.canonicalAction, 'acquires');
  assert.notEqual(fingerprint.normalizedObject, 'acquisition');
});

test('event identity v2.1 preserves buyer and target identity for true acquisitions', () => {
  const fingerprint = storyFingerprint(sourceStory(
    'Company A acquires Startup B for $500M',
    'Company A acquired Startup B in a transaction.',
  ));

  assert.equal(fingerprint.eventType, 'acquisition');
  assert.equal(fingerprint.canonicalAction, 'acquires');
  assert.match(fingerprint.normalizedObject, /company.*acquires.*startup b/i);
  assert.ok(fingerprint.concreteAnchors.some((anchor) => /company.*startup b/i.test(anchor)));
});

test('event identity v2.1 does not classify licensing or partnership deals as acquisitions', () => {
  const licensing = storyFingerprint(sourceStory(
    'Label A signs AI licensing deal with Company B',
    'The licensing deal covers AI music models.',
  ));
  const partnership = storyFingerprint(sourceStory(
    'Spotify signs strategic partnership with Company B',
    'The companies announced a partnership deal for creator tools.',
  ));

  assert.notEqual(licensing.eventType, 'acquisition');
  assert.notEqual(licensing.canonicalAction, 'acquires');
  assert.notEqual(partnership.eventType, 'acquisition');
  assert.notEqual(partnership.canonicalAction, 'acquires');
});

test('event identity v2.1 requires specific legal case identity before merging legal stories', () => {
  const suno = sourceStory(
    'UMG and Sony sue Suno over stream-ripping',
    'UMG and Sony filed a copyright infringement lawsuit against Suno over stream-ripping.',
  );
  const nore = sourceStory(
    'N.O.R.E. faces sexual-assault lawsuit',
    'A plaintiff filed a sexual-assault lawsuit against N.O.R.E.',
  );
  const niva = sourceStory(
    'NIVA files comments on DOJ Live Nation proposed settlement',
    'NIVA filed settlement comments about the DOJ and Live Nation proposed settlement.',
  );
  const wixen = sourceStory(
    'Wixen copyright case against Meta continues',
    'Wixen is pursuing a copyright case against Meta.',
  );
  const amazon = sourceStory(
    'Amazon faces FTC ad-auction case',
    'The FTC ad-auction antitrust case against Amazon remains active.',
  );

  assert.equal(eventClusterDecision(suno, nore).decision, 'separate-events');
  assert.equal(eventClusterDecision(suno, niva).decision, 'separate-events');
  assert.equal(eventClusterDecision(wixen, amazon).decision, 'separate-events');
  assert.equal(clusterSourceItems([suno, nore, niva, wixen, amazon]).length, 5);
});

test('event identity v2.1 merges same Wixen and Meta legal event across wording', () => {
  const one = sourceStory(
    'Federal judge dismisses Wixen copyright case against Meta',
    'A federal judge dismissed the Wixen copyright lawsuit against Meta.',
  );
  const two = sourceStory(
    'Meta wins dismissal of Wixen copyright complaint',
    'Meta won dismissal of Wixen copyright complaint in court.',
  );
  const decision = eventClusterDecision(one, two);

  assert.equal(decision.decision, 'same-event');
  assert.ok(decision.concreteAnchorMatches.includes('wixen meta copyright case'));
  assert.equal(clusterSourceItems([one, two]).length, 1);
});

test('event identity v2.1 rejects standalone generic legal and acquisition anchors', () => {
  const anchors = [
    ...storyFingerprint(sourceStory('Lawsuit', 'A case, complaint, settlement and appeal were mentioned.')).concreteAnchors,
    ...storyFingerprint(sourceStory('Acquisition', 'A deal, purchase and buy were mentioned.')).concreteAnchors,
  ];

  for (const generic of ['lawsuit', 'case', 'complaint', 'settlement', 'appeal', 'acquisition', 'deal', 'purchase', 'buy']) {
    assert.equal(anchors.includes(generic), false, `${generic} should not be a concrete anchor`);
  }
});

test('known Frankenstein trend pairs remain separate after corroboration path', () => {
  const pairs = [
    [
      sourceStory('Mateusz Smółka named Managing Director of Warner Music Eastern Europe', 'Warner Music appointed Mateusz Smółka as Managing Director of Warner Music Eastern Europe.'),
      sourceStory('German company becomes first in Europe to launch fully commercial orbital rocket', 'A German aerospace company launched a fully commercial orbital rocket in Europe.'),
    ],
    [
      sourceStory('Mateusz Smółka named Managing Director of Warner Music Eastern Europe', 'Warner Music appointed Mateusz Smółka as Managing Director of Warner Music Eastern Europe.'),
      sourceStory('Ye announces Chicago concert dates', 'Ye announced new Chicago concert activity and ticketing plans.'),
    ],
    [
      sourceStory('SOCAN sues Suno over copyrighted songs', 'SOCAN filed a copyright lawsuit against Suno in Canada.'),
      sourceStory('ABC sues FCC over broadcast ownership ruling', 'ABC filed a lawsuit against the FCC over a broadcast ownership policy ruling.'),
    ],
    [
      sourceStory('SOCAN sues Suno over copyrighted songs', 'SOCAN filed a copyright lawsuit against Suno in Canada.'),
      sourceStory('Enes Kanter files lawsuit over sports dispute', 'Enes Kanter filed a lawsuit related to a sports dispute.'),
    ],
    [
      sourceStory('AM Radio for Every Vehicle Act advances in Congress', 'The AM Radio for Every Vehicle Act advanced as a policy proposal.'),
      sourceStory('CD sales are booming among music fans', 'CD sales are rising again as physical music formats regain fans.'),
    ],
    [
      sourceStory('Wilson Pickett estate strikes deal with Primary Wave covering publishing catalog and name, image & likeness rights', 'The Wilson Pickett estate struck a rights deal with Primary Wave.'),
      sourceStory('Jazz singer Cassandra Wilson death reports corrected', 'Reports discussed Cassandra Wilson and online death misinformation.'),
    ],
    [
      sourceStory('Wilson Pickett estate strikes deal with Primary Wave covering publishing catalog and name, image & likeness rights', 'The Wilson Pickett estate struck a rights deal with Primary Wave.'),
      sourceStory('HarbourView acquires David Kershenbaum catalog including Tracy Chapman royalties', 'HarbourView acquired producer David Kershenbaum catalog interests, including royalties tied to Tracy Chapman and Supertramp.'),
    ],
  ];

  for (const [one, two] of pairs) {
    const decision = eventClusterDecision(one, two);
    assert.equal(decision.decision, 'separate-events', `${one.title} should not merge with ${two.title}`);
    assert.equal(clusterSourceItems([one, two]).length, 2);
  }
});

test('strong single-source story can become a top opportunity', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Suno pulls Mary J. Blige ad after false representative controversy',
      description: 'Suno says it contracted with someone who falsely represented themselves as Mary J. Blige representative. The controversy raises creator authorization, identity, impersonation and rights concerns.',
      link: 'https://example.test/suno-mary-j-blige',
    },
  ]);
  const scan = await scanTrendOpportunities(config(agentRoot), { fetchImpl: async () => response(feed) });

  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].sourceCount, 1);
  assert.equal(scan.items[0].evidenceLabel, 'Recent source');
  assert.ok(scan.items[0].certifydRelevanceScore >= 8);
});

test('generic Certifyd relevance copy does not pass as a specific high-confidence angle', () => {
  assert.equal(isGenericCertifydRelevance('This connects to Certifyd as infrastructure for identity, publishing, discovery and commerce.'), true);
  assert.equal(isGenericCertifydRelevance('This connects to SOCAN v Suno copyright litigation and creator permission records.'), false);
  const fingerprint = storyFingerprint(sourceStory('Gerencia 360 sues Suno', 'Gerencia 360 filed a copyright lawsuit against Suno.'));
  assert.equal(fingerprint.eventType, 'lawsuit-filed');
  assert.ok(fingerprint.primaryEntities.includes('Gerencia 360'));
  assert.ok(fingerprint.primaryEntities.includes('Suno'));
});

test('RSS retention keeps at least half of legally retainable unique source stories', async () => {
  const agentRoot = await tempAgentRoot();
  const stories = Array.from({ length: 10 }, (_, index) => ({
    title: `Creator commerce source story ${index}`,
    description: `Retainable summary about creator commerce, ownership and direct customer relationships ${index}.`,
    link: `https://example.test/creator-commerce-${index}`,
  }));
  const scan = await scanTrendOpportunities(config(agentRoot), { fetchImpl: async () => response(rssFeed(stories)) });

  assert.ok(scan.summary.storiesRetained >= 5);
  assert.equal(scan.summary.storiesRetained, scan.sourceStories.length);
  assert.ok(scan.sourceStories.every((story) => story.sourceUrl && story.summary));

  const retained = retainSourceStories(parseFeedItems(rssFeed(stories), { id: 'example', publisher: 'Example', feedUrl: 'https://example.test/feed.xml', categories: ['Creator Commerce'] }, 'https://example.test/feed.xml'), config(agentRoot));
  assert.ok(retained.length >= 5);
});

test('Qwen trend evaluation receives retained source facts and approved Brain relevance instructions', async () => {
  const agentRoot = await tempAgentRoot();
  const feed = rssFeed([
    {
      title: 'Creators build direct commerce through owned fan relationships',
      description: 'Creator economy teams are using direct sales, receipts and fan memberships to reduce platform dependency.',
      link: 'https://example.test/owned-fan-commerce',
    },
  ]);
  const cfg = config(agentRoot, { ollama: { enabled: true }, trendResearch: { qwenEvaluationEnabled: true } });
  let outboundPrompt = '';
  await scanTrendOpportunities(cfg, {
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/chat')) {
        const body = JSON.parse(init.body);
        outboundPrompt = body.messages.find((message) => message.role === 'user')?.content || '';
        return response(JSON.stringify({ message: { content: JSON.stringify({ recommended: true, suggestedTitle: 'Owned fan commerce', whyItMatters: 'The source connects to Certifyd direct commerce through approved Brain context.', certifydAngle: 'Certifyd can frame receipts, profiles and direct relationships as creator-owned business infrastructure.', riskFlags: [] }) } }), { contentType: 'application/json' });
      }
      return response(feed);
    },
  });

  assert.match(outboundPrompt, /Source facts from retained RSS\/Atom item metadata/);
  assert.match(outboundPrompt, /Approved Certifyd Brain context/);
  assert.match(outboundPrompt, /creator-controlled public profiles/i);
  assert.match(outboundPrompt, /Do not invent Certifyd partnerships/i);
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
