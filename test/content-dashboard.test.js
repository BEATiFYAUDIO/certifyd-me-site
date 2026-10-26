import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createContentDashboardServer, trendOpportunityTopicForIntake } from '../scripts/content-dashboard/server.js';
import { getDashboardConfig } from '../scripts/content-dashboard/config.js';
import { validateRunId, safeReturnPath } from '../scripts/content-dashboard/security.js';
import { AuditLogRepository, ContentDashboardActions } from '../scripts/content-dashboard/actions.js';
import { ContentBrainRepository } from '../scripts/content-dashboard/repository.js';
import { KNOWLEDGE_SUGGESTIONS, applyKnowledgeSuggestion, listPendingKnowledgeSuggestions } from '../scripts/content-dashboard/brain-suggestions.js';
import { GitHubPullRequestPublisher } from '../scripts/content-dashboard/publisher.js';
import { distributionPackageOverallStatus } from '../scripts/content-dashboard/distribution-package.js';
import { publicArticleBodyMarkdown } from '../scripts/content-dashboard/public-markdown.js';
import { buildDistributionAdapters, markdownToHtml } from '../scripts/content-dashboard/distribution-adapters.js';
import { BLOGGER_REDIRECT_URI } from '../scripts/content-dashboard/blogger-oauth.js';

const env = {
  ...process.env,
  CONTENT_DASHBOARD_ENABLED: 'true',
  CONTENT_DASHBOARD_SESSION_SECRET: 'test-secret-for-dashboard-tests',
  CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN: 'test-token',
  CONTENT_DASHBOARD_FOUNDER_EMAILS: 'founder@example.test',
  CONTENT_DASHBOARD_ALLOWED_ROLES: 'writer:writer@example.test;editor:editor@example.test;marketing:marketing@example.test;developer:developer@example.test;viewer:viewer@example.test',
  CONTENT_AGENT_ROOT: '/home/Darryl/Projects/contentbox/content-agent',
  CONTENT_DASHBOARD_DB_PATH: ':memory:',
};

async function withServer(fn, envOverride = {}) {
  const server = createContentDashboardServer({ config: getDashboardConfig({ ...env, ...envOverride }) });
  server.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  try { await fn(`http://127.0.0.1:${port}`); } finally { server.close(); }
}

async function login(base, email) {
  const response = await fetch(`${base}/app/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, token: 'test-token', returnTo: '/app/content/articles/core-explainer-001' }),
  });
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}

async function getCsrf(base, cookie) {
  const response = await fetch(`${base}/app/content/articles/core-explainer-001`, { headers: { cookie } });
  const html = await response.text();
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] || '';
}

test('1 unauthenticated dashboard users are redirected to login', async () => withServer(async (base) => {
  const response = await fetch(`${base}/app/content`, { redirect: 'manual' });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /^\/app\/login\?returnTo=/);
}));

test('2 login return path is preserved safely', async () => withServer(async (base) => {
  const response = await fetch(`${base}/app/login?returnTo=/app/content/brain`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /name="returnTo" value="\/app\/content\/brain"/);
  assert.equal(safeReturnPath('https://evil.test/app/content'), '/app/content');
}));

test('3 unauthorized authenticated-equivalent login is rejected', async () => withServer(async (base) => {
  const response = await fetch(`${base}/app/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'other@example.test', token: 'test-token', returnTo: '/app/content' }) });
  assert.equal(response.status, 403);
}));

test('4 founder can view dashboard', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /What needs attention\?/);
  assert.match(html, /Trending opportunities/);
  assert.match(html, /\/app\/content\/articles\?view=ideas/);
  assert.match(html, /Brain suggestions/);
  assert.match(html, /\/app\/content\/brain\?view=suggestions/);
  assert.match(html, /Recently Published/);
  assert.doesNotMatch(html, /What should Certifyd write about\?/);
  assert.doesNotMatch(html, /data-generating-form/);
  assert.doesNotMatch(html, /Clarify Certifyd Core responsibilities/);
  assert.doesNotMatch(html, /Article Management/);
  assert.doesNotMatch(html, /Review Queue/);
}));

test('4a recent activity shows the run summary date', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-recent-date-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runDir = path.join(outputDir, 'dated-recent-activity-mu123abc');
  await fs.mkdir(path.join(runDir, 'final'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'knowledge/facts'), { recursive: true });
  await fs.writeFile(path.join(runDir, 'publication-manifest.json'), JSON.stringify({
    title: 'Dated Recent Activity',
    slug: 'dated-recent-activity',
    currentStatus: 'PUBLISHING',
    publishability: 'PUBLISHING_DEPLOYMENT',
    updatedAt: '2026-09-19T14:00:00.000Z',
  }, null, 2));
  await fs.writeFile(path.join(runDir, 'final/article.json'), JSON.stringify({
    title: 'Dated Recent Activity',
    slug: 'dated-recent-activity',
    version: 'v1',
  }, null, 2));

  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Recent Activity/);
    assert.match(html, /Dated Recent Activity/);
    assert.match(html, /2026-09-19/);
    assert.doesNotMatch(html, /Dated Recent Activity[\s\S]{0,300}No date/);
  }, { CONTENT_AGENT_ROOT: tmpRoot, CONTENT_AGENT_OUTPUT_DIR: outputDir });
});

test('4b article workspace owns AI generation and trending opportunities', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/articles?view=ideas`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Blog Engine/);
  assert.match(html, /Article workspace/);
  assert.match(html, /What should Certifyd write about\?/);
  assert.match(html, /data-primary-generation-form/);
  assert.match(html, /action="\/app\/content\/actions\/generate"/);
  assert.match(html, /Generate Article/);
  assert.match(html, /Trending Opportunities/);
  assert.match(html, /Recent Source Stories/);
  assert.match(html, /No live trend scan has been saved yet/);
  assert.match(html, /Music/);
  assert.match(html, /Creator Economy/);
  assert.doesNotMatch(html, /Generation frozen/);
}));

test('4bd generation action starts background job when requested', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-bg-generation-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await fs.mkdir(path.join(tmpRoot, 'knowledge/facts'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'knowledge/products'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'knowledge/facts/approved-public-claims.md'), [
    '# Approved Public Claims',
    '',
    'Certifyd Core is the foundational engine for identity, publishing and direct commerce.',
    'Certifyd connects publishing, discovery, and direct creator-to-fan commerce.',
  ].join('\n'));
  await fs.writeFile(path.join(tmpRoot, 'knowledge/products/core.md'), [
    '# Certifyd Core',
    '',
    'Certifyd Core runs locally for creator and operator workflows.',
  ].join('\n'));
  await withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const csrf = await getCsrf(base, cookie);
  const response = await fetch(`${base}/app/content/actions/generate`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: csrf,
      provider: 'deterministic',
      topic: 'Core background generation',
      audience: 'Creators',
      objective: 'Explain Core with approved Brain context.',
      contentType: 'article',
    }),
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') || '', /^\/app\/content\/generation\//);
  }, {
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
  });
});


test('4ba article ideas separate recommended opportunities from retained source stories', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-trends-view-'));
  const trendDir = path.join(tmpRoot, 'dashboard', 'trends');
  await fs.mkdir(trendDir, { recursive: true });
  const sourceItems = Array.from({ length: 15 }, (_, index) => ({
    id: `source-${index + 1}`,
    title: `Retained Source Story ${index + 1}`,
    publisher: index % 2 ? 'TechCrunch' : 'Music Business Worldwide',
    articleUrl: `https://example.test/story-${index + 1}`,
    sourceUrl: 'https://example.test/feed.xml',
    publishedAt: index === 0 ? '2026-08-01T16:00:00.000Z' : `2026-07-${String(31 - (index % 3)).padStart(2, '0')}T12:00:00.000Z`,
    retrievedAt: '2026-08-02T15:24:00.000Z',
    categories: index % 2 ? ['Technology'] : ['Music'],
    summary: `Summary for retained source story ${index + 1}`,
    sourceType: 'rss',
  }));
  const opportunities = Array.from({ length: 13 }, (_, index) => ({
    id: `opp-${index + 1}`,
    title: `Recommended Opportunity ${index + 1}`,
    category: index % 2 ? 'Technology' : 'Music',
    categories: index % 2 ? ['Technology'] : ['Music'],
    summary: `Opportunity summary ${index + 1}`,
    whyTrending: 'Source activity detected.',
    whyItMattersToCertifyd: 'This connects to Certifyd creator infrastructure.',
    sourceItemIds: [`source-${index + 1}`],
    sourceUrls: [`https://example.test/story-${index + 1}`],
    originalSources: [{ sourceTitle: `Retained Source Story ${index + 1}`, publisher: index % 2 ? 'TechCrunch' : 'Music Business Worldwide', publishedAt: sourceItems[index].publishedAt, sourceUrl: `https://example.test/story-${index + 1}` }],
    sourceCount: 1,
    sourcePublishers: [index % 2 ? 'TechCrunch' : 'Music Business Worldwide'],
    newestSourceDate: sourceItems[index].publishedAt,
    brainCoverage: 'Strong',
    riskFlags: [],
    evidenceLabel: 'Recent source',
  }));
  await fs.writeFile(path.join(trendDir, 'trend-state.json'), JSON.stringify({
    provider: 'rss',
    lastScannedAt: '2026-08-02T15:24:00.000Z',
    summary: { provider: 'rss', sourcesChecked: 4, sourceFailures: 0, storiesCollected: 90, storiesRetained: 15, opportunitiesCreated: 13 },
    sourceItems,
    opportunities,
    providerStatus: [{ id: 'techcrunch', publisher: 'TechCrunch', status: 'available', itemCount: 30, latestPublishedAt: '2026-08-01T16:00:00.000Z', latestFetchAt: '2026-08-02T15:24:00.000Z' }],
    errors: [],
    dismissed: [],
    savedIdeas: [],
  }, null, 2));
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/articles?view=ideas`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /4 sources checked/);
    assert.match(html, /90 collected/);
    assert.match(html, /15 retained/);
    assert.match(html, /13 recommended/);
    assert.match(html, /0 failures/);
    assert.match(html, /Last scan:/);
    assert.match(html, /Trending Opportunities/);
    assert.match(html, /13 recommended/);
    assert.match(html, /Recent Source Stories/);
    assert.match(html, /Retained Source Story 15/);
    assert.match(html, /Retained Source Story 15[\s\S]*Generate Article/);
    assert.match(html, /In recommended opportunity/);
    assert.match(html, /Source publication time is separate from fetched time/);
    assert.match(html, /Retention:/);
    assert.match(html, /Grouped into recommended opportunity/);
    assert.match(html, /Recommended Opportunity 13[\s\S]*Generate Article/);
    assert.match(html, /Read original ↗/);
    assert.match(html, /https:\/\/example\.test\/story-1/);
    assert.match(html, /<summary class="ghost">View sources<\/summary>/);
    assert.ok(html.indexOf('Recommended Opportunity 13') < html.indexOf('View sources'));
    assert.ok(html.indexOf('View sources') < html.indexOf('Recent Source Stories'));
    const jsonResponse = await fetch(`${base}/app/content/trends.json`, { headers: { cookie } });
    assert.equal(jsonResponse.status, 200);
    const trends = await jsonResponse.json();
    assert.equal(trends.items.length, 13);
    assert.equal(trends.sourceStories.length, 15);
    assert.equal(trends.summary.storiesCollected, 90);
    assert.equal(trends.sourceStories[0].retentionStatus, 'Recommended');
  }, { CONTENT_AGENT_ROOT: tmpRoot });
});

test('4baa trend opportunity intake keeps normal topics unchanged', () => {
  const topic = 'Write about creator-owned music infrastructure';
  assert.equal(trendOpportunityTopicForIntake({ topic, title: 'Creator infrastructure' }), topic);
});

test('4bab trend opportunity intake bounds long source-derived topics while preserving source headline metadata', () => {
  const fullSourceHeadline = 'US musicians’ union files opposition to Universal and Warner motions to dismiss, saying members’ recordings were ‘fed into AI systems for commercial exploitation’';
  const opportunity = {
    title: 'US musicians’ union files opposition to Universal and Warner motions to dismiss, saying members’ recordings were ‘fed i…',
    topic: `${'Write a Certifyd article about: '}US musicians’ union files opposition to Universal and Warner motions to dismiss, saying members’ recordings were ‘fed i…. Use this angle: This connects to AI-era permissions, rights clearance, attribution, creator opt-in and provenance around inputs, outputs and derivative works.`,
    originalSources: [{
      id: 'src-f2ac98953c46e3ea',
      sourceTitle: fullSourceHeadline,
      title: fullSourceHeadline,
      publisher: 'Music Business Worldwide',
    }],
  };
  const intakeTopic = trendOpportunityTopicForIntake(opportunity);
  assert.equal(intakeTopic, fullSourceHeadline);
  assert.ok(intakeTopic.length <= 300);
  assert.equal(opportunity.originalSources[0].sourceTitle, fullSourceHeadline);
  assert.equal(opportunity.originalSources[0].publisher, 'Music Business Worldwide');
});

test('4bac trend opportunity intake truncates oversized fallback topics at a word boundary where possible', () => {
  const longHeadline = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
  const intakeTopic = trendOpportunityTopicForIntake({
    topic: `Write a Certifyd article about: ${longHeadline}. Use this angle: ${longHeadline}`,
    originalSources: [{ sourceTitle: longHeadline }],
  });
  assert.ok(intakeTopic.length <= 300);
  assert.match(intakeTopic, /…$/);
  const finalToken = intakeTopic.slice(0, -1).split(' ').at(-1);
  assert.ok(longHeadline.split(' ').includes(finalToken));
});

test('4bab retained source stories show existing draft instead of duplicate generation', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-source-drafts-'));
  const trendDir = path.join(tmpRoot, 'dashboard', 'trends');
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await fs.mkdir(trendDir, { recursive: true });
  await fs.writeFile(path.join(trendDir, 'trend-state.json'), JSON.stringify({
    provider: 'rss',
    lastScannedAt: '2026-08-02T15:24:00.000Z',
    summary: { provider: 'rss', sourcesChecked: 1, sourceFailures: 0, storiesCollected: 2, storiesRetained: 2, opportunitiesCreated: 0 },
    sourceItems: [
      { id: 'source-existing', title: 'Existing source draft story', publisher: 'TechCrunch', articleUrl: 'https://example.test/existing', publishedAt: '2026-08-01T12:00:00.000Z', categories: ['Technology'], summary: 'Existing story summary.', certifydRelevanceScore: 10 },
      { id: 'source-new', title: 'New retained source story', publisher: 'Music Business Worldwide', articleUrl: 'https://example.test/new', publishedAt: '2026-08-01T13:00:00.000Z', categories: ['Music'], summary: 'New story summary.', certifydRelevanceScore: 4 },
    ],
    opportunities: [],
    providerStatus: [],
    errors: [],
    dismissed: [],
    savedIdeas: [],
  }, null, 2));
  await createMinimalRun(path.join(outputDir, 'existing-source-run'), {
    title: 'Existing source draft story',
    status: 'PENDING_FOUNDER_REVIEW',
    research: { trendProvenance: { sourceItemIds: ['source-existing'] } },
  });

  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/articles?view=ideas`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Existing source draft story[\s\S]*Draft exists[\s\S]*Open draft/);
    assert.match(html, /New retained source story[\s\S]*Low Certifyd relevance[\s\S]*Generate Article/);
    assert.equal((html.match(/class="source-story-actions"[\s\S]*?action="\/app\/content\/actions\/generate"/g) || []).length, 1);
  }, { CONTENT_AGENT_ROOT: tmpRoot });
});


test('4bac retained source generation returns existing draft instead of duplicating', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-source-duplicate-action-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await createMinimalRun(path.join(outputDir, 'existing-source-run'), {
    title: 'Existing source draft story',
    status: 'PENDING_FOUNDER_REVIEW',
    research: { trendProvenance: { sourceItemIds: ['source-existing'] } },
  });
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const form = new FormData();
  form.set('provider', 'deterministic');
  form.set('topic', 'Write a Certifyd article about an existing source');
  form.set('audience', 'Creators, partners and investors');
  form.set('objective', 'Create a grounded Certifyd article using approved Brain context.');
  form.set('trendSourceItemIds', 'source-existing');

  const result = await actions.generateDraft({ actor: { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' }, form });

  assert.equal(result.runId, 'existing-source-run');
  assert.match(result.output, /Draft already exists/);
  assert.equal((await fs.readdir(outputDir)).length, 1);
});

test('4bb article workspace shows direct-published deployment records', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-published-view-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await createMinimalRun(path.join(outputDir, 'legacy-direct-publish-001'), {
    title: 'Legacy Direct Publish',
    slug: 'legacy-direct-publish',
    status: 'PUBLISHING',
    publishability: 'PUBLISHING_DEPLOYMENT',
  });
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/articles?view=published`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Legacy Direct Publish/);
    assert.doesNotMatch(html, /No articles match this view/);
  }, {
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
  });
});

test('4bc article workspace shows generation Brain diagnostics', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-generation-diagnostics-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await createMinimalRun(path.join(outputDir, 'diagnostics-run-001'), {
    title: 'Musi Legal Action',
    slug: 'musi-legal-action',
    research: {
      selectedEvidence: [approvedBrainRecord({ id: 'brain:capabilities/commerce', title: 'Commerce', path: 'content-agent/knowledge/capabilities/commerce.md' })],
      claimsThatMustNotBeMade: [],
      generationDiagnostics: {
        brainSourcesScanned: 18,
        brainRecordsSelected: [{
          id: 'brain:capabilities/commerce',
          title: 'Commerce',
          path: 'content-agent/knowledge/capabilities/commerce.md',
          selectionReason: 'matches Commerce and payments; score 12',
        }],
        brainRecordsSentToModel: [{
          id: 'brain:capabilities/commerce',
          title: 'Commerce',
          path: 'content-agent/knowledge/capabilities/commerce.md',
        }],
        relevantApprovedClaims: [{
          id: 'brain:capabilities/commerce',
          title: 'Commerce',
          excerpt: 'Certifyd supports direct creator commerce context.',
        }],
        externalArticleSourcesUsed: [{
          title: 'Musi legal action story',
          publisher: 'Music Business Worldwide',
          publishedAt: '2026-08-10',
          articleUrl: 'https://example.test/musi-story',
        }],
        exactBrainContextSentToModel: {
          approvedKnowledge: [{
            id: 'brain:capabilities/commerce',
            theme: 'Commerce and payments',
            excerpt: 'Certifyd supports direct creator commerce context.',
          }],
        },
        contextSize: {
          totalPromptChars: 4200,
          finalContextChars: 3900,
          truncated: false,
        },
      },
    },
  });
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/articles/diagnostics-run-001`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Generation diagnostics/);
    assert.match(html, /Brain records selected/);
    assert.match(html, /Brain records actually sent/);
    assert.match(html, /Exact Brain context sent to AI/);
    assert.match(html, /Music Business Worldwide/);
    assert.match(html, /https:\/\/example\.test\/musi-story/);
  }, {
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
  });
});

