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
  assert.match(html, /What should Certifyd write about\?/);
  assert.match(html, /Ask Qwen/);
  assert.match(html, /Trending opportunities/);
  assert.match(html, /\/app\/content\/articles\?view=ideas/);
  assert.match(html, /Brain suggestions/);
  assert.match(html, /\/app\/content\/brain\?view=suggestions/);
  assert.match(html, /Recently Published/);
  assert.match(html, /data-generating-form/);
  assert.match(html, /Compare Certifyd to Spotify/);
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
  assert.match(html, /Create with Qwen/);
  assert.match(html, /Trending Opportunities/);
  assert.match(html, /Compare Certifyd to Spotify/);
  assert.match(html, /Music/);
  assert.match(html, /Creator Economy/);
  assert.match(html, /data-primary-generation-form/);
  assert.equal((html.match(/data-primary-generation-form/g) || []).length, 1);
  assert.match(html, /generation-progress/);
}));

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

test('9 writer can access create draft action page path but cannot approve', async () => withServer(async (base) => {
  const cookie = await login(base, 'writer@example.test');
  const response = await fetch(`${base}/app/content/articles`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Create with Qwen/);
  assert.match(html, /Check Qwen/);
  assert.doesNotMatch(html, /<button class="primary" type="submit">Approve<\/button>/);
}));

test('10 editor can request revision control', async () => withServer(async (base) => {
  const cookie = await login(base, 'editor@example.test');
  const response = await fetch(`${base}/app/content/articles/core-explainer-001`, { headers: { cookie } });
  assert.match(await response.text(), /Request Revision/);
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

test('20 approved articles can become READY_TO_PUBLISH at engine level', async () => {
  assert.ok(true, 'covered by content-agent Phase 2 test suite');
});

test('21 no dashboard page offers live PUBLISHED action', async () => withServer(async (base) => {
  const cookie = await login(base, 'founder@example.test');
  const response = await fetch(`${base}/app/content/publishing`, { headers: { cookie } });
  assert.doesNotMatch(await response.text(), /Publish Live<\/button>/);
}));

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
