import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createContentDashboardServer } from '../scripts/content-dashboard/server.js';
import { getDashboardConfig } from '../scripts/content-dashboard/config.js';
import { validateRunId, safeReturnPath } from '../scripts/content-dashboard/security.js';
import { AuditLogRepository, ContentDashboardActions } from '../scripts/content-dashboard/actions.js';
import { ContentBrainRepository } from '../scripts/content-dashboard/repository.js';
import { KNOWLEDGE_SUGGESTIONS, applyKnowledgeSuggestion, listPendingKnowledgeSuggestions } from '../scripts/content-dashboard/brain-suggestions.js';
import { GitHubPullRequestPublisher } from '../scripts/content-dashboard/publisher.js';

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

test('4b article workspace owns full Qwen generation and trending opportunities', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/articles?view=ideas`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Blog Engine/);
  assert.match(html, /Article workspace/);
  assert.match(html, /What should Certifyd write about\?/);
  assert.match(html, /Ask Qwen/);
  assert.match(html, /Trending Opportunities/);
  assert.match(html, /Recent Source Stories/);
  assert.match(html, /No live trend scan has been saved yet/);
  assert.match(html, /Music/);
  assert.match(html, /Creator Economy/);
  assert.match(html, /data-primary-generation-form/);
  assert.equal((html.match(/data-primary-generation-form/g) || []).length, 1);
  assert.match(html, /generation-progress/);
}));


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
    assert.match(html, /90 collected · 15 retained · 13 recommended · 4 sources checked/);
    assert.match(html, /Trending Opportunities/);
    assert.match(html, /12 recommended/);
    assert.match(html, /Recent Source Stories/);
    assert.match(html, /Retained Source Story 15/);
    assert.match(html, /In recommended opportunity/);
    assert.match(html, /Source publication time is separate from fetched time/);
    assert.match(html, /Retention:/);
    assert.match(html, /Grouped into recommended opportunity/);
    assert.doesNotMatch(html, /Recommended Opportunity 13[\s\S]*Generate Article/);
    const jsonResponse = await fetch(`${base}/app/content/trends.json`, { headers: { cookie } });
    assert.equal(jsonResponse.status, 200);
    const trends = await jsonResponse.json();
    assert.equal(trends.items.length, 13);
    assert.equal(trends.sourceStories.length, 15);
    assert.equal(trends.summary.storiesCollected, 90);
    assert.equal(trends.sourceStories[0].retentionStatus, 'Recommended');
  }, { CONTENT_AGENT_ROOT: tmpRoot });
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
  assert.match(html, /Check Qwen/);
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

test('18 deterministic fallback is labelled accurately', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content`, { headers: { cookie } });
  assert.match(await response.text(), /Qwen|Deterministic Fallback|Unavailable/);
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
  assert.equal(devto.status, 'connected');
  assert.equal(wordpress.status, 'not_connected');
  assert.equal(linkedin.status, 'not_connected');
  assert.doesNotMatch(JSON.stringify(overview), /server-side-secret/);
});

test('20ac disconnected destination fails without blocking manual export distribution', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-dashboard-distribution-isolation-'));
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'distribution-ready-001';
  await createMinimalRun(path.join(outputDir, runId), {
    title: 'Distribution Ready',
    slug: 'distribution-ready',
    status: 'PUBLISHED',
    publishability: 'PUBLISHED',
  });
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
  assert.equal(result.results.find((item) => item.id === 'devto').status, 'failed');
  assert.equal(result.results.find((item) => item.id === 'markdown').status, 'manual_export_ready');
  const state = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'distribution', 'destinations.json'), 'utf8'));
  assert.equal(state.destinations.devto.status, 'failed');
  assert.equal(state.destinations.markdown.status, 'manual_export_ready');
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
  await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(tmpSiteRoot, 'node_modules'), 'dir');
  await fs.cp(path.join(process.cwd(), 'templates'), path.join(tmpSiteRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), 'scripts', 'build-blog.js'), path.join(tmpSiteRoot, 'scripts', 'build-blog.js'));
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
    assert.ok(treePosts[0].body.tree.some((entry) => entry.path === 'index.html'));
    assert.ok(treePosts[0].body.tree.some((entry) => entry.path === 'blog/index.html'));
    assert.ok(treePosts[0].body.tree.some((entry) => entry.path === 'content/blog/atomic-publish-test.md'));
    assert.ok(treePosts[0].body.tree.every((entry) => entry.sha));
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
  }));
  await fs.writeFile(path.join(runDir, 'final', 'article.md'), options.markdown || `# ${title}\n\nBody.`);
  await fs.writeFile(path.join(runDir, 'claim-ledger.json'), JSON.stringify({ claims: [{ text: 'Safe claim', status: 'APPROVED' }] }));
  await fs.writeFile(path.join(runDir, 'research-record.json'), JSON.stringify({ selectedEvidence, claimsThatMustNotBeMade: [] }));
}

function approvedBrainRecord(overrides = {}) {
  return {
    id: 'brain:facts/approved-public-claims',
    path: 'content-agent/knowledge/facts/approved-public-claims.md',
    title: 'Approved Public Claims',
    excerpt: 'Approved Certifyd public claims for grounded article generation.',
    ...overrides,
  };
}