test('4c Brain suggestions live in the Brain workspace', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/brain?view=suggestions`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Knowledge Suggestions/);
  assert.match(html, /Founder-reviewed Brain updates/);
  assert.match(html, /Approve/);
  assert.match(html, /Reject/);
}));

test('4ca approved Brain suggestion changes Brain, closes pending and writes audit history', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-brain-approve-'));
  await fs.mkdir(path.join(tmpRoot, 'knowledge', 'facts'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'knowledge', 'facts', 'approved-public-claims.md'), '# Approved Public Claims\n\nAPPROVED\n');
  const config = getDashboardConfig({ ...env, CONTENT_AGENT_ROOT: tmpRoot, CONTENT_AGENT_OUTPUT_DIR: path.join(tmpRoot, 'engine', 'outputs'), CONTENT_DASHBOARD_DB_PATH: ':memory:' });
  const brainRepo = new ContentBrainRepository(config);
  const audit = new AuditLogRepository(config);
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const suggestion = KNOWLEDGE_SUGGESTIONS.find((item) => item.operation === 'new');

  const result = await applyKnowledgeSuggestion({ config, brainRepo, audit, actor, suggestionId: suggestion.id, decision: 'approve' });
  assert.equal(result.decision, 'approve');
  assert.equal(result.changedRecord.name, suggestion.targetPath);
  const text = await fs.readFile(path.join(tmpRoot, 'knowledge', suggestion.targetPath), 'utf8');
  assert.match(text, /APPROVED/);
  assert.match(text, /creator ownership/i);
  const pending = await listPendingKnowledgeSuggestions(config);
  assert.equal(pending.some((item) => item.id === suggestion.id), false);
  const state = JSON.parse(await fs.readFile(path.join(tmpRoot, 'dashboard', 'brain-suggestions.json'), 'utf8'));
  assert.equal(state.history[0].suggestionId, suggestion.id);
  assert.equal(state.history[0].decision, 'approve');
  const auditLog = await fs.readFile(path.join(tmpRoot, 'review', 'dashboard-audit.log.jsonl'), 'utf8');
  assert.match(auditLog, /brain_suggestion_approve/);
});

test('4cb rejected Brain suggestion closes without changing Brain', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-brain-reject-'));
  await fs.mkdir(path.join(tmpRoot, 'knowledge', 'facts'), { recursive: true });
  const target = path.join(tmpRoot, 'knowledge', 'facts', 'approved-public-claims.md');
  await fs.writeFile(target, '# Approved Public Claims\n\nAPPROVED\n');
  const before = await fs.readFile(target, 'utf8');
  const config = getDashboardConfig({ ...env, CONTENT_AGENT_ROOT: tmpRoot, CONTENT_AGENT_OUTPUT_DIR: path.join(tmpRoot, 'engine', 'outputs'), CONTENT_DASHBOARD_DB_PATH: ':memory:' });
  const brainRepo = new ContentBrainRepository(config);
  const audit = new AuditLogRepository(config);
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const suggestion = KNOWLEDGE_SUGGESTIONS.find((item) => item.operation === 'update');

  const result = await applyKnowledgeSuggestion({ config, brainRepo, audit, actor, suggestionId: suggestion.id, decision: 'reject' });
  assert.equal(result.decision, 'reject');
  assert.equal(result.changedRecord, null);
  assert.equal(await fs.readFile(target, 'utf8'), before);
  const pending = await listPendingKnowledgeSuggestions(config);
  assert.equal(pending.some((item) => item.id === suggestion.id), false);
});

test('4cc Blog Engine page order follows prompt, trends, workflow and library hierarchy', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/articles?view=ideas`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  const order = [
    'A. What should Certifyd write about?',
    'B. Trending Opportunities',
    'C. Drafts / In Review',
    'D. Article Library',
  ].map((needle) => html.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), `missing section in ${order.join(',')}`);
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3]);
  assert.doesNotMatch(html, /Advanced options[\s\S]*Source restrictions/);
}));

test('5 founder can see explicit approval control for a pending article', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/review/core-explainer-001`, { headers: { cookie } });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Approve/);
  assert.match(html, /Approval requires founder permission/);
}));

test('6 non-founder cannot approve', async () => withServer(async (base) => {
  const cookie = await login(base, 'editor@example.test');
  const csrf = await getCsrf(base, cookie);
  const response = await fetch(`${base}/app/content/actions/review/approve`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, runId: 'core-explainer-001', version: 'v1', confirm: 'true' }) });
  assert.equal(response.status, 403);
}));

test('7 approval requires exact current version', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const csrf = await getCsrf(base, cookie);
  const response = await fetch(`${base}/app/content/actions/review/approve`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, runId: 'core-explainer-001', version: 'v999', confirm: 'true' }) });
  assert.equal(response.status, 409);
}));

test('8 approval fails without explicit confirmation', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const csrf = await getCsrf(base, cookie);
  const response = await fetch(`${base}/app/content/actions/review/approve`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, runId: 'core-explainer-001', version: 'v1' }) });
  assert.equal(response.status, 400);
}));

test('8b approval fails when blocking claims remain', async () => {
  const actions = new ContentDashboardActions(getDashboardConfig(env));
  actions.runs = {
    readRun: async () => ({ summary: { version: 'v1', unresolvedIssueCount: 1 } }),
  };
  actions.runEngine = async () => {
    throw new Error('approval should not reach the engine');
  };

  await assert.rejects(
    actions.approve({
      actor: { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' },
      runId: 'core-explainer-001',
      version: 'v1',
      confirm: 'true',
    }),
    /Blocking claims must be resolved/,
  );
});

test('8c approval fails without approved Brain context', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-no-brain-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'no-brain-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'No Brain Test',
    slug: 'no-brain-test',
    status: 'PENDING_FOUNDER_REVIEW',
    publishability: 'NEEDS_FOUNDER_REVIEW',
    selectedEvidence: [],
  });
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  await assert.rejects(
    actions.approve({
      actor: { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' },
      runId,
      version: 'v1',
      confirm: 'true',
    }),
    /Approved Brain context is required/,
  );
});

test('9 writer can access create draft action page path but cannot approve', async () => withServer(async (base) => {
  const cookie = await login(base, 'writer@example.test');
  const response = await fetch(`${base}/app/content/articles`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /What should Certifyd write about\?/);
  assert.match(html, /Generate Article/);
  assert.match(html, /Check AI/);
  assert.doesNotMatch(html, /Generation frozen/);
  assert.doesNotMatch(html, /<button class="primary" type="submit">Approve<\/button>/);
}));

test('10 editor can request revision control', async () => withServer(async (base) => {
  const cookie = await login(base, 'editor@example.test');
  const response = await fetch(`${base}/app/content/articles/core-explainer-001`, { headers: { cookie } });
  assert.match(await response.text(), /Request Revision|Open Review/);
}));

test('11 marketing cannot access Brain facts', async () => withServer(async (base) => {
  const cookie = await login(base, 'marketing@example.test');
  const response = await fetch(`${base}/app/content/brain`, { headers: { cookie } });
  assert.equal(response.status, 403);
}));

test('12 dashboard settings never expose API keys or secrets', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/settings`, { headers: { cookie } });
  const html = await response.text();
  assert.doesNotMatch(html, /CONTENT_MODEL_API_KEY|test-secret|test-token/);
}));

test('12b GitHub publishing can configure a Vassal preview mirror', () => {
  const config = getDashboardConfig({
    ...env,
    CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED: 'true',
    CONTENT_DASHBOARD_GITHUB_OWNER: 'BEATiFYAUDIO',
    CONTENT_DASHBOARD_GITHUB_REPO: 'certifyd-me-site',
    CONTENT_DASHBOARD_GITHUB_TOKEN: 'test-token',
    CONTENT_DASHBOARD_GITHUB_MIRROR_ENABLED: 'true',
    CONTENT_DASHBOARD_GITHUB_MIRROR_REPO: 'certifyd-me-site-preview',
    CONTENT_DASHBOARD_GITHUB_MIRROR_PUBLIC_URL: 'https://vassal.certifyd.me/',
  });
  assert.equal(config.githubPublishing.mirrors.length, 1);
  assert.equal(config.githubPublishing.mirrors[0].owner, 'BEATiFYAUDIO');
  assert.equal(config.githubPublishing.mirrors[0].repo, 'certifyd-me-site-preview');
  assert.equal(config.githubPublishing.mirrors[0].publicUrl, 'https://vassal.certifyd.me');
  assert.deepEqual(config.githubPublishing.mirrors[0].excludePaths, ['index.html']);
});

test('13 dashboard does not return absolute engine paths in settings', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/settings`, { headers: { cookie } });
  assert.doesNotMatch(await response.text(), /\/home\/Darryl\/Projects\/contentbox\/content-agent\/engine\/outputs/);
}));

test('14 invalid run IDs are rejected', () => {
  assert.throws(() => validateRunId('../secret'));
});

test('15 directory traversal attempts are rejected at route boundary', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/articles/..%2Fsecret`, { headers: { cookie } });
  assert.equal(response.status, 400);
}));

test('16 article preview renders Markdown behind auth', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/articles/core-explainer-001/preview`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Internal preview/);
}));

test('17 unsafe HTML is not executable in preview rendering', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/articles/core-explainer-001/preview`, { headers: { cookie } });
  assert.doesNotMatch(await response.text(), /<script>/i);
}));

test('18 generation provider status is labelled accurately', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content`, { headers: { cookie } });
  assert.match(await response.text(), /OpenAI configured|OpenAI not configured|Deterministic Fallback|Unavailable/);
}));

test('19 Blog package preparation remains visibly blocked before approval', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/publishing`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Approved|No articles match this view|Ready to publish/);
}));

test('20 approved articles can become READY_TO_PUBLISH locally', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-run-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'local-approval-001';
  const runDir = path.join(outputDir, runId);
  await fs.mkdir(path.join(runDir, 'final'), { recursive: true });
  await fs.writeFile(path.join(runDir, 'intake.json'), JSON.stringify({ workingTitle: 'Local Approval Test', targetAudience: 'Investors', primaryTopic: 'Certifyd Blog' }));
  await fs.writeFile(path.join(runDir, 'publication-manifest.json'), JSON.stringify({ title: 'Local Approval Test', slug: 'local-approval-test', currentStatus: 'PENDING_FOUNDER_REVIEW', publishability: 'NEEDS_FOUNDER_REVIEW' }));
  await fs.writeFile(path.join(runDir, 'final', 'article.json'), JSON.stringify({ title: 'Local Approval Test', slug: 'local-approval-test', version: 'v1' }));
  await fs.writeFile(path.join(runDir, 'final', 'article.md'), '---\ntitle: "Local Approval Test"\n---\n\n# Local Approval Test\n\nBody.');
  await fs.writeFile(path.join(runDir, 'claim-ledger.json'), JSON.stringify({ claims: [{ text: 'Safe claim', status: 'APPROVED' }] }));
  await fs.writeFile(path.join(runDir, 'research-record.json'), JSON.stringify({ selectedEvidence: [approvedBrainRecord()], claimsThatMustNotBeMade: [] }));

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  const approved = await actions.approve({ actor, runId, version: 'v1', confirm: 'true' });
  assert.match(approved.output, /Approved/);
  let manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'FOUNDER_APPROVED');
  assert.equal(manifest.publishability, 'APPROVED_READY');

  const prepared = await actions.preparePublishing({ actor, runId });
  assert.match(prepared.output, /https:\/\/certifyd\.me\/blog\/local-approval-test\//);
  manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'READY_TO_PUBLISH');
  assert.equal(manifest.publishability, 'READY_TO_PUBLISH');
  const plan = JSON.parse(await fs.readFile(path.join(runDir, 'distribution', 'distribution-plan.json'), 'utf8'));
  assert.equal(plan.primaryTarget.channel, 'Certifyd Blog');
  assert.equal(plan.primaryTarget.repositoryPath, 'content/blog/local-approval-test.md');

  const validated = await actions.validatePublishing({ actor, runId });
  assert.match(validated.output, /Publishing package is ready/);
});

test('20aa publishing preparation removes review-only footer from public artifacts', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-public-boundary-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'review-footer-boundary-001';
  const runDir = path.join(outputDir, runId);
  const markdown = [
    '---',
    'title: "Review Footer Boundary"',
    '---',
    '',
    '# Review Footer Boundary',
    '',
    'This public paragraph should remain intact.',
    '',
    '> Draft generated for founder review. Not approved for publishing.',
    '',
    'This public closing paragraph should also remain intact.',
  ].join('\n');
  await createMinimalRun(runDir, {
    title: 'Review Footer Boundary',
    slug: 'review-footer-boundary',
    status: 'FOUNDER_APPROVED',
    publishability: 'APPROVED_READY',
    markdown,
  });
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  await actions.preparePublishing({ actor, runId });

  const finalMarkdown = await fs.readFile(path.join(runDir, 'final', 'article.md'), 'utf8');
  const blogMarkdown = await fs.readFile(path.join(runDir, 'blog', 'blog-post.md'), 'utf8');
  const blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  for (const value of [finalMarkdown, blogMarkdown, blogPackage.body]) {
    assert.doesNotMatch(value, /Draft generated for founder review/i);
    assert.doesNotMatch(value, /Not approved for publishing/i);
    assert.match(value, /This public paragraph should remain intact/);
    assert.match(value, /This public closing paragraph should also remain intact/);
  }
});

test('20a publishing validation fails without approved Brain context', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-no-brain-publish-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'no-brain-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'No Brain Publish',
    slug: 'no-brain-publish',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    selectedEvidence: [],
  });
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  await assert.rejects(
    actions.validatePublishing({ actor: { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' }, runId }),
    /Approved Brain context is required/,
  );
});

test('20ab distribution reports connector status without returning credentials', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-distribution-status-'));
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: path.join(tmpRoot, 'engine', 'outputs'),
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
    CONTENT_DISTRIBUTION_DEVTO_API_KEY: 'server-side-secret',
  }));
  const overview = await actions.distributionOverview();
  const devto = overview.destinations.find((item) => item.id === 'devto');
  const wordpress = overview.destinations.find((item) => item.id === 'wordpress');
  const linkedin = overview.destinations.find((item) => item.id === 'linkedin');
  assert.equal(devto.status, 'configured');
  assert.equal(wordpress.status, 'not_connected');
  assert.equal(linkedin.status, 'not_connected');
  assert.doesNotMatch(JSON.stringify(overview), /server-side-secret/);
});

test('20ac disconnected destination skips without blocking manual export distribution', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-distribution-isolation-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'distribution-ready-001';
  await createMinimalRun(path.join(outputDir, runId), {
    title: 'Distribution Ready',
    slug: 'distribution-ready',
    status: 'PUBLISHED',
    publishability: 'PUBLISHED',
  });
  await markVerifiedRun(path.join(outputDir, runId));
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const result = await actions.distributeArticle({
    actor: { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' },
    runId,
    version: 'v1',
    destinations: ['devto', 'markdown'],
  });
  assert.equal(result.results.find((item) => item.id === 'devto').status, 'skipped');
  assert.equal(result.results.find((item) => item.id === 'markdown').status, 'manual_export_ready');
  const state = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'destinations.json'), 'utf8'));
  assert.equal(state.destinations.devto.status, 'skipped');
  assert.equal(state.destinations.markdown.status, 'manual_export_ready');
});

test('20aca API-backed distribution preflights payload and blocks uncertain retry', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-distribution-preflight-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'distribution-api-preflight-001';
  await createMinimalRun(path.join(outputDir, runId), {
    title: 'API Preflight Article',
    slug: 'api-preflight-article',
    status: 'PUBLISHED',
    publishability: 'PUBLISHED',
    markdown: '# API Preflight Article\n\nCreator commerce publishing body.',
  });
  await markVerifiedRun(path.join(outputDir, runId));
  const previousFetch = globalThis.fetch;
  let postCalls = 0;
  globalThis.fetch = async () => {
    postCalls += 1;
    return new Response('maybe accepted before timeout', { status: 524, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const actions = new ContentDashboardActions(getDashboardConfig({
      ...env,
      CONTENT_AGENT_ROOT: tmpRoot,
      CONTENT_AGENT_OUTPUT_DIR: outputDir,
      CONTENT_DASHBOARD_DB_PATH: ':memory:',
      CONTENT_DISTRIBUTION_DEVTO_API_KEY: 'devto-test-key',
    }));
    const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
    await fs.mkdir(path.join(tmpRoot, 'dashboard'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'dashboard', 'distribution-connections.json'), JSON.stringify({ devto: { status: 'connected', testedAt: new Date().toISOString() } }));

    const first = await actions.distributeArticle({ actor, runId, version: 'v1', destinations: ['devto'] });
    assert.equal(first.results[0].status, 'uncertain');
    let state = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'destinations.json'), 'utf8'));
    assert.equal(state.destinations.devto.status, 'uncertain');
    assert.equal(state.destinations.devto.uncertainAcceptance, true);
    assert.equal(state.destinations.devto.approvedPayload.destination, 'devto');
    assert.equal(state.destinations.devto.approvedPayload.canonicalUrl, 'https://certifyd.me/blog/api-preflight-article/');
    assert.equal(postCalls, 1);

    await assert.rejects(actions.distributeArticle({ actor, runId, version: 'v1', destinations: ['devto'], retryFailed: true }), /Uncertain outcomes must be reconciled first/);
    state = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'destinations.json'), 'utf8'));
    assert.equal(state.destinations.devto.uncertainAcceptance, true);
    assert.equal(postCalls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('20ad distribution package generation, edits and statuses persist without changing other destinations', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-distribution-package-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'distribution-package-001';
  await createMinimalRun(path.join(outputDir, runId), {
    title: 'Jason Isbell, Suno and Artist Identity',
    slug: 'jason-isbell-suno-ai-artist-identity',
    status: 'PUBLISHED',
    publishability: 'PUBLISHED',
    coverImage: '/images/blog/jason-isbell-suno-ai-artist-identity-1788708178378.png',
    excerpt: 'Existing legal rights and identity rights are one layer, while digital systems still need machine-readable identity, provenance, authority and permission.',
    markdown: '# Jason Isbell, Suno and Artist Identity\n\nExisting legal rights and identity rights are one layer, while digital systems still need machine-readable identity, provenance, authority and permission.\n\nFor creators, the practical consequence is not just whether AI threatens artists. It is whether identity, provenance and permission can travel with work when platforms and automated systems touch it.\n\nThe Certifyd angle is narrow: creator infrastructure needs public context that can distinguish official identity, authority and permission without replacing the legal rights layer.',
  });
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  await actions.generateDistributionCopy({ actor, runId });
  let pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.match(pkg.linkedin.text, /machine-readable identity, provenance, authority and permission/);
  assert.ok(pkg.x.characterCount <= 280);
  assert.equal(pkg.linkedin.status, 'draft');
  assert.equal(pkg.coverImage, '/images/blog/jason-isbell-suno-ai-artist-identity-1788708178378.png');
  assert.equal(pkg.instagram.asset.width, 1080);
  assert.equal(pkg.instagram.asset.height, 1350);
  assert.equal(pkg.instagram.asset.aspectRatio, '4:5');
  assert.deepEqual(pkg.instagram.asset.safeZone.profileGridCrop, { x: 0, y: 135, width: 1080, height: 1080 });
  assert.deepEqual(pkg.instagram.asset.safeZone.criticalContent, { x: 120, y: 255, width: 840, height: 840, padding: 120 });
  assert.equal(pkg.instagram.asset.sourceImage, pkg.coverImage);
  assert.equal(pkg.instagram.asset.outputImage, '');
  assert.equal(pkg.channelAssets.canonicalBlog.outputImage, pkg.coverImage);
  assert.equal(pkg.channelAssets.instagram.sourceImage, pkg.coverImage);
  assert.equal(pkg.channelAssets.facebook.aspectRatio, '1.91:1');
  assert.equal(pkg.channelAssets.x.aspectRatio, '16:9');
  const originalX = pkg.x.text;
  const originalInstagramCaption = pkg.instagram.caption;

  await actions.saveDistributionCopy({ actor, runId, destinationId: 'linkedin', fields: { text: 'Edited LinkedIn copy.' } });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.equal(pkg.linkedin.text, 'Edited LinkedIn copy.');
  assert.equal(pkg.x.text, originalX);
  assert.equal(pkg.instagram.caption, originalInstagramCaption);

  await assert.rejects(
    actions.markDistributionCopyStatus({ actor, runId, destinationId: 'linkedin', status: 'sent' }),
    /Run preflight and approve before sending/,
  );
  await actions.preflightDistributionCopy({ actor, runId, destinationId: 'linkedin' });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.equal(pkg.linkedin.status, 'ready_for_review');
  assert.equal(pkg.linkedin.preflight.ok, true);
  assert.match(pkg.linkedin.preflight.warnings.join(' '), /limited edit\/repost/i);
  await actions.markDistributionCopyStatus({ actor, runId, destinationId: 'linkedin', status: 'approved' });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.equal(pkg.linkedin.status, 'approved');
  assert.equal(pkg.linkedin.approvedPayload.text, 'Edited LinkedIn copy.');

  await actions.saveDistributionCopy({ actor, runId, destinationId: 'instagram', fields: { caption: 'Edited Instagram caption.', assetFocusX: '42', assetFocusY: '38', assetScale: '1.15' } });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.equal(pkg.instagram.caption, 'Edited Instagram caption.');
  assert.equal(pkg.instagram.asset.position.focusX, 42);
  assert.equal(pkg.instagram.asset.position.focusY, 38);
  assert.equal(pkg.instagram.asset.position.scale, 1.15);
  assert.deepEqual(pkg.channelAssets.instagram, pkg.instagram.asset);
  const reloadedRun = await actions.runs.readRun(runId);
  assert.equal(reloadedRun.distribution.package.instagram.asset.width, 1080);
  assert.equal(reloadedRun.blogPackage.coverImage, '/images/blog/jason-isbell-suno-ai-artist-identity-1788708178378.png');

  await actions.generateDistributionCopy({ actor, runId, destinationId: 'linkedin' });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.notEqual(pkg.linkedin.text, 'Edited LinkedIn copy.');
  assert.equal(pkg.x.text, originalX);
  assert.equal(pkg.instagram.caption, 'Edited Instagram caption.');
  assert.equal(pkg.instagram.asset.position.focusX, 42);

  await actions.generateDistributionCopy({ actor, runId, destinationId: 'instagram' });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.notEqual(pkg.instagram.caption, 'Edited Instagram caption.');
  assert.equal(pkg.x.text, originalX);
  assert.equal(pkg.channelAssets.canonicalBlog.outputImage, '/images/blog/jason-isbell-suno-ai-artist-identity-1788708178378.png');

  await actions.preflightDistributionCopy({ actor, runId, destinationId: 'x' });
  await actions.markDistributionCopyStatus({ actor, runId, destinationId: 'x', status: 'approved' });
  await actions.markDistributionCopyStatus({ actor, runId, destinationId: 'x', status: 'sent' });
  pkg = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'package.json'), 'utf8'));
  assert.equal(pkg.x.status, 'sent');
  assert.equal(pkg.x.sentPayload.text, originalX);
  assert.equal(distributionPackageOverallStatus(pkg), 'partially-distributed');
});

test('20ae unpublished drafts cannot generate distribution packages', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-distribution-draft-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'distribution-draft-001';
  await createMinimalRun(path.join(outputDir, runId), {
    title: 'Draft Distribution',
    slug: 'draft-distribution',
    status: 'DRAFT',
    publishability: 'NEEDS_FOUNDER_REVIEW',
  });
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  await assert.rejects(
    actions.generateDistributionCopy({ actor: { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' }, runId }),
    /Only approved, ready, publishing or published articles/,
  );
});

test('20aa publishing preparation normalizes Markdown heading titles', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-title-normalize-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'markdown-title-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: '### Markdown Heading Title',
    slug: 'markdown-heading-title',
    status: 'FOUNDER_APPROVED',
    publishability: 'APPROVED_READY',
    markdown: '---\ntitle: "### Markdown Heading Title"\n---\n\n# Markdown Heading Title\n\nBody.',
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  const summary = await actions.runs.readRunSummary(runId);
  assert.equal(summary.title, 'Markdown Heading Title');

  await actions.preparePublishing({ actor, runId });
  const blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.title, 'Markdown Heading Title');
});

test('20ab article cover can be set manually or automatically', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-cover-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'cover-update-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'AI Music Streaming Cover Test',
    slug: 'ai-music-streaming-cover-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# AI Music Streaming Cover Test\n\nArtists and streaming rights.',
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  await actions.updateCoverImage({ actor, runId, coverImage: '/images/creator-commerce-raw-20260601-edgefix.jpeg', mode: 'manual' });
  let blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.coverImage, '/images/creator-commerce-raw-20260601-edgefix.jpeg');
  assert.equal(blogPackage.coverImageMode, 'manual');

  await actions.updateCoverImage({ actor, runId, mode: 'auto' });
  blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.coverImage, '/images/ip-publishing-creators-20260605.jpeg');
  assert.equal(blogPackage.coverImageMode, 'auto');

  await assert.rejects(
    actions.updateCoverImage({ actor, runId, coverImage: 'https://example.test/image.jpg', mode: 'manual' }),
    /root-relative \/images\/ path/,
  );
});

test('20aba cover image actions return to article cover section', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-cover-redirect-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'cover-redirect-001';
  await createMinimalRun(path.join(outputDir, runId), {
    title: 'Cover Redirect Test',
    slug: 'cover-redirect-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
  });

  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const article = await fetch(`${base}/app/content/articles/${runId}`, { headers: { cookie } });
    const html = await article.text();
    assert.equal(article.status, 200);
    assert.match(html, /id="cover-image"/);
    const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1] || '';
    assert.ok(csrf);

    const response = await fetch(`${base}/app/content/actions/publishing/cover`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: csrf,
        runId,
        mode: 'manual',
        coverImage: '/images/creator-commerce-raw-20260601-edgefix.jpeg',
      }),
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/app/content/articles/${runId}#cover-image`);
  }, {
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  });
});

test('20ac automatic cover can use Pexels and download a local image', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-pexels-cover-'));
  const siteRoot = path.join(tmpRoot, 'site');
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'pexels-cover-001';
  const runDir = path.join(outputDir, runId);
  await fs.mkdir(siteRoot, { recursive: true });
  await createMinimalRun(runDir, {
    title: 'Creator Commerce Cover Test',
    slug: 'creator-commerce-cover-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# Creator Commerce Cover Test\n\nCreator revenue and ownership.',
  });

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.pexels.com/v1/search')) {
      return new Response(JSON.stringify({
        photos: [
          {
            id: 12345,
            width: 1600,
            height: 900,
            url: 'https://www.pexels.com/photo/test-photo-12345/',
            photographer: 'Test Photographer',
            photographer_url: 'https://www.pexels.com/@test-photographer',
            src: { large2x: 'https://images.pexels.com/photos/12345/test.jpeg?auto=compress&cs=tinysrgb' },
            alt: 'A creator business workspace',
          },
          {
            id: 67890,
            width: 1800,
            height: 1000,
            url: 'https://www.pexels.com/photo/test-photo-67890/',
            photographer: 'Second Photographer',
            photographer_url: 'https://www.pexels.com/@second-photographer',
            src: { large2x: 'https://images.pexels.com/photos/67890/test.jpeg?auto=compress&cs=tinysrgb' },
            alt: 'A second creator business workspace',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const config = getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
    CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER: 'pexels',
    CONTENT_DASHBOARD_PEXELS_API_KEY: 'test-pexels-key',
  });
  config.siteRoot = siteRoot;
  config.coverImages.fetchImpl = fetchImpl;
  const actions = new ContentDashboardActions(config);
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  await actions.updateCoverImage({ actor, runId, mode: 'auto' });
  let blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.coverImage, '/images/blog/creator-commerce-cover-test-pexels-12345.jpg');
  assert.equal(blogPackage.coverImageProvider, 'pexels');
  assert.equal(blogPackage.coverImageCredit, 'Photo by Test Photographer on Pexels');
  assert.equal(blogPackage.coverImageAlt, 'A creator business workspace');
  assert.equal(calls.length, 2);
  await fs.stat(path.join(siteRoot, 'images', 'blog', 'creator-commerce-cover-test-pexels-12345.jpg'));

  await actions.updateCoverImage({ actor, runId, mode: 'auto' });
  blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.coverImage, '/images/blog/creator-commerce-cover-test-pexels-67890.jpg');
  assert.equal(blogPackage.coverImagePexelsId, '67890');
  assert.equal(blogPackage.coverImageHistory[0].pexelsId, '12345');
  assert.equal(calls.length, 4);
  const globalHistory = JSON.parse(await fs.readFile(path.join(tmpRoot, 'dashboard', 'cover-image-history.json'), 'utf8'));
  assert.deepEqual(globalHistory.items.map((item) => item.pexelsId), ['67890', '12345']);
});

test('20ad cover image can be uploaded from a file picker', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-upload-cover-'));
  const siteRoot = path.join(tmpRoot, 'site');
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'upload-cover-001';
  const runDir = path.join(outputDir, runId);
  await fs.mkdir(siteRoot, { recursive: true });
  await createMinimalRun(runDir, {
    title: 'Upload Cover Test',
    slug: 'upload-cover-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
  });

  const config = getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  });
  config.siteRoot = siteRoot;
  const actions = new ContentDashboardActions(config);
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  await actions.uploadCoverImage({
    actor,
    runId,
    file: {
      filename: 'cover.png',
      contentType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    },
  });
  const blogPackage = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  assert.match(blogPackage.coverImage, /^\/images\/blog\/upload-cover-test-\d+\.png$/);
  assert.equal(blogPackage.coverImageProvider, 'upload');
  await fs.stat(path.join(siteRoot, blogPackage.coverImage.replace(/^\//, '')));
});

test('20b READY_TO_PUBLISH articles expose Publish to Certifyd and create a tracked draft PR state', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-publish-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'local-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Local Publish Test',
    slug: 'local-publish-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# Local Publish Test\n\nBody.',
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  actions.publisher = {
    createPullRequest: async () => ({
      ok: true,
      output: 'Draft PR created: https://github.test/certifyd/pull/1',
      pullRequestUrl: 'https://github.test/certifyd/pull/1',
      branchName: 'content-dashboard/local-publish-test',
      repositoryPath: 'content/blog/local-publish-test.md',
      canonicalUrl: 'https://certifyd.me/blog/local-publish-test/',
    }),
  };
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  await actions.preparePublishing({ actor, runId });

  const result = await actions.publishToCertifyd({ actor, runId, version: 'v1' });
  assert.match(result.output, /Draft PR created/);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PUBLISHING');
  assert.equal(manifest.publishability, 'PUBLISHING_REVIEW');
  assert.equal(manifest.publishing.pullRequestUrl, 'https://github.test/certifyd/pull/1');
  const prRecord = JSON.parse(await fs.readFile(path.join(runDir, 'publishing', 'github-pr.json'), 'utf8'));
  assert.equal(prRecord.repositoryPath, 'content/blog/local-publish-test.md');
});

test('20ba direct publishing tracks base branch deployment without PR state', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-direct-publish-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'local-direct-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Local Direct Publish Test',
    slug: 'local-direct-publish-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# Local Direct Publish Test\n\nBody.',
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  actions.publisher = {
    createPullRequest: async () => ({
      ok: true,
      output: 'Published directly to main: https://certifyd.me/blog/local-direct-publish-test/',
      publishMode: 'direct',
      commitUrls: ['https://github.test/certifyd/commit/1'],
      branchName: 'main',
      repositoryPath: 'content/blog/local-direct-publish-test.md',
      canonicalUrl: 'https://certifyd.me/blog/local-direct-publish-test/',
    }),
  };
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  await actions.preparePublishing({ actor, runId });

  const result = await actions.publishToCertifyd({ actor, runId, version: 'v1' });
  assert.match(result.output, /Published directly to main/);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PUBLISHING');
  assert.equal(manifest.publishability, 'PUBLISHING_DEPLOYMENT');
  assert.equal(manifest.publishing.status, 'PUBLISHING_DEPLOYMENT');
  assert.equal(manifest.publishedAt, undefined);
  assert.equal(manifest.publishing.mode, 'direct');
  assert.equal(manifest.publishing.pullRequestUrl, '');
  assert.equal(manifest.publishing.branchName, 'main');
  assert.deepEqual(manifest.publishing.commitUrls, ['https://github.test/certifyd/commit/1']);
});

test('20bb direct publishing can republish a published article', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-republish-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'local-republish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Local Republish Test',
    slug: 'local-republish-test',
    status: 'PUBLISHED',
    publishability: 'LIVE',
    markdown: '# Local Republish Test\n\nBody.',
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  actions.publisher = {
    createPullRequest: async () => ({
      ok: true,
      output: 'Published directly to main: https://certifyd.me/blog/local-republish-test/',
      publishMode: 'direct',
      commitUrls: ['https://github.test/certifyd/commit/2'],
      branchName: 'main',
      repositoryPath: 'content/blog/local-republish-test.md',
      canonicalUrl: 'https://certifyd.me/blog/local-republish-test/',
    }),
  };
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  const result = await actions.republishToCertifyd({ actor, runId, version: 'v1' });
  assert.match(result.output, /Published directly to main/);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PUBLISHING');
  assert.equal(manifest.publishability, 'PUBLISHING_DEPLOYMENT');
  assert.equal(manifest.publishing.status, 'PUBLISHING_DEPLOYMENT');
  assert.equal(manifest.publishedAt, undefined);
  assert.equal(manifest.publishing.mode, 'direct');
  assert.deepEqual(manifest.publishing.commitUrls, ['https://github.test/certifyd/commit/2']);
});

test('20bba direct publish generation preserves existing GitHub branch articles when local checkout is stale', async () => {
  const tmpSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-publisher-hydrate-'));
  await fs.mkdir(path.join(tmpSiteRoot, 'content', 'blog'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts', 'content-dashboard'), { recursive: true });
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(tmpSiteRoot, 'node_modules'), 'dir');
  await fs.cp(path.join(process.cwd(), 'templates'), path.join(tmpSiteRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'build-blog.js'), path.join(tmpSiteRoot, 'scripts', 'build-blog.js'));
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'content-dashboard', 'public-markdown.js'), path.join(tmpSiteRoot, 'scripts', 'content-dashboard', 'public-markdown.js'));
  await fs.writeFile(path.join(tmpSiteRoot, 'index.html'), [
    '<main>',
    '<!-- BLOG_RECENT_START -->',
    '<!-- BLOG_RECENT_END -->',
    '</main>',
  ].join('\n'));
  await fs.writeFile(path.join(tmpSiteRoot, 'content', 'blog', 'local-stale.md'), [
    '---',
    'title: "Local Stale Article"',
    'slug: "local-stale"',
    'date: "2026-07-01"',
    'updated: "2026-07-01"',
    'author: "Certifyd"',
    'excerpt: "Only in the stale local checkout."',
    'status: "published"',
    '---',
    '',
    '# Local Stale Article',
    '',
    'Local body.',
  ].join('\n'));

  const remotePriorMarkdown = [
    '---',
    'title: "Remote Prior Article"',
    'slug: "remote-prior"',
    'date: "2026-07-30"',
    'updated: "2026-07-30"',
    'author: "Certifyd"',
    'excerpt: "Already published on GitHub."',
    'status: "published"',
    '---',
    '',
    '# Remote Prior Article',
    '',
    'Remote body.',
  ].join('\n');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const raw = String(url);
    if (raw.includes('/contents/content/blog?')) {
      return new Response(JSON.stringify([
        { type: 'file', name: 'remote-prior.md', path: 'content/blog/remote-prior.md' },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/contents/content/blog/remote-prior.md?')) {
      return new Response(JSON.stringify({
        content: Buffer.from(remotePriorMarkdown).toString('base64'),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const publisher = new GitHubPullRequestPublisher({
      siteRoot: tmpSiteRoot,
      githubPublishing: {
        enabled: true,
        owner: 'BEATiFYAUDIO',
        repo: 'certifyd-me-site',
        token: 'test-token',
        baseBranch: 'main',
      },
    }, {});
    const files = await publisher.buildGeneratedSiteFiles('new-article', [
      '---',
      'title: "New Article"',
      'slug: "new-article"',
      'date: "2026-07-31"',
      'updated: "2026-07-31"',
      'author: "Certifyd"',
      'excerpt: "Second article published today."',
      'status: "published"',
      '---',
      '',
      '# New Article',
      '',
      'New body.',
    ].join('\n'), {
      repositoryConfig: {
        owner: 'BEATiFYAUDIO',
        repo: 'certifyd-me-site',
      },
      token: 'test-token',
      branchName: 'main',
    });
    const index = files.find((file) => file.path === 'blog/index.html')?.content || '';
    assert.match(index, /Remote Prior Article/);
    assert.match(index, /New Article/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('20bbb direct publishing writes generated files as one atomic GitHub commit', async () => {
  const tmpSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-publisher-atomic-'));
  await fs.mkdir(path.join(tmpSiteRoot, 'content', 'blog'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts'), { recursive: true });
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(tmpSiteRoot, 'node_modules'), 'dir');
  await fs.cp(path.join(process.cwd(), 'templates'), path.join(tmpSiteRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'build-blog.js'), path.join(tmpSiteRoot, 'scripts', 'build-blog.js'));
  await fs.writeFile(path.join(tmpSiteRoot, 'index.html'), [
    '<main>',
    '<!-- BLOG_RECENT_START -->',
    '<!-- BLOG_RECENT_END -->',
    '</main>',
  ].join('\n'));

  const outputDir = path.join(tmpSiteRoot, 'engine', 'outputs');
  const runId = 'atomic-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Atomic Publish Test',
    slug: 'atomic-publish-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# Atomic Publish Test\n\nBody.',
    summary: 'Atomic publish test excerpt for generated blog output.',
  });

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const raw = String(url);
    const method = String(options?.method || 'GET').toUpperCase();
    calls.push({ method, url: raw, body: options?.body ? JSON.parse(String(options.body)) : null });
    if (raw.includes('/contents/content/blog?')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (raw.includes('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({ object: { sha: 'base-commit-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/commits/base-commit-sha') && method === 'GET') {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/blobs') && method === 'POST') {
      return new Response(JSON.stringify({ sha: `blob-${calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs')).length}` }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/trees') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'next-tree-sha' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/commits') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'next-commit-sha', html_url: 'https://github.test/commit/next' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/refs/heads/main') && method === 'PATCH') {
      return new Response(JSON.stringify({ object: { sha: 'next-commit-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const actions = new ContentDashboardActions(getDashboardConfig({
      ...env,
      CONTENT_AGENT_ROOT: tmpSiteRoot,
      CONTENT_AGENT_OUTPUT_DIR: outputDir,
      CONTENT_DASHBOARD_DB_PATH: ':memory:',
      CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED: 'true',
      CONTENT_DASHBOARD_GITHUB_OWNER: 'BEATiFYAUDIO',
      CONTENT_DASHBOARD_GITHUB_REPO: 'certifyd-me-site',
      CONTENT_DASHBOARD_GITHUB_TOKEN: 'test-token',
    }));
    const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
    await actions.preparePublishing({ actor, runId });
    const result = await actions.publishToCertifyd({ actor, runId, version: 'v1' });
    assert.match(result.output, /Published directly to main/);

    const contentPuts = calls.filter((call) => call.method === 'PUT' && call.url.includes('/contents/'));
    assert.equal(contentPuts.length, 0);
    const treePosts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
    const commitPosts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/commits'));
    const refPatches = calls.filter((call) => call.method === 'PATCH' && call.url.includes('/git/refs/heads/main'));
    const blobPosts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs'));
    assert.ok(blobPosts.length >= 3);
    assert.equal(treePosts.length, 1);
    assert.equal(commitPosts.length, 1);
    assert.equal(refPatches.length, 1);
    assert.ok(treePosts[0].body.tree.every((entry) => entry.path !== 'index.html'));
    assert.ok(treePosts[0].body.tree.some((entry) => entry.path === 'blog/index.html'));
    assert.ok(treePosts[0].body.tree.some((entry) => entry.path === 'content/blog/atomic-publish-test.md'));
    assert.ok(treePosts[0].body.tree.every((entry) => entry.sha));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('20bbba direct publishing mirrors blog files without writing preview homepage', async () => {
  const tmpSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-publisher-mirror-'));
  await fs.mkdir(path.join(tmpSiteRoot, 'content', 'blog'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts'), { recursive: true });
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(tmpSiteRoot, 'node_modules'), 'dir');
  await fs.cp(path.join(process.cwd(), 'templates'), path.join(tmpSiteRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'build-blog.js'), path.join(tmpSiteRoot, 'scripts', 'build-blog.js'));
  await fs.writeFile(path.join(tmpSiteRoot, 'index.html'), [
    '<main>',
    '<!-- BLOG_RECENT_START -->',
    '<!-- BLOG_RECENT_END -->',
    '</main>',
  ].join('\n'));

  const outputDir = path.join(tmpSiteRoot, 'engine', 'outputs');
  const runId = 'mirror-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Mirror Publish Test',
    slug: 'mirror-publish-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# Mirror Publish Test\n\nBody.',
    summary: 'Mirror publish test excerpt for generated blog output.',
  });

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const raw = String(url);
    const method = String(options?.method || 'GET').toUpperCase();
    calls.push({ method, url: raw, body: options?.body ? JSON.parse(String(options.body)) : null });
    if (raw.includes('/contents/content/blog?')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (raw.includes('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({ object: { sha: raw.includes('certifyd-me-site-preview') ? 'mirror-base-commit-sha' : 'base-commit-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/commits/base-commit-sha') && method === 'GET') {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/commits/mirror-base-commit-sha') && method === 'GET') {
      return new Response(JSON.stringify({ tree: { sha: 'mirror-base-tree-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/blobs') && method === 'POST') {
      return new Response(JSON.stringify({ sha: `blob-${calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs')).length}` }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/trees') && method === 'POST') {
      return new Response(JSON.stringify({ sha: raw.includes('certifyd-me-site-preview') ? 'mirror-next-tree-sha' : 'next-tree-sha' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/commits') && method === 'POST') {
      return new Response(JSON.stringify({ sha: raw.includes('certifyd-me-site-preview') ? 'mirror-next-commit-sha' : 'next-commit-sha', html_url: 'https://github.test/commit/next' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/refs/heads/main') && method === 'PATCH') {
      return new Response(JSON.stringify({ object: { sha: raw.includes('certifyd-me-site-preview') ? 'mirror-next-commit-sha' : 'next-commit-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const actions = new ContentDashboardActions(getDashboardConfig({
      ...env,
      CONTENT_AGENT_ROOT: tmpSiteRoot,
      CONTENT_AGENT_OUTPUT_DIR: outputDir,
      CONTENT_DASHBOARD_DB_PATH: ':memory:',
      CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED: 'true',
      CONTENT_DASHBOARD_GITHUB_OWNER: 'BEATiFYAUDIO',
      CONTENT_DASHBOARD_GITHUB_REPO: 'certifyd-me-site',
      CONTENT_DASHBOARD_GITHUB_TOKEN: 'test-token',
      CONTENT_DASHBOARD_GITHUB_MIRROR_ENABLED: 'true',
      CONTENT_DASHBOARD_GITHUB_MIRROR_REPO: 'certifyd-me-site-preview',
      CONTENT_DASHBOARD_GITHUB_MIRROR_PUBLIC_URL: 'https://vassal.certifyd.me/',
    }));
    const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
    await actions.preparePublishing({ actor, runId });
    const result = await actions.publishToCertifyd({ actor, runId, version: 'v1' });
    assert.match(result.output, /Published directly to main/);
    assert.match(result.output, /Mirrored to BEATiFYAUDIO\/certifyd-me-site-preview@main/);

    const treePosts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/trees'));
    const primaryTree = treePosts.find((call) => call.url.includes('/repos/BEATiFYAUDIO/certifyd-me-site/'));
    const mirrorTree = treePosts.find((call) => call.url.includes('/repos/BEATiFYAUDIO/certifyd-me-site-preview/'));
    assert.ok(primaryTree);
    assert.ok(mirrorTree);
    assert.ok(primaryTree.body.tree.every((entry) => entry.path !== 'index.html'));
    assert.ok(mirrorTree.body.tree.every((entry) => entry.path !== 'index.html'));
    assert.ok(mirrorTree.body.tree.some((entry) => entry.path === 'blog/index.html'));
    assert.ok(mirrorTree.body.tree.some((entry) => entry.path === 'content/blog/mirror-publish-test.md'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('20bbd direct publishing skips GitHub commits when generated output is unchanged', async () => {
  const tmpSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-publisher-noop-'));
  await fs.mkdir(path.join(tmpSiteRoot, 'content', 'blog'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts'), { recursive: true });
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(tmpSiteRoot, 'node_modules'), 'dir');
  await fs.cp(path.join(process.cwd(), 'templates'), path.join(tmpSiteRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'build-blog.js'), path.join(tmpSiteRoot, 'scripts', 'build-blog.js'));
  await fs.writeFile(path.join(tmpSiteRoot, 'index.html'), [
    '<main>',
    '<!-- BLOG_RECENT_START -->',
    '<!-- BLOG_RECENT_END -->',
    '</main>',
  ].join('\n'));

  const outputDir = path.join(tmpSiteRoot, 'engine', 'outputs');
  const runId = 'noop-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Noop Publish Test',
    slug: 'noop-publish-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# Noop Publish Test\n\nBody.',
    summary: 'No-op publish test excerpt for generated blog output.',
  });

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const raw = String(url);
    const method = String(options?.method || 'GET').toUpperCase();
    calls.push({ method, url: raw, body: options?.body ? JSON.parse(String(options.body)) : null });
    if (raw.includes('/contents/content/blog?')) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (raw.includes('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({ object: { sha: 'base-commit-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/commits/base-commit-sha') && method === 'GET') {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/blobs') && method === 'POST') {
      return new Response(JSON.stringify({ sha: `blob-${calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/blobs')).length}` }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/trees') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'base-tree-sha' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.endsWith('/git/commits') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'unexpected-commit-sha', html_url: 'https://github.test/commit/unexpected' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (raw.includes('/git/refs/heads/main') && method === 'PATCH') {
      return new Response(JSON.stringify({ object: { sha: 'unexpected-commit-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const actions = new ContentDashboardActions(getDashboardConfig({
      ...env,
      CONTENT_AGENT_ROOT: tmpSiteRoot,
      CONTENT_AGENT_OUTPUT_DIR: outputDir,
      CONTENT_DASHBOARD_DB_PATH: ':memory:',
      CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED: 'true',
      CONTENT_DASHBOARD_GITHUB_OWNER: 'BEATiFYAUDIO',
      CONTENT_DASHBOARD_GITHUB_REPO: 'certifyd-me-site',
      CONTENT_DASHBOARD_GITHUB_TOKEN: 'test-token',
    }));
    const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
    await actions.preparePublishing({ actor, runId });
    const result = await actions.publishToCertifyd({ actor, runId, version: 'v1' });
    assert.match(result.output, /Published directly to main/);
    assert.deepEqual(result.commitUrls, []);
    assert.equal(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/trees')).length, 1);
    assert.equal(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/git/commits')).length, 0);
    assert.equal(calls.filter((call) => call.method === 'PATCH' && call.url.includes('/git/refs/heads/main')).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('20bbe publish-time static generation stages SVG cover images and generated social images', async () => {
  const tmpSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-publisher-svg-'));
  await fs.mkdir(path.join(tmpSiteRoot, 'content', 'blog'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'images', 'blog', '2026', '09'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts', 'content-dashboard'), { recursive: true });
  await fs.mkdir(path.join(tmpSiteRoot, 'scripts'), { recursive: true });
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(tmpSiteRoot, 'node_modules'), 'dir');
  await fs.cp(path.join(process.cwd(), 'templates'), path.join(tmpSiteRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'build-blog.js'), path.join(tmpSiteRoot, 'scripts', 'build-blog.js'));
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'content-dashboard', 'public-markdown.js'), path.join(tmpSiteRoot, 'scripts', 'content-dashboard', 'public-markdown.js'));
  await fs.writeFile(path.join(tmpSiteRoot, 'index.html'), [
    '<main>',
    '<!-- BLOG_RECENT_START -->',
    '<!-- BLOG_RECENT_END -->',
    '</main>',
  ].join('\n'));
  await fs.writeFile(path.join(tmpSiteRoot, 'images', 'blog', '2026', '09', 'svg-cover-logo.svg'), [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    '<rect width="1200" height="630" fill="#04121f"/>',
    '<circle cx="840" cy="260" r="160" fill="#ff9f1c"/>',
    '<text x="80" y="180" fill="#ffffff" font-size="72" font-family="Arial">SVG Cover</text>',
    '</svg>',
  ].join(''));

  const publisher = new GitHubPullRequestPublisher({
    siteRoot: tmpSiteRoot,
    githubPublishing: {
      enabled: true,
      owner: 'BEATiFYAUDIO',
      repo: 'certifyd-me-site',
      token: 'test-token',
      baseBranch: 'main',
    },
  }, {});
  const files = await publisher.buildGeneratedSiteFiles('svg-cover-test', [
    '---',
    'title: "SVG Cover Test"',
    'slug: "svg-cover-test"',
    'date: "2026-09-13"',
    'updated: "2026-09-13"',
    'author: "Certifyd"',
    'excerpt: "SVG cover image publish test."',
    'coverImage: "/images/blog/2026/09/svg-cover-logo.svg"',
    'status: "published"',
    '---',
    '',
    '# SVG Cover Test',
    '',
    'Body.',
  ].join('\n'));

  assert.ok(files.some((file) => file.path === 'content/blog/svg-cover-test.md'));
  assert.ok(files.some((file) => file.path === 'blog/svg-cover-test/index.html'));
  assert.ok(files.some((file) => file.path === 'images/blog/2026/09/svg-cover-logo.svg'));
  assert.ok(files.some((file) => file.path === 'images/blog/2026/09/svg-cover-logo-social.png'));
});

test('20bc IndexNow submits only after publish, update and removal', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-indexnow-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'indexnow-publish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'IndexNow Publish Test',
    slug: 'indexnow-publish-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# IndexNow Publish Test\n\nBody.',
  });

  const config = getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
    CONTENT_DASHBOARD_INDEXNOW_KEY: 'indexnow_test_key',
  });
  const calls = [];
  config.indexNow.fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { status: 202 };
  };
  const actions = new ContentDashboardActions(config);
  actions.publisher = {
    createPullRequest: async () => ({
      ok: true,
      output: 'Published directly to main: https://certifyd.me/blog/indexnow-publish-test/',
      publishMode: 'direct',
      commitUrls: ['https://github.test/certifyd/commit/indexnow'],
      branchName: 'main',
      repositoryPath: 'content/blog/indexnow-publish-test.md',
      canonicalUrl: 'https://certifyd.me/blog/indexnow-publish-test/',
    }),
    createUnpublishPullRequest: async () => ({
      ok: true,
      output: 'Unpublished directly from main: https://certifyd.me/blog/indexnow-publish-test/',
      publishMode: 'direct',
      commitUrls: ['https://github.test/certifyd/commit/indexnow-remove'],
      branchName: 'main',
      repositoryPath: 'content/blog/indexnow-publish-test.md',
      removedPath: 'blog/indexnow-publish-test/index.html',
      canonicalUrl: 'https://certifyd.me/blog/indexnow-publish-test/',
    }),
  };
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  await actions.preparePublishing({ actor, runId });
  assert.equal(calls.length, 0);

  await actions.publishToCertifyd({ actor, runId, version: 'v1' });
  let manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.publishing.indexNow.action, 'publish');
  assert.equal(manifest.publishing.indexNow.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].urlList, ['https://certifyd.me/blog/indexnow-publish-test/']);

  await actions.republishToCertifyd({ actor, runId, version: 'v1' });
  manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.publishing.indexNow.action, 'update');
  assert.equal(calls.length, 2);

  await actions.unpublishFromCertifyd({ actor, runId, confirmUnpublish: 'unpublish' });
  manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.unpublishing.indexNow.action, 'remove');
  assert.equal(calls.length, 3);
});

test('20bd IndexNow failure does not break publishing', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-indexnow-fail-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'indexnow-fail-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'IndexNow Failure Test',
    slug: 'indexnow-fail-test',
    status: 'READY_TO_PUBLISH',
    publishability: 'READY_TO_PUBLISH',
    markdown: '# IndexNow Failure Test\n\nBody.',
  });

  const config = getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
    CONTENT_DASHBOARD_INDEXNOW_KEY: 'indexnow_test_key',
  });
  config.indexNow.fetchImpl = async () => {
    throw new Error('network down');
  };
  const actions = new ContentDashboardActions(config);
  actions.publisher = {
    createPullRequest: async () => ({
      ok: true,
      output: 'Published directly to main: https://certifyd.me/blog/indexnow-fail-test/',
      publishMode: 'direct',
      commitUrls: ['https://github.test/certifyd/commit/indexnow-fail'],
      branchName: 'main',
      repositoryPath: 'content/blog/indexnow-fail-test.md',
      canonicalUrl: 'https://certifyd.me/blog/indexnow-fail-test/',
    }),
  };
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  await actions.preparePublishing({ actor, runId });
  const result = await actions.publishToCertifyd({ actor, runId, version: 'v1' });
  assert.match(result.output, /Published directly/);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.publishing.indexNow.submitted, true);
  assert.equal(manifest.publishing.indexNow.ok, false);
  assert.match(manifest.publishing.indexNow.error, /network down/);
});

test('20c live articles can create a tracked unpublish PR state', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-unpublish-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'local-unpublish-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Local Unpublish Test',
    slug: 'local-unpublish-test',
    status: 'REJECTED',
    publishability: 'BLOCKED_REJECTED',
    markdown: '# Local Unpublish Test\n\nBody.',
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  actions.publisher = {
    createUnpublishPullRequest: async () => ({
      ok: true,
      output: 'Draft unpublish PR created: https://github.test/certifyd/pull/2',
      pullRequestUrl: 'https://github.test/certifyd/pull/2',
      branchName: 'content-dashboard/unpublish-local-unpublish-test',
      repositoryPath: 'content/blog/local-unpublish-test.md',
      removedPath: 'blog/local-unpublish-test/index.html',
      canonicalUrl: 'https://certifyd.me/blog/local-unpublish-test/',
    }),
  };
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  await assert.rejects(
    actions.unpublishFromCertifyd({ actor, runId }),
    /Type unpublish/
  );
  const result = await actions.unpublishFromCertifyd({ actor, runId, confirmUnpublish: 'unpublish' });
  assert.match(result.output, /Draft unpublish PR created/);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'UNPUBLISHING');
  assert.equal(manifest.publishability, 'UNPUBLISHING_REVIEW');
  assert.equal(manifest.unpublishing.pullRequestUrl, 'https://github.test/certifyd/pull/2');
  assert.equal(manifest.unpublishing.removedPath, 'blog/local-unpublish-test/index.html');
  const prRecord = JSON.parse(await fs.readFile(path.join(runDir, 'publishing', 'unpublish-pr.json'), 'utf8'));
  assert.equal(prRecord.repositoryPath, 'content/blog/local-unpublish-test.md');
});

test('20d archive and draft delete actions mutate run storage safely', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-lifecycle-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const archiveRunId = 'local-archive-001';
  const deleteRunId = 'local-delete-001';
  const archiveDir = path.join(outputDir, archiveRunId);
  const deleteDir = path.join(outputDir, deleteRunId);
  await createMinimalRun(archiveDir, { title: 'Archive Test', slug: 'archive-test', status: 'GENERATED', publishability: 'NEEDS_FOUNDER_REVIEW' });
  await createMinimalRun(deleteDir, { title: 'Delete Test', slug: 'delete-test', status: 'DRAFT', publishability: 'NEEDS_FOUNDER_REVIEW' });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };

  const archived = await actions.archiveArticle({ actor, runId: archiveRunId });
  assert.match(archived.output, /Archived/);
  const archiveManifest = JSON.parse(await fs.readFile(path.join(archiveDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(archiveManifest.currentStatus, 'ARCHIVED');
  assert.equal(archiveManifest.publishability, 'ARCHIVED');

  await assert.rejects(
    actions.deleteDraft({ actor, runId: deleteRunId }),
    /Type delete to confirm draft deletion/
  );
  const deleted = await actions.deleteDraft({ actor, runId: deleteRunId, confirmDelete: 'delete' });
  assert.match(deleted.output, /Deleted draft/);
  await assert.rejects(fs.stat(deleteDir));
  const trashEntries = await fs.readdir(path.join(tmpRoot, 'dashboard', 'trash'));
  assert.equal(trashEntries.length, 1);
  assert.match(trashEntries[0], /^local-delete-001-/);
});

test('20e article Markdown can be edited and saved manually', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-article-save-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'local-save-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, {
    title: 'Original Title',
    slug: 'original-title',
    markdown: [
      '---',
      'title: "Original Title"',
      'slug: "original-title"',
      'excerpt: "Original excerpt."',
      '---',
      '',
      '# Original Title',
      '',
      'Original body.',
    ].join('\n'),
  });

  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const markdown = [
    '---',
    'title: "Updated Manual Title"',
    'slug: "updated-manual-title"',
    'excerpt: "Updated manual excerpt."',
    '---',
    '',
    '# Updated Manual Title',
    '',
    'Updated manual body for preview and republish.',
  ].join('\n');

  const result = await actions.saveArticleMarkdown({ actor, runId, articleMarkdown: markdown });
  assert.match(result.output, /Saved article Markdown/);
  assert.match(await fs.readFile(path.join(runDir, 'final', 'article.md'), 'utf8'), /Updated manual body/);
  assert.match(await fs.readFile(path.join(runDir, 'blog', 'blog-post.md'), 'utf8'), /Updated manual body/);
  const article = JSON.parse(await fs.readFile(path.join(runDir, 'final', 'article.json'), 'utf8'));
  assert.equal(article.title, 'Updated Manual Title');
  assert.equal(article.slug, 'updated-manual-title');
  const lifecycle = JSON.parse(await fs.readFile(path.join(runDir, 'lifecycle.json'), 'utf8'));
  assert.equal(lifecycle.events.at(-1).type, 'ARTICLE_EDITED');
});

test('20f pasted article creates a normal review draft without Qwen', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-manual-paste-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await fs.mkdir(path.join(tmpRoot, 'knowledge', 'facts'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'knowledge', 'facts', 'approved-public-claims.md'), '# Approved Public Claims\n\nAPPROVED\nCertifyd helps creators connect identity, commerce and publishing context.\n');
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const form = new URLSearchParams({
    title: 'Manual Pasted Article',
    tags: 'music, commerce',
    articleMarkdown: '# Manual Pasted Article\n\nThis article was pasted directly into the Blog Engine.',
  });

  const result = await actions.createManualDraft({ actor, form });
  assert.match(result.output, /Created manual article draft/);
  assert.ok(validateRunId(result.runId));
  const runDir = path.join(outputDir, result.runId);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PENDING_FOUNDER_REVIEW');
  assert.equal(manifest.modelProvider, 'manual-paste');
  assert.match(await fs.readFile(path.join(runDir, 'final', 'article.md'), 'utf8'), /This article was pasted directly/);
  const request = JSON.parse(await fs.readFile(path.join(runDir, 'model-requests', 'article-generation.json'), 'utf8'));
  assert.equal(request.provider, 'manual-paste');
  assert.equal(request.responseStatus, 'NOT_APPLICABLE');
  const review = JSON.parse(await fs.readFile(path.join(runDir, 'reviews', 'founder-review.json'), 'utf8'));
  assert.equal(review.reviewStatus, 'PENDING_FOUNDER_REVIEW');
  const research = JSON.parse(await fs.readFile(path.join(runDir, 'research-record.json'), 'utf8'));
  assert.equal(research.generationDiagnostics.manualDraft, true);
});

test('20g manual pasted article can be approved and prepared without approved Brain context', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-manual-no-brain-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const actions = new ContentDashboardActions(getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const form = new URLSearchParams({
    title: 'Founder Manual Article',
    slug: 'founder-manual-article',
    articleMarkdown: '# Founder Manual Article\n\nThis article was written manually and pasted into the Blog Engine.',
  });

  const result = await actions.createManualDraft({ actor, form });
  const approved = await actions.approve({ actor, runId: result.runId, version: 'v1', confirm: 'true' });
  assert.match(approved.output, /Approved/);

  const prepared = await actions.preparePublishing({ actor, runId: result.runId });
  assert.match(prepared.output, /Prepared for Certifyd Blog/);

  const validated = await actions.validatePublishing({ actor, runId: result.runId });
  assert.match(validated.output, /Publishing package is ready/);
});

test('20h manual pasted article review page does not show approved Brain context as required', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-manual-review-no-brain-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const configEnv = {
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  };
  const actions = new ContentDashboardActions(getDashboardConfig({ ...env, ...configEnv }));
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const result = await actions.createManualDraft({
    actor,
    form: new URLSearchParams({
      title: 'Founder Manual Review Article',
      slug: 'founder-manual-review-article',
      articleMarkdown: '# Founder Manual Review Article\n\nThis article was written manually and pasted into the Blog Engine.',
    }),
  });

  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const review = await fetch(`${base}/app/content/review/${result.runId}`, { headers: { cookie } });
    assert.equal(review.status, 200);
    const html = await review.text();
    assert.match(html, /Manual pasted drafts do not require generated Brain context/);
    assert.match(html, /Approved Brain records: Not required for manual pasted draft/);
    assert.doesNotMatch(html, /Approved Brain context required\./);
    assert.doesNotMatch(html, /This draft cannot be approved or published until it is regenerated or revised/);
  }, configEnv);
});

test('21 no dashboard page offers live PUBLISHED action', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/publishing`, { headers: { cookie } });
  assert.doesNotMatch(await response.text(), /Publish Live<\/button>/);
}));

test('21a article workspace shows exact approved Brain records and zero-context warning', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-brain-ui-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await createMinimalRun(path.join(outputDir, 'core-explainer-001'), {
    title: 'Brain UI Test',
    slug: 'brain-ui-test',
    selectedEvidence: [approvedBrainRecord({ title: 'Approved Public Claims', path: 'content-agent/knowledge/facts/approved-public-claims.md' })],
  });
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/articles/core-explainer-001`, { headers: { cookie } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Approved Brain records: 1/);
    assert.match(html, /Approved Public Claims/);
    assert.match(html, /content-agent\/knowledge\/facts\/approved-public-claims\.md/);
  }, {
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  });
});

test('21c Brain workspace reflects review state and usage from generated runs', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-brain-connected-'));
  const knowledgeDir = path.join(tmpRoot, 'knowledge');
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  await fs.mkdir(path.join(knowledgeDir, 'facts'), { recursive: true });
  await fs.mkdir(path.join(knowledgeDir, 'capabilities'), { recursive: true });
  await fs.writeFile(path.join(knowledgeDir, 'facts', 'approved.md'), '# Approved\n\n`APPROVED`\n');
  await fs.writeFile(path.join(knowledgeDir, 'capabilities', 'unclear.md'), '# Unclear\n\n## Current Status\n\n`UNCLEAR`\n\n## Confidence\n\n`LOW`\n');
  await createMinimalRun(path.join(outputDir, 'brain-usage-001'), {
    title: 'Brain Usage Test',
    slug: 'brain-usage-test',
    selectedEvidence: [{ id: 'brain:facts/approved', path: 'content-agent/knowledge/facts/approved.md', excerpt: '`APPROVED`' }],
  });
  const config = getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    CONTENT_DASHBOARD_DB_PATH: ':memory:',
  });
  const files = await new ContentBrainRepository(config).listFiles();
  const approved = files.find((file) => file.name === 'facts/approved.md');
  const unclear = files.find((file) => file.name === 'capabilities/unclear.md');
  assert.equal(approved.staleStatus, 'APPROVED');
  assert.equal(approved.evidenceUsageCount, 1);
  assert.deepEqual(approved.affectedArticles, ['Brain Usage Test']);
  assert.equal(unclear.staleStatus, 'NEEDS_REVIEW');
  assert.equal(unclear.evidenceUsageCount, 0);
});

test('21b stale dashboard section routes redirect instead of rendering broken pages', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const review = await fetch(`${base}/app/content/review`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(review.status, 303);
  assert.equal(review.headers.get('location'), '/app/content/articles?view=review');

  const knowledgeReview = await fetch(`${base}/app/content/knowledge-review`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(knowledgeReview.status, 303);
  assert.equal(knowledgeReview.headers.get('location'), '/app/content/brain?view=suggestions');

  const topics = await fetch(`${base}/app/content/topics`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(topics.status, 303);
  assert.equal(topics.headers.get('location'), '/app/content/articles?view=ideas');

  const publishing = await fetch(`${base}/app/content/publishing`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(publishing.status, 303);
  assert.equal(publishing.headers.get('location'), '/app/content/articles?view=approved');

  const analytics = await fetch(`${base}/app/content/analytics`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(analytics.status, 303);
  assert.equal(analytics.headers.get('location'), '/app/content/settings#advanced-diagnostics');
}));

test('24 protected preview cannot be accessed publicly', async () => withServer(async (base) => {
  const response = await fetch(`${base}/app/content/articles/core-explainer-001/preview`, { redirect: 'manual' });
  assert.equal(response.status, 303);
}));

test('25 audit-capable actions require CSRF before execution', async () => withServer(async (base) => {
  const cookie = await login(base, 'editor@example.test');
  const response = await fetch(`${base}/app/content/actions/review/revise`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ runId: 'core-explainer-001' }) });
  assert.equal(response.status, 403);
}));

test('25b audit records are created for approval and revision actions', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-audit-'));
  const audit = new AuditLogRepository({ agentRoot: tmpRoot });

  await audit.append({
    action: 'approval',
    actorUserId: 'founder@example.test',
    actorDisplayName: 'founder@example.test',
    actorRole: 'founder',
    runId: 'core-explainer-001',
    version: 'v1',
    result: 'SUCCESS',
  });
  await audit.append({
    action: 'revision_request',
    actorUserId: 'editor@example.test',
    actorDisplayName: 'editor@example.test',
    actorRole: 'editor',
    runId: 'core-explainer-001',
    version: 'v1',
    result: 'SUCCESS',
  });

  const log = await fs.readFile(path.join(tmpRoot, 'review', 'dashboard-audit.log.jsonl'), 'utf8');
  const records = log.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(records[0].action, 'approval');
  assert.equal(records[1].action, 'revision_request');
  assert.equal(records[0].actorRole, 'founder');
  assert.equal(records[1].actorRole, 'editor');
  assert.ok(records[0].timestamp);
  assert.ok(records[1].requestId);
});

test('26 viewer role is read-only and cannot see action controls or sensitive pages', async () => withServer(async (base) => {
  const cookie = await login(base, 'viewer@example.test');
  const article = await fetch(`${base}/app/content/articles/core-explainer-001`, { headers: { cookie } });
  const html = await article.text();
  assert.equal(article.status, 200);
  assert.match(html, /Preview/);
  assert.doesNotMatch(html, /Request Revision|<button class="primary" type="submit">Approve<\/button>|Create Draft PR|Prepare Blog Package|Prepare for Certifyd/);

  const settings = await fetch(`${base}/app/content/settings`, { headers: { cookie } });
  assert.equal(settings.status, 403);
  const brain = await fetch(`${base}/app/content/brain`, { headers: { cookie } });
  assert.equal(brain.status, 403);
}));

test('27 Cloudflare Access mode rejects origin bypass without verified Access JWT', async () => withServer(async (base) => {
  const response = await fetch(`${base}/app/content`, { redirect: 'manual' });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Cloudflare Access required/);
}, {
  CONTENT_DASHBOARD_AUTH_MODE: 'cloudflare-access',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'certifyd-test.cloudflareaccess.com',
  CLOUDFLARE_ACCESS_AUD: 'test-aud',
}));

test('28 Cloudflare Access JWT authorizes allowlisted viewer without local login', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  const token = signTestAccessJwt(privateKey, {
    kid: jwk.kid,
    iss: 'https://certifyd-test.cloudflareaccess.com',
    aud: 'test-aud',
    email: 'viewer@example.test',
    sub: 'viewer-user-id',
  });
  await withServer(async (base) => {
    const response = await fetch(`${base}/app/content/articles/core-explainer-001`, {
      headers: { 'cf-access-jwt-assertion': token },
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /viewer@example.test · viewer/);
    assert.doesNotMatch(html, /<button class="primary" type="submit">Approve<\/button>|Request Revision/);
  }, {
    CONTENT_DASHBOARD_AUTH_MODE: 'cloudflare-access',
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'certifyd-test.cloudflareaccess.com',
    CLOUDFLARE_ACCESS_AUD: 'test-aud',
    CLOUDFLARE_ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
  });
});



test('28b Cloudflare Access mode rejects invalid Access JWT and untrusted identity headers', async () => withServer(async (base) => {
  const noToken = await fetch(`${base}/app/content`, {
    redirect: 'manual',
    headers: {
      'x-forwarded-email': 'founder@example.test',
      'cf-access-authenticated-user-email': 'founder@example.test',
    },
  });
  assert.equal(noToken.status, 401);

  const randomToken = await fetch(`${base}/app/content`, {
    redirect: 'manual',
    headers: { 'cf-access-jwt-assertion': 'not.a.jwt' },
  });
  assert.equal(randomToken.status, 401);
}, {
  CONTENT_DASHBOARD_AUTH_MODE: 'cloudflare-access',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'certifyd-test.cloudflareaccess.com',
  CLOUDFLARE_ACCESS_AUD: 'test-aud',
}));

test('28c temporary tunnel mode still requires local login and preserves viewer RBAC', async () => withServer(async (base) => {
  const protectedResponse = await fetch(`${base}/app/content`, { redirect: 'manual' });
  assert.equal(protectedResponse.status, 303);
  assert.match(protectedResponse.headers.get('location'), /^\/app\/login\?returnTo=/);

  const loginPage = await fetch(`${base}/app/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Local access token/);

  const cookie = await login(base, 'viewer@example.test');
  assert.ok(cookie);

  const article = await fetch(`${base}/app/content/articles/core-explainer-001`, { headers: { cookie } });
  const articleHtml = await article.text();
  assert.equal(article.status, 200);
  assert.match(articleHtml, /viewer@example.test · viewer/);
  assert.doesNotMatch(articleHtml, /<button class="primary" type="submit">Approve<\/button>|Request Revision|Create Draft PR/);

  const settings = await fetch(`${base}/app/content/settings`, { headers: { cookie } });
  assert.equal(settings.status, 403);
}, {
  CONTENT_DASHBOARD_AUTH_MODE: 'cloudflare-access',
  ALLOW_TEMPORARY_TUNNEL_TESTING: 'true',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'certifyd-test.cloudflareaccess.com',
  CLOUDFLARE_ACCESS_AUD: 'test-aud',
}));

test('28d temporary tunnel mode does not trust client-controlled identity headers', async () => withServer(async (base) => {
  const response = await fetch(`${base}/app/content/settings`, {
    redirect: 'manual',
    headers: {
      'x-forwarded-email': 'founder@example.test',
      'cf-access-authenticated-user-email': 'founder@example.test',
    },
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /^\/app\/login\?returnTo=/);
}, {
  CONTENT_DASHBOARD_AUTH_MODE: 'cloudflare-access',
  ALLOW_TEMPORARY_TUNNEL_TESTING: 'true',
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'certifyd-test.cloudflareaccess.com',
  CLOUDFLARE_ACCESS_AUD: 'test-aud',
}));


test('29 health, readiness and version endpoints are public and machine-readable', async () => withServer(async (base) => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.deepEqual(healthBody, { status: 'ok' });
  assert.doesNotMatch(JSON.stringify(healthBody), /secret|token|database|db|path|user|email|github|key|version/i);

  const apiHealth = await fetch(`${base}/api/health`);
  assert.equal(apiHealth.status, 200);
  assert.deepEqual(await apiHealth.json(), { status: 'ok' });

  const ready = await fetch(`${base}/ready`);
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.ok, true);
  assert.equal(readyBody.authMode, 'local');

  const version = await fetch(`${base}/version`);
  assert.equal(version.status, 200);
  const versionBody = await version.json();
  assert.equal(versionBody.name, 'certifyd-content-dashboard');
  assert.ok(versionBody.version);
}));

test('22 existing public homepage still serves through dashboard server', async () => withServer(async (base) => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Certifyd/);
}));

test('23 existing public network page still serves through dashboard server', async () => withServer(async (base) => {
  const response = await fetch(`${base}/network.html`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Certifyd Network|Sovereign Node/);
}));

function signTestAccessJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: claims.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    email: claims.email,
    iat: now - 30,
    nbf: now - 30,
    exp: now + 300,
  })).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

async function createMinimalRun(runDir, options = {}) {
  await fs.mkdir(path.join(runDir, 'final'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'blog'), { recursive: true });
  const title = options.title || 'Minimal Run';
  const slug = options.slug || 'minimal-run';
  const excerpt = options.excerpt || options.summary || 'Minimal run excerpt for generated blog output.';
  const selectedEvidence = options.selectedEvidence === undefined ? [approvedBrainRecord()] : options.selectedEvidence;
  await fs.writeFile(path.join(runDir, 'intake.json'), JSON.stringify({ workingTitle: title, targetAudience: 'Investors', primaryTopic: 'Certifyd Blog' }));
  await fs.writeFile(path.join(runDir, 'publication-manifest.json'), JSON.stringify({
    title,
    slug,
    currentStatus: options.status || 'DRAFT',
    publishability: options.publishability || 'NEEDS_FOUNDER_REVIEW',
    canonicalUrl: `https://certifyd.me/blog/${slug}/`,
  }));
  await fs.writeFile(path.join(runDir, 'final', 'article.json'), JSON.stringify({
    title,
    slug,
    version: 'v1',
    excerpt,
    seoDescription: options.seoDescription || excerpt,
  }));
  await fs.writeFile(path.join(runDir, 'blog', 'blog-post.json'), JSON.stringify({
    title,
    slug,
    excerpt,
    description: excerpt,
    seoDescription: options.seoDescription || excerpt,
    coverImage: options.coverImage || '',
  }));
  await fs.writeFile(path.join(runDir, 'final', 'article.md'), options.markdown || `# ${title}\n\nBody.`);
  await fs.writeFile(path.join(runDir, 'claim-ledger.json'), JSON.stringify({ claims: [{ text: 'Safe claim', status: 'APPROVED' }] }));
  await fs.writeFile(path.join(runDir, 'research-record.json'), JSON.stringify(options.research || { selectedEvidence, claimsThatMustNotBeMade: [] }));
}

async function markVerifiedRun(runDir, version = 'v1') {
  const file = path.join(runDir, 'publication-manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.currentStatus = 'PUBLISHED';
  manifest.publishability = 'LIVE';
  manifest.liveVerifiedAt = new Date().toISOString();
  manifest.liveVerifiedVersion = version;
  const blog = JSON.parse(await fs.readFile(path.join(runDir, 'blog', 'blog-post.json'), 'utf8'));
  const markdown = await fs.readFile(path.join(runDir, 'final', 'article.md'), 'utf8');
  const source = { title: blog.title, markdown: publicArticleBodyMarkdown(blog.body, markdown, ''), excerpt: blog.description || blog.excerpt || 'Certifyd Blog', tags: [], featuredImage: blog.coverImage || '' };
  manifest.publishing = { version, canonicalUrl: manifest.canonicalUrl, articleHtmlHash: crypto.createHash('sha256').update('verified test article').digest('hex'), sourceFingerprint: crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex') };
  await fs.writeFile(file, JSON.stringify(manifest));
}

async function distributionSafetyFixture({ verified = true, status = 'PUBLISHED', envOverrides = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-distribution-safety-'));
  const outputDir = path.join(root, 'engine', 'outputs');
  const runId = 'safety-article-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, { title: 'Safety Article', slug: 'safety-article', status, publishability: status === 'PUBLISHED' ? 'LIVE' : 'READY_TO_PUBLISH' });
  if (verified) await markVerifiedRun(runDir);
  const config = getDashboardConfig({ ...env, ...envOverrides, CONTENT_AGENT_ROOT: root, CONTENT_AGENT_OUTPUT_DIR: outputDir, CONTENT_DASHBOARD_DB_PATH: ':memory:' });
  const actions = new ContentDashboardActions(config);
  const actor = { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
  const state = async () => JSON.parse(await fs.readFile(path.join(runDir, 'distribution', 'destinations.json'), 'utf8'));
  return { root, runDir, runId, actions, actor, state };
}

function fakeDestination(id, { connected = true, publish, update, supportsUpdate = false } = {}) {
  return {
    id,
    displayName: id,
    kind: 'full-article',
    supportsUpdate,
    connectionStatus: () => ({ status: connected ? 'connected' : 'not_connected' }),
    publishArticle: publish || (async () => ({ externalPostId: `${id}-post`, externalUrl: `https://example.test/${id}-post` })),
    updateArticle: update || (async () => ({ externalPostId: `${id}-post`, externalUrl: `https://example.test/${id}-post` })),
  };
}

test('distribution safety: canonical live verification gates automatic posting and canonical manual exports', async () => {
  const fixture = await distributionSafetyFixture({ verified: false, status: 'PUBLISHING' });
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'one' }; } }), ...fixture.actions.distributionAdapters.filter((item) => item.id === 'markdown')];
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto', 'markdown'] });
  assert.equal(calls, 0);
  assert.equal(result.results.find((item) => item.id === 'devto').status, 'queued');
  assert.equal(result.results.find((item) => item.id === 'markdown').status, 'queued');
  assert.match((await fixture.state()).destinations.devto.blockedReason, /verified live/);
});

test('distribution safety: editing the approved source invalidates its live distribution gate', async () => {
  const fixture = await distributionSafetyFixture();
  await fs.writeFile(path.join(fixture.runDir, 'final', 'article.md'), '# Safety Article\n\nChanged after live verification.');
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'bad' }; } })];
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(result.results[0].status, 'queued');
  assert.equal(calls, 0);
});

test('distribution safety: dashboard shows the canonical block and single-destination recovery controls', async () => {
  const fixture = await distributionSafetyFixture({ verified: false, status: 'PUBLISHING' });
  const dir = path.join(fixture.runDir, 'distribution');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'destinations.json'), JSON.stringify({ destinations: {
    devto: { status: 'queued', blockedReason: 'Verify Live before automatic distribution.' },
    ghost: { status: 'failed', uncertainAcceptance: false, lastError: 'Credentials missing.' },
    hashnode: { status: 'uncertain', uncertainAcceptance: true, lastError: 'Check the platform.', attemptHistory: [{ startedAt: '2026-10-24T00:00:00.000Z', articleVersion: 'v1', operation: 'publish', result: 'uncertain' }] },
  } }));
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/distribution?runId=${fixture.runId}`, { headers: { cookie } });
    const html = await response.text();
    assert.match(html, /Verify Live before automatic distribution/);
    assert.match(html, /Retry Ghost/);
    assert.match(html, /Confirm external post/);
    assert.doesNotMatch(html, /Retry failed destinations/);
  }, { CONTENT_AGENT_ROOT: fixture.root, CONTENT_AGENT_OUTPUT_DIR: path.join(fixture.root, 'engine', 'outputs'), CONTENT_DASHBOARD_DB_PATH: ':memory:' });
});

test('distribution safety: a GitHub write remains pending until the exact public page verifies', async () => {
  const fixture = await distributionSafetyFixture({ verified: false, status: 'READY_TO_PUBLISH' });
  let calls = 0;
  fixture.actions.distributionAdapters = [fixture.actions.distributionAdapters.find((item) => item.id === 'certifyd'), fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'one' }; } })];
  const html = '<html><title>Safety Article</title><link rel="canonical" href="https://certifyd.me/blog/safety-article/"><article>Exact version</article><footer><a href="mailto:hello@certifyd.me">hello@certifyd.me</a></footer></html>';
  const encodeEmail = (email, key) => Buffer.from([key, ...Buffer.from(email).map((byte) => byte ^ key)]).toString('hex');
  const protectedHtml = html.replace(
    '<a href="mailto:hello@certifyd.me">hello@certifyd.me</a>',
    `<a href="/cdn-cgi/l/email-protection#${encodeEmail('hello@certifyd.me', 0x23)}"><span class="__cf_email__" data-cfemail="${encodeEmail('hello@certifyd.me', 0xb6)}">[email&#160;protected]</span></a>`,
  ).replace('</html>', '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script></html>');
  const manifestPath = path.join(fixture.runDir, 'publication-manifest.json');
  fixture.actions.publishToCertifyd = async ({ version }) => {
    await markVerifiedRun(fixture.runDir, version);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.currentStatus = 'PUBLISHING';
    manifest.publishability = 'PUBLISHING_DEPLOYMENT';
    manifest.liveVerifiedAt = '';
    manifest.liveVerifiedVersion = '';
    manifest.publishing.articleHtmlHash = crypto.createHash('sha256').update(html).digest('hex');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    return { canonicalUrl: manifest.canonicalUrl };
  };
  const requested = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['certifyd', 'devto'] });
  assert.equal(requested.results[0].status, 'publishing');
  assert.equal(calls, 0);
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(fixture.actions.verifyLivePublication({ actor: fixture.actor, runId: fixture.runId }), /not available/);
    globalThis.fetch = async () => new Response('<html><title>Safety Article</title><article>Old version</article></html>', { status: 200 });
    await assert.rejects(fixture.actions.verifyLivePublication({ actor: fixture.actor, runId: fixture.runId }), /exact published version/);
    globalThis.fetch = async () => new Response(protectedHtml.replace('Exact version', 'Tampered version'), { status: 200 });
    await assert.rejects(fixture.actions.verifyLivePublication({ actor: fixture.actor, runId: fixture.runId }), /exact published version/);
    assert.equal(calls, 0);
    globalThis.fetch = async () => new Response(protectedHtml, { status: 200 });
    await fixture.actions.verifyLivePublication({ actor: fixture.actor, runId: fixture.runId });
  } finally { globalThis.fetch = oldFetch; }
  const sent = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(sent.results[0].status, 'sent');
  assert.equal(calls, 1);
  assert.equal((await fixture.state()).destinations.certifyd.status, 'published');
});

test('distribution safety: canonical publisher failure leaves automatic destinations blocked', async () => {
  const fixture = await distributionSafetyFixture({ verified: false, status: 'READY_TO_PUBLISH' });
  let calls = 0;
  fixture.actions.distributionAdapters = [fixture.actions.distributionAdapters.find((item) => item.id === 'certifyd'), fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'bad' }; } })];
  fixture.actions.publishToCertifyd = async () => { throw new Error('GitHub write failed'); };
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['certifyd', 'devto'] });
  assert.equal(result.results.find((item) => item.id === 'certifyd').status, 'failed');
  assert.equal(result.results.find((item) => item.id === 'devto').status, 'queued');
  assert.equal(calls, 0);
  assert.match((await fixture.state()).destinations.devto.blockedReason, /GitHub write failed/);
});

test('distribution safety: malformed persisted state fails closed', async () => {
  const fixture = await distributionSafetyFixture();
  const dir = path.join(fixture.runDir, 'distribution');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'destinations.json'), '{broken');
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'bad' }; } })];
  await assert.rejects(fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] }), /avoid duplicate posts/);
  assert.equal(calls, 0);
});

test('distribution safety: disconnected destination skips without affecting confirmed destinations', async () => {
  const fixture = await distributionSafetyFixture();
  let goodCalls = 0;
  let failedCalls = 0;
  fixture.actions.distributionAdapters = [
    fakeDestination('devto', { publish: async () => { goodCalls++; return { externalPostId: 'good', externalUrl: 'https://example.test/good' }; } }),
    fakeDestination('wordpress', { connected: false, publish: async () => { failedCalls++; return { externalPostId: 'bad' }; } }),
  ];
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto', 'wordpress'] });
  let state = await fixture.state();
  assert.equal(goodCalls, 1);
  assert.equal(failedCalls, 0);
  assert.equal(state.destinations.devto.status, 'sent');
  assert.equal(state.destinations.wordpress.status, 'skipped');
  assert.equal(result.results.find((item) => item.id === 'wordpress').status, 'skipped');
  fixture.actions.distributionAdapters[1] = fakeDestination('wordpress', { publish: async () => { failedCalls++; return { externalPostId: 'wordpress-id', externalUrl: 'https://example.test/wordpress' }; } });
  const later = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto', 'wordpress'] });
  assert.equal(later.results.find((item) => item.id === 'devto').skipped, true);
  state = await fixture.state();
  assert.equal(goodCalls, 1);
  assert.equal(failedCalls, 1);
  assert.equal(state.destinations.devto.status, 'sent');
  assert.equal(state.destinations.wordpress.externalPostId, 'wordpress-id');
  assert.equal(state.destinations.wordpress.attemptHistory.length, 1);
});

test('distribution safety: an in-flight request is durable, uncertain, and never blindly retried', async () => {
  const fixture = await distributionSafetyFixture();
  let seen;
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; seen = await fixture.state(); throw new Error('response lost'); } })];
  const first = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(seen.destinations.devto.status, 'sending');
  assert.equal(seen.destinations.devto.attemptHistory[0].result, 'in_flight');
  assert.equal(first.results[0].status, 'uncertain');
  const repeated = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(repeated.results[0].status, 'uncertain');
  assert.equal(calls, 1);
  await assert.rejects(fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', retryFailed: true, destinationId: 'devto' }), /reconciled first/);
  await fixture.actions.resolveDistributionOutcome({ actor: fixture.actor, runId: fixture.runId, destinationId: 'devto', resolution: 'not_published' });
  fixture.actions.distributionAdapters = [fakeDestination('devto')];
  const retried = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', retryFailed: true, destinationId: 'devto' });
  assert.equal(retried.results[0].status, 'sent');
  assert.equal((await fixture.state()).destinations.devto.attemptHistory.length, 2);
});

test('distribution safety: success requires external identity and repeat publish skips confirmed post', async () => {
  const fixture = await distributionSafetyFixture();
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'post-1', externalUrl: 'https://example.test/post-1' }; } })];
  await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  const second = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(calls, 1);
  assert.equal(second.results[0].skipped, true);
  const state = await fixture.state();
  assert.equal(state.destinations.devto.externalPostId, 'post-1');
  assert.equal(state.destinations.devto.externalUrl, 'https://example.test/post-1');
  assert.equal(state.destinations.devto.attemptHistory.length, 1);
  const missing = await distributionSafetyFixture();
  missing.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => ({ externalUrl: 'https://example.test/unknown' }) })];
  const result = await missing.actions.distributeArticle({ actor: missing.actor, runId: missing.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(result.results[0].status, 'uncertain');
  assert.equal((await missing.state()).destinations.devto.externalUrl, 'https://example.test/unknown');
});

test('distribution safety: recovered in-flight state requires reconciliation', async () => {
  const fixture = await distributionSafetyFixture();
  const dir = path.join(fixture.runDir, 'distribution');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'destinations.json'), JSON.stringify({ destinations: { devto: { status: 'sending', attemptHistory: [{ attemptId: 'lost-attempt', articleVersion: 'v1', result: 'in_flight' }] } } }));
  const abandonedLock = path.join(dir, '.operation-lock');
  await fs.mkdir(abandonedLock);
  await fs.writeFile(path.join(abandonedLock, 'owner.json'), JSON.stringify({ pid: 2147483647, startedAt: '2020-01-01T00:00:00.000Z' }));
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; return { externalPostId: 'x' }; } })];
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(result.results[0].status, 'uncertain');
  assert.equal(calls, 0);
  assert.equal((await fixture.state()).destinations.devto.status, 'uncertain');
  assert.equal((await fixture.state()).destinations.devto.attemptHistory[0].uncertain, true);
});

test('distribution safety: a founder can reconcile a confirmed external post without sending again', async () => {
  const fixture = await distributionSafetyFixture();
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; throw new Error('response lost'); } })];
  await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  await fixture.actions.resolveDistributionOutcome({ actor: fixture.actor, runId: fixture.runId, destinationId: 'devto', resolution: 'confirmed', externalPostId: 'found-on-platform', externalUrl: 'https://example.test/found-on-platform' });
  const repeated = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(repeated.results[0].skipped, true);
  assert.equal(calls, 1);
  const state = await fixture.state();
  assert.equal(state.destinations.devto.externalPostId, 'found-on-platform');
  assert.equal(state.destinations.devto.externalUrl, 'https://example.test/found-on-platform');
  assert.equal(state.destinations.devto.attemptHistory[0].resolution, 'confirmed');
});

test('distribution safety: existing update adapter can update a new verified version', async () => {
  const fixture = await distributionSafetyFixture();
  let creates = 0;
  let updates = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { supportsUpdate: true, publish: async () => { creates++; return { externalPostId: 'post-1', externalUrl: 'https://example.test/post-1' }; }, update: async () => { updates++; return { externalPostId: 'post-1', externalUrl: 'https://example.test/post-1' }; } })];
  await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  const articlePath = path.join(fixture.runDir, 'final', 'article.json');
  const article = JSON.parse(await fs.readFile(articlePath, 'utf8'));
  article.version = 'v2';
  await fs.writeFile(articlePath, JSON.stringify(article));
  await markVerifiedRun(fixture.runDir, 'v2');
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v2', destinations: ['devto'] });
  assert.equal(result.results[0].status, 'sent');
  assert.equal(creates, 1);
  assert.equal(updates, 1);
  assert.equal((await fixture.state()).destinations.devto.attemptHistory[1].operation, 'update');
});

test('distribution safety: a legacy confirmed post with changed payload uses its update path', async () => {
  const fixture = await distributionSafetyFixture();
  const dir = path.join(fixture.runDir, 'distribution');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'destinations.json'), JSON.stringify({ destinations: { devto: { status: 'sent', externalPostId: 'legacy-id', externalUrl: 'https://example.test/legacy', sentPayload: { title: 'Old title', bodyHash: 'old-body' } } } }));
  let updates = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { supportsUpdate: true, publish: async () => { throw new Error('Should not create'); }, update: async () => { updates++; return { externalPostId: 'legacy-id', externalUrl: 'https://example.test/legacy' }; } })];
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  assert.equal(result.results[0].status, 'sent');
  assert.equal(updates, 1);
  assert.equal((await fixture.state()).destinations.devto.attemptHistory[0].operation, 'update');
});

test('distribution safety: external errors redact configured secrets and authorization material', async () => {
  const secret = 'top-secret-distribution-token';
  const fixture = await distributionSafetyFixture({ envOverrides: { CONTENT_DISTRIBUTION_DEVTO_API_KEY: secret } });
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { throw new Error(`Bearer ${secret} Authorization: ${secret} sk-abcdefghijk`); } })];
  await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  const stored = JSON.stringify(await fixture.state());
  assert.doesNotMatch(stored, /top-secret-distribution-token|sk-abcdefghijk/);
  assert.match(stored, /\[redacted\]/);
});

test('distribution safety: a double click cannot start two operations for one article', async () => {
  const fixture = await distributionSafetyFixture();
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  fixture.actions.distributionAdapters = [fakeDestination('devto', { publish: async () => { calls++; started(); await held; return { externalPostId: 'once' }; } })];
  const first = fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] });
  await entered;
  await assert.rejects(fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto'] }), /already running/);
  release();
  await first;
  assert.equal(calls, 1);
});

function approvedBrainRecord(overrides = {}) {
  return {
    id: 'brain:facts/approved-public-claims',
    path: 'content-agent/knowledge/facts/approved-public-claims.md',
    title: 'Approved Public Claims',
    excerpt: 'Approved Certifyd public claims for grounded article generation.',
    ...overrides,
  };
}

test('published edits retain repository identity and replace stale social metadata', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-published-edit-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'published-edit-001';
  const runDir = path.join(outputDir, runId);
  await createMinimalRun(runDir, { title: 'Original', slug: 'original', status: 'PUBLISHED', seoDescription: 'Old broken description' });
  const manifestPath = path.join(runDir, 'publication-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.publishing = { repositoryPath: 'content/blog/original.md' };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const actions = new ContentDashboardActions(getDashboardConfig({ ...env, CONTENT_AGENT_ROOT: tmpRoot, CONTENT_AGENT_OUTPUT_DIR: outputDir, CONTENT_DASHBOARD_DB_PATH: ':memory:' }));
  await actions.saveArticleMarkdown({ actor: { id: 'founder', email: 'founder@example.test', role: 'founder' }, runId,
    articleMarkdown: '---\ntitle: "Edited"\nslug: "accidental-new-slug"\nexcerpt: "New excerpt"\nseoDescription: "Correct social summary"\n---\n\nUpdated body.' });
  const run = await actions.runs.readRun(runId);
  assert.equal(run.blogPackage.slug, 'original');
  assert.equal(run.blogPackage.canonicalUrl, 'https://certifyd.me/blog/original/');
  assert.equal(run.blogPackage.seoDescription, 'Correct social summary');
  assert.equal(run.blogPackage.description, 'Correct social summary');
  // Publisher must also defend identity if an older editor changes package fields.
  run.blogPackage.slug = 'accidental-new-slug';
  run.blogPackage.canonicalUrl = 'https://certifyd.me/blog/accidental-new-slug/';
  const publisher = new GitHubPullRequestPublisher({ githubPublishing: { enabled: true, owner: 'owner', repo: 'repo', token: 'test', mode: 'direct', baseBranch: 'main' } }, { readRun: async () => run });
  publisher.createInstallationToken = async () => 'test';
  publisher.buildGeneratedSiteFiles = async (slug, markdown) => {
    assert.equal(slug, 'original');
    assert.match(markdown, /slug: "original"/);
    assert.match(markdown, /seoDescription: "Correct social summary"/);
    return [];
  };
  publisher.publishMirrors = async () => [];
  const result = await publisher.createPullRequest({ actor: { email: 'founder@example.test' }, runId });
  assert.equal(result.repositoryPath, 'content/blog/original.md');
  assert.equal(result.canonicalUrl, 'https://certifyd.me/blog/original/');
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('distribution phase 2: Markdown exports render structure, safe links and escaped raw HTML', () => {
  const html = markdownToHtml('# Heading\n\nA **bold** and *italic* [link](https://certifyd.me).\n\n1. First\n2. Second\n\n> Quote\n\n`inline`\n\n```js\nconst x = 1;\n```\n\n---\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))');
  for (const tag of ['<h1>Heading</h1>', '<strong>bold</strong>', '<em>italic</em>', '<ol>', '<blockquote>', '<pre><code', '<hr>', '<code>inline</code>', '<a href="https://certifyd.me"']) assert.match(html, new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  const exported = buildDistributionAdapters().find((item) => item.id === 'html');
  const result = exported.publishArticle({ title: 'Test', markdown: '# Body', canonicalUrl: 'https://certifyd.me/blog/test/' });
  return result.then(({ exportContent }) => assert.match(exportContent, /<a href="https:\/\/certifyd\.me\/blog\/test\/">Certifyd<\/a>/));
});

test('distribution phase 2: DEV account test, create, update, and identity validation', async () => {
  const adapter = buildDistributionAdapters({ env: { CONTENT_DISTRIBUTION_DEVTO_API_KEY: 'private-key' } }).find((item) => item.id === 'devto');
  const article = { title: 'Article', markdown: '# Article', canonicalUrl: 'https://certifyd.me/blog/article/', excerpt: 'Summary', tags: ['Creator Rights'], featuredImage: '/images/blog/cover.jpg' };
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/users/me')) return Response.json({ id: 12, username: 'certifyd' });
    return Response.json({ id: 99, url: 'https://dev.to/certifyd/article' });
  };
  try {
    assert.equal((await adapter.testConnection()).status, 'connected');
    const created = await adapter.publishArticle(article);
    assert.equal(created.externalPostId, '99');
    assert.equal((await adapter.updateArticle(article, { externalPostId: '99' })).externalPostId, '99');
    assert.equal(calls[1].options.headers['api-key'], 'private-key');
    assert.equal(calls[1].options.headers.Accept, 'application/vnd.forem.api-v1+json');
    const payload = JSON.parse(calls[1].options.body).article;
    assert.equal(payload.main_image, 'https://certifyd.me/images/blog/cover.jpg');
    assert.equal(payload.tags, 'creatorrights');
    assert.equal(payload.canonical_url, article.canonicalUrl);
    await assert.rejects(adapter.updateArticle(article, { externalPostId: 'missing' }), /valid existing article ID/);
    globalThis.fetch = async () => Response.json({ id: 99 });
    await assert.rejects(adapter.publishArticle(article), /public URL/);
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    await assert.rejects(adapter.testConnection(), /HTTP 401/);
  } finally { globalThis.fetch = original; }
});

test('distribution phase 2: WordPress verifies account, publishes and reuses featured media on update', async () => {
  const adapter = buildDistributionAdapters({ env: { CONTENT_DISTRIBUTION_WORDPRESS_API_URL: 'https://wp.example.test', CONTENT_DISTRIBUTION_WORDPRESS_USERNAME: 'editor', CONTENT_DISTRIBUTION_WORDPRESS_APPLICATION_PASSWORD: 'app-pass', CONTENT_DISTRIBUTION_WORDPRESS_CANONICAL_META_KEY: 'certifyd_canonical' } }).find((item) => item.id === 'wordpress');
  const article = { title: 'Article', markdown: '# Article', canonicalUrl: 'https://certifyd.me/blog/article/', excerpt: 'Summary', featuredImage: '/images/blog/cover.jpg' };
  const original = globalThis.fetch;
  const calls = [];
  let canonical = true;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/users/me?context=edit')) return Response.json({ id: 4, name: 'Editor' });
    if (String(url).startsWith('https://certifyd.me/images/')) return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    if (String(url).endsWith('/media')) return Response.json({ id: 55 });
    if (String(url).includes('/wp-json/wp/v2/posts')) return Response.json({ id: 77, link: 'https://wp.example.test/article/' });
    if (String(url).endsWith('/article/')) return new Response(`<link rel="canonical" href="${canonical ? article.canonicalUrl : 'https://wp.example.test/article/'}">`);
    throw new Error('Unexpected request');
  };
  try {
    assert.equal((await adapter.testConnection()).status, 'connected');
    let checkpoint;
    const created = await adapter.publishArticle(article, {}, { checkpoint: async (value) => { checkpoint = value; } });
    assert.equal(created.externalPostId, '77');
    assert.equal(created.canonicalVerified, true);
    assert.equal(checkpoint.mediaId, 55);
    const body = JSON.parse(calls.find((call) => call.url.endsWith('/posts')).options.body);
    assert.equal(body.featured_media, 55);
    assert.equal(body.meta.certifyd_canonical, article.canonicalUrl);
    assert.match(body.content, /<a href="https:\/\/certifyd\.me\/blog\/article\/">Certifyd<\/a>/);
    canonical = false;
    const updated = await adapter.updateArticle(article, { externalPostId: '77', ...checkpoint });
    assert.equal(updated.canonicalVerified, false);
    assert.match(updated.canonicalWarning, /unverified/);
    assert.equal(calls.filter((call) => call.url.endsWith('/media')).length, 1);
    await assert.rejects(adapter.updateArticle(article, { externalPostId: 'invalid' }), /valid existing post ID/);
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    await assert.rejects(adapter.testConnection(), /HTTP 401/);
  } finally { globalThis.fetch = original; }
});

test('distribution phase 2: manual exports are visible, downloadable and can be recorded as external publication', async () => {
  const fixture = await distributionSafetyFixture();
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['markdown', 'html', 'email', 'pdf', 'medium', 'substack'] });
  assert.equal(result.results.filter((item) => item.status === 'manual_export_ready').length, 6);
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const response = await fetch(`${base}/app/content/distribution?runId=${fixture.runId}`, { headers: { Cookie: cookie } });
    const html = await response.text();
    assert.match(html, /View Markdown export content/);
    assert.match(html, /data-download-target=/);
    assert.match(html, /Mark as published externally/);
    assert.match(html, /Publish Everywhere/);
  }, { CONTENT_AGENT_ROOT: fixture.root, CONTENT_AGENT_OUTPUT_DIR: path.join(fixture.root, 'engine', 'outputs') });
  await fixture.actions.markManualExternallyPublished({ actor: fixture.actor, runId: fixture.runId, destinationId: 'medium', externalUrl: 'https://medium.com/@certifyd/article' });
  const state = await fixture.state();
  assert.equal(state.destinations.medium.status, 'published');
  assert.equal(state.destinations.medium.publicationMethod, 'manual');
  assert.equal(state.destinations.medium.articleVersion, 'v1');
  assert.equal(state.destinations.medium.canonicalUrl, 'https://certifyd.me/blog/safety-article/');
  assert.equal(state.destinations.medium.externalUrl, 'https://medium.com/@certifyd/article');
  assert.ok(state.destinations.medium.publishedExternallyAt);
});

test('distribution phase 2: Publish Everywhere preserves mixed destination results', async () => {
  const fixture = await distributionSafetyFixture();
  fixture.actions.distributionAdapters = [
    fakeDestination('devto', { publish: async () => ({ externalPostId: '101', externalUrl: 'https://dev.to/test/article' }) }),
    fakeDestination('wordpress', { publish: async () => { throw new Error('HTTP 503'); } }),
    fixture.actions.distributionAdapters.find((item) => item.id === 'markdown'),
  ];
  const result = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['devto', 'wordpress', 'markdown'] });
  assert.deepEqual(result.results.map((item) => item.status), ['sent', 'uncertain', 'manual_export_ready']);
  const state = await fixture.state();
  assert.equal(state.destinations.devto.status, 'sent');
  assert.equal(state.destinations.wordpress.status, 'uncertain');
  assert.equal(state.destinations.markdown.status, 'manual_export_ready');
});

test('distribution phase 2: connection tests persist only status and distinguish failed tests', async () => {
  const fixture = await distributionSafetyFixture({ envOverrides: { CONTENT_DISTRIBUTION_DEVTO_API_KEY: 'private-dev-key', CONTENT_DISTRIBUTION_DEVTO_USERNAME: 'certifyd' } });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ id: 8, username: 'certifyd' });
    assert.equal((await fixture.actions.testDistributionConnection({ actor: fixture.actor, destinationId: 'devto' })).ok, true);
    assert.equal((await fixture.actions.distributionOverview()).destinations.find((item) => item.id === 'devto').status, 'connected');
    let persisted = await fs.readFile(path.join(fixture.root, 'dashboard', 'distribution-connections.json'), 'utf8');
    assert.doesNotMatch(persisted, /private-dev-key|api-key|Authorization/);
    globalThis.fetch = async () => new Response('credential denied', { status: 401 });
    assert.equal((await fixture.actions.testDistributionConnection({ actor: fixture.actor, destinationId: 'devto' })).ok, false);
    assert.equal((await fixture.actions.distributionOverview()).destinations.find((item) => item.id === 'devto').status, 'connection_error');
    persisted = await fs.readFile(path.join(fixture.root, 'dashboard', 'distribution-connections.json'), 'utf8');
    assert.doesNotMatch(persisted, /credential denied|private-dev-key/);
  } finally { globalThis.fetch = original; }
});

test('Blogger OAuth: founder start, callback state, encrypted storage, connection test, and disconnect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blogger-oauth-'));
  const nativeFetch = globalThis.fetch;
  let tokenCalls = 0;
  let blogCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target === 'https://oauth2.googleapis.com/token') {
      tokenCalls++;
      assert.equal(new URLSearchParams(options.body).get('redirect_uri'), BLOGGER_REDIRECT_URI);
      return Response.json({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600 });
    }
    if (target.includes('/blogger/v3/users/self/blogs')) {
      blogCalls++;
      assert.equal(options.headers.Authorization, 'Bearer private-access-token');
      return Response.json({ items: [{ id: '12345', name: 'Certifyd Blogger' }] });
    }
    return nativeFetch(url, options);
  };
  try {
    await withServer(async (base) => {
      const founder = await login(base, 'founder@example.test');
      const editor = await login(base, 'editor@example.test');
      const page = await nativeFetch(`${base}/app/content/distribution`, { headers: { cookie: founder } });
      const html = await page.text();
      assert.match(html, /https:\/\/admin\.certifyd\.me\/app\/content\/oauth\/blogger\/callback/);
      assert.doesNotMatch(html, /private-client-secret|private-refresh-token|private-access-token/);
      const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
      const startPath = '/app/content/actions/distribution/blogger/connect';
      const body = new URLSearchParams({ _csrf: csrf });
      assert.equal((await nativeFetch(`${base}${startPath}`, { method: 'POST', redirect: 'manual', headers: { cookie: founder }, body: new URLSearchParams({ _csrf: 'bad' }) })).status, 403);
      assert.equal((await nativeFetch(`${base}${startPath}`, { method: 'POST', redirect: 'manual', headers: { cookie: editor }, body })).status, 403);
      const start = await nativeFetch(`${base}${startPath}`, { method: 'POST', redirect: 'manual', headers: { cookie: founder }, body });
      assert.equal(start.status, 303);
      const auth = new URL(start.headers.get('location'));
      assert.equal(auth.origin, 'https://accounts.google.com');
      assert.equal(auth.searchParams.get('redirect_uri'), BLOGGER_REDIRECT_URI);
      assert.equal(auth.searchParams.get('access_type'), 'offline');
      assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/blogger');
      const state = auth.searchParams.get('state');
      const callback = '/app/content/oauth/blogger/callback';
      assert.equal((await nativeFetch(`${base}${callback}?state=wrong&code=private-code`, { redirect: 'manual', headers: { cookie: founder } })).status, 403);
      assert.equal((await nativeFetch(`${base}${callback}?state=${state}&code=private-code`, { redirect: 'manual', headers: { cookie: editor } })).status, 403);
      const done = await nativeFetch(`${base}${callback}?state=${state}&code=private-code`, { redirect: 'manual', headers: { cookie: founder } });
      assert.equal(done.status, 303);
      assert.equal(done.headers.get('location'), '/app/content/distribution?blogger=connected');
      assert.equal(tokenCalls, 1);
      assert.equal(blogCalls, 1);
      assert.equal((await nativeFetch(`${base}${callback}?state=${state}&code=private-code`, { redirect: 'manual', headers: { cookie: founder } })).status, 403);
      const storedPath = path.join(root, 'dashboard', 'blogger-oauth.enc.json');
      const stored = await fs.readFile(storedPath, 'utf8');
      assert.doesNotMatch(stored, /private-refresh-token|private-access-token|private-client-secret/);
      assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);
      assert.notEqual((await nativeFetch(`${base}/content-agent/dashboard/blogger-oauth.enc.json`)).status, 200);
      const tested = await nativeFetch(`${base}/app/content/actions/distribution/test`, { method: 'POST', redirect: 'manual', headers: { cookie: founder }, body: new URLSearchParams({ _csrf: csrf, destinationId: 'blogger' }) });
      assert.equal(tested.status, 303);
      assert.equal(blogCalls, 2);
      const connection = await fs.readFile(path.join(root, 'dashboard', 'distribution-connections.json'), 'utf8');
      assert.doesNotMatch(connection, /private-refresh-token|private-access-token|private-client-secret/);
      const disconnected = await nativeFetch(`${base}/app/content/actions/distribution/blogger/disconnect`, { method: 'POST', redirect: 'manual', headers: { cookie: founder }, body });
      assert.equal(disconnected.status, 303);
      await assert.rejects(fs.stat(storedPath), { code: 'ENOENT' });
    }, { CONTENT_AGENT_ROOT: root, CONTENT_AGENT_OUTPUT_DIR: path.join(root, 'engine', 'outputs'), CONTENT_DASHBOARD_PUBLIC_URL: 'https://admin.certifyd.me', CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID: 'test-client', CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET: 'private-client-secret', CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID: '12345' });
  } finally { globalThis.fetch = nativeFetch; }
});

test('Blogger OAuth: missing refresh token, invalid credentials, and wrong blog fail closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blogger-oauth-failure-'));
  const config = getDashboardConfig({ ...env, CONTENT_AGENT_ROOT: root, CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID: 'test-client', CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET: 'private-client-secret', CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID: '12345', CONTENT_DASHBOARD_PUBLIC_URL: 'https://admin.certifyd.me' });
  const oauth = buildDistributionAdapters(config).find((item) => item.id === 'blogger').oauth;
  const actor = { id: 'founder@example.test', role: 'founder' };
  const nativeFetch = globalThis.fetch;
  try {
    let state = new URL(oauth.start({ actor, sessionId: 'session' })).searchParams.get('state');
    globalThis.fetch = async () => Response.json({ access_token: 'access-only', expires_in: 3600 });
    await assert.rejects(oauth.complete({ actor, sessionId: 'session', state, code: 'code' }), /refresh token/);
    assert.equal(await oauth.connected(), false);
    state = new URL(oauth.start({ actor, sessionId: 'session' })).searchParams.get('state');
    globalThis.fetch = async () => new Response('private credential details', { status: 401 });
    await assert.rejects(oauth.complete({ actor, sessionId: 'session', state, code: 'code' }), /HTTP 401/);
    state = new URL(oauth.start({ actor, sessionId: 'session' })).searchParams.get('state');
    globalThis.fetch = async (url) => String(url).includes('/token') ? Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 }) : Response.json({ items: [{ id: 'other-blog' }] });
    await assert.rejects(oauth.complete({ actor, sessionId: 'session', state, code: 'code' }), /cannot access/);
    assert.equal(await oauth.connected(), false);
  } finally { globalThis.fetch = nativeFetch; }
});

test('Blogger OAuth: expired access token refreshes before existing create/update requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blogger-refresh-'));
  const config = getDashboardConfig({ ...env, CONTENT_AGENT_ROOT: root, CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID: 'test-client', CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET: 'private-client-secret', CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID: '12345', CONTENT_DASHBOARD_PUBLIC_URL: 'https://admin.certifyd.me' });
  const adapter = buildDistributionAdapters(config).find((item) => item.id === 'blogger');
  const actor = { id: 'founder@example.test', role: 'founder' };
  const state = new URL(adapter.oauth.start({ actor, sessionId: 'session' })).searchParams.get('state');
  const nativeFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.includes('/token')) {
      const refresh = new URLSearchParams(options.body).get('grant_type') === 'refresh_token';
      return Response.json(refresh ? { access_token: 'fresh-access', expires_in: 3600 } : { access_token: 'expired-access', refresh_token: 'private-refresh', expires_in: 1 });
    }
    if (target.includes('/users/self/blogs')) return Response.json({ items: [{ id: '12345', name: 'Certifyd Blogger' }] });
    if (target.endsWith('/posts/')) return Response.json({ id: '98765', url: 'https://certifydcreator.blogspot.com/2026/10/article.html' });
    if (target.endsWith('/posts/98765')) return Response.json({ id: '98765', url: 'https://certifydcreator.blogspot.com/2026/10/article.html' });
    throw new Error('Unexpected mocked Blogger request');
  };
  try {
    await adapter.oauth.complete({ actor, sessionId: 'session', state, code: 'code' });
    const article = { title: 'Article', markdown: '# Article\n\nText', canonicalUrl: 'https://certifyd.me/blog/article/', tags: ['music'] };
    const created = await adapter.publishArticle(article);
    assert.equal(created.externalPostId, '98765');
    assert.equal(calls.filter((call) => call.target.includes('/token')).length, 2);
    const createCall = calls.find((call) => call.target.endsWith('/posts/'));
    assert.equal(createCall.options.headers.Authorization, 'Bearer fresh-access');
    assert.match(JSON.parse(createCall.options.body).content, /Originally published on/);
    const updated = await adapter.updateArticle(article, { externalPostId: '98765' });
    assert.equal(updated.externalPostId, '98765');
    assert.equal(calls.find((call) => call.target.endsWith('/posts/98765')).options.method, 'PUT');
    assert.equal(adapter.supportsDelete, false);
    await assert.rejects(adapter.updateArticle(article, { externalPostId: '' }), /valid existing post ID/);
    const testAdapter = buildDistributionAdapters(config).find((item) => item.id === 'blogger');
    assert.equal((await testAdapter.testConnection()).status, 'connected');
    assert.equal(calls.filter((call) => call.target.includes('/token')).length, 3);
  } finally { globalThis.fetch = nativeFetch; }
});

test('Blogger OAuth: verified blog joins canonical-first distribution once and preserves its post ID', async () => {
  const fixture = await distributionSafetyFixture({ envOverrides: { CONTENT_DASHBOARD_PUBLIC_URL: 'https://admin.certifyd.me', CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID: 'test-client', CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET: 'private-client-secret', CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID: '12345' } });
  const nativeFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/token')) return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 });
    if (target.includes('/users/self/blogs')) return Response.json({ items: [{ id: '12345', name: 'Certifyd Blogger' }] });
    if (target.endsWith('/posts/')) {
      posts++;
      assert.equal(options.headers.Authorization, 'Bearer private-access');
      return Response.json({ id: '98765', url: 'https://certifydcreator.blogspot.com/2026/10/article.html' });
    }
    throw new Error('Unexpected Blogger request');
  };
  try {
    const blocked = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['blogger'] });
    assert.equal(blocked.results[0].status, 'skipped');
    assert.equal(posts, 0);
    const state = new URL(fixture.actions.startBloggerConnection({ actor: fixture.actor, sessionId: 'session' })).searchParams.get('state');
    await fixture.actions.completeBloggerConnection({ actor: fixture.actor, sessionId: 'session', state, code: 'code' });
    assert.equal((await fixture.actions.testDistributionConnection({ actor: fixture.actor, destinationId: 'blogger' })).ok, true);
    const first = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['blogger'] });
    assert.equal(first.results[0].status, 'sent');
    assert.equal((await fixture.state()).destinations.blogger.externalPostId, '98765');
    const again = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['blogger'] });
    assert.equal(again.results[0].skipped, true);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = nativeFetch; }
});

test('distribution phase 2: WordPress media checkpoint survives failed post and retry does not reupload', async () => {
  const fixture = await distributionSafetyFixture({ envOverrides: { CONTENT_DISTRIBUTION_WORDPRESS_API_URL: 'https://wp.example.test', CONTENT_DISTRIBUTION_WORDPRESS_USERNAME: 'editor', CONTENT_DISTRIBUTION_WORDPRESS_APPLICATION_PASSWORD: 'app-pass' } });
  const blogFile = path.join(fixture.runDir, 'blog', 'blog-post.json');
  const blog = JSON.parse(await fs.readFile(blogFile, 'utf8'));
  blog.coverImage = '/images/blog/cover.jpg';
  await fs.writeFile(blogFile, JSON.stringify(blog));
  await markVerifiedRun(fixture.runDir);
  await fs.mkdir(path.join(fixture.root, 'dashboard'), { recursive: true });
  await fs.writeFile(path.join(fixture.root, 'dashboard', 'distribution-connections.json'), JSON.stringify({ wordpress: { status: 'connected', testedAt: new Date().toISOString() } }));
  const original = globalThis.fetch;
  let mediaCalls = 0;
  let postCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith('https://certifyd.me/images/')) return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    if (target.endsWith('/media')) { mediaCalls++; return Response.json({ id: 55 }); }
    if (target.endsWith('/posts')) { postCalls++; return postCalls === 1 ? new Response('failure', { status: 503 }) : Response.json({ id: 77, link: 'https://wp.example.test/article/' }); }
    if (target.endsWith('/article/')) return new Response('<link rel="canonical" href="https://certifyd.me/blog/safety-article/">');
    throw new Error('Unexpected request');
  };
  try {
    const first = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['wordpress'] });
    assert.equal(first.results[0].status, 'uncertain');
    assert.equal((await fixture.state()).destinations.wordpress.mediaId, 55);
    await fixture.actions.resolveDistributionOutcome({ actor: fixture.actor, runId: fixture.runId, destinationId: 'wordpress', resolution: 'not_published' });
    const retry = await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinationId: 'wordpress', retryFailed: true });
    assert.equal(retry.results[0].status, 'sent');
    assert.equal(mediaCalls, 1);
    assert.equal(postCalls, 2);
    assert.equal((await fixture.state()).destinations.wordpress.canonicalVerified, true);
  } finally { globalThis.fetch = original; }
});

test('distribution phase 2: Publish Everywhere form shows selected destinations and result summary', async () => {
  const fixture = await distributionSafetyFixture();
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const page = await (await fetch(`${base}/app/content/distribution?runId=${fixture.runId}`, { headers: { Cookie: cookie } })).text();
    const form = page.match(/<form[^>]+action="\/app\/content\/actions\/distribution\/publish"[\s\S]*?<\/form>/)?.[0] || '';
    assert.match(form, /data-publish-everywhere/);
    assert.match(form, /value="markdown" checked/);
    assert.match(page, /No publication attempt yet\. Checked destinations are ready for the next action\./);
    assert.doesNotMatch(page, /Not Selected/);
    const csrf = form.match(/name="_csrf" value="([^"]+)"/)?.[1];
    assert.ok(csrf);
    const response = await fetch(`${base}/app/content/actions/distribution/publish`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, runId: fixture.runId, version: 'v1', destinations: 'markdown' }), redirect: 'manual' });
    assert.equal(response.status, 200);
    const result = await response.text();
    assert.match(result, /Manual ready: <strong>1<\/strong>/);
    assert.match(result, /Confirmed: <strong>0<\/strong>/);
  }, { CONTENT_AGENT_ROOT: fixture.root, CONTENT_AGENT_OUTPUT_DIR: path.join(fixture.root, 'engine', 'outputs') });
  assert.equal((await fixture.state()).destinations.markdown.status, 'manual_export_ready');
});

test('distribution phase 2: edited article cannot expose or confirm a stale manual export', async () => {
  const fixture = await distributionSafetyFixture();
  await fixture.actions.distributeArticle({ actor: fixture.actor, runId: fixture.runId, version: 'v1', destinations: ['markdown'] });
  await fs.writeFile(path.join(fixture.runDir, 'final', 'article.md'), '# Safety Article\n\nChanged after the export was prepared.');
  await assert.rejects(fixture.actions.markManualExternallyPublished({ actor: fixture.actor, runId: fixture.runId, destinationId: 'markdown', externalUrl: 'https://example.test/article' }), /verified live/);
  await withServer(async (base) => {
    const cookie = await login(base, 'founder@example.test');
    const page = await (await fetch(`${base}/app/content/distribution?runId=${fixture.runId}`, { headers: { Cookie: cookie } })).text();
    assert.match(page, /Export is stale/);
    assert.doesNotMatch(page, /View Markdown export content/);
  }, { CONTENT_AGENT_ROOT: fixture.root, CONTENT_AGENT_OUTPUT_DIR: path.join(fixture.root, 'engine', 'outputs') });
});
