import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createContentDashboardServer } from '../scripts/content-dashboard/server.js';
import { getDashboardConfig } from '../scripts/content-dashboard/config.js';

const runId = 'private-draft-fixture';
const privateMarker = 'PRIVATE DRAFT FIXTURE';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-static-security-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const siteRoot = path.join(root, 'site');
  const agentRoot = path.join(siteRoot, options.agentDirectory || 'content-agent');
  const outputDir = options.separateOutputs ? path.join(siteRoot, 'separate-drafts') : path.join(agentRoot, 'engine/outputs');
  const write = async (relative, content) => {
    const file = path.join(siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  await write('index.html', '<h1>PUBLIC HOME</h1>');
  const run = path.join(outputDir, runId);
  await fs.mkdir(path.join(run, 'final'), { recursive: true });
  await fs.mkdir(path.join(run, 'blog'), { recursive: true });
  await fs.writeFile(path.join(run, 'final/article.md'), `# Fixture article\n\n${privateMarker}`);
  await fs.writeFile(path.join(run, 'final/article.json'), JSON.stringify({ title: 'Fixture article', slug: 'fixture-article', version: 'v1' }));
  await fs.writeFile(path.join(run, 'publication-manifest.json'), JSON.stringify({ currentStatus: 'PENDING_FOUNDER_REVIEW', publishability: 'NEEDS_FOUNDER_REVIEW' }));
  await fs.writeFile(path.join(run, 'blog/blog-post.json'), JSON.stringify({ title: 'Fixture article', slug: 'fixture-article', body: privateMarker }));
  const config = {
    ...getDashboardConfig({
      CONTENT_DASHBOARD_ENABLED: 'true',
      CONTENT_DASHBOARD_SESSION_SECRET: 'isolated-static-fixture-secret',
      CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN: 'isolated-static-fixture-token',
      CONTENT_DASHBOARD_FOUNDER_EMAILS: 'founder@example.test',
      CONTENT_AGENT_ROOT: agentRoot,
      CONTENT_AGENT_OUTPUT_DIR: outputDir,
      CONTENT_DASHBOARD_DB_PATH: ':memory:',
    }),
    siteRoot,
  };
  const server = createContentDashboardServer({ config });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async () => {
    const response = await fetch(`${base}/app/login`, {
      method: 'POST', redirect: 'manual',
      body: new URLSearchParams({ email: 'founder@example.test', token: 'isolated-static-fixture-token', returnTo: '/app/content' }),
    });
    assert.equal(response.status, 303);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { root, siteRoot, agentRoot, outputDir, run, config, base, write, login };
}

test('static containment denies all private namespaces for anonymous GET and HEAD', async t => {
  const f = await fixture(t);
  const resources = [
    `content-agent/engine/outputs/${runId}/final/article.md`,
    'content-agent/engine/outputs/unknown-future-draft/draft.md',
    'content-agent/engine/outputs/private/reviews/founder-review.json',
    'content-agent/engine/outputs/private/model-requests/article-generation.json',
    'content-agent/dashboard/trash/old-version/final/article.md',
    'content-agent/review/dashboard-audit.log.jsonl',
    'content-agent/knowledge/constitution.md',
    'content-agent/source-material/evidence.json',
    'content-agent/index.html',
    '.tmp/prepared-revision/draft.md',
    '.codex-preserve/history.json',
    '.git/config',
    '.env.blog-engine.local',
    'deploy/admin/local.env',
    'node_modules/private-package/private.json',
  ];
  for (const resource of resources.filter(value => !value.includes('unknown-future'))) await f.write(resource, privateMarker);
  for (const resource of [...resources, 'content-agent', 'content-agent/dashboard', '.tmp']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${f.base}/${resource}`, { method });
      assert.equal(response.status, 403, `${method} /${resource}`);
      assert.doesNotMatch(await response.text(), /PRIVATE DRAFT FIXTURE/);
    }
  }
});

test('static containment preserves authenticated workspace preview and editing without raw-file access', async t => {
  const f = await fixture(t);
  const workspace = `${f.base}/app/content/articles/${runId}`;
  const anonymous = await fetch(workspace, { redirect: 'manual' });
  assert.equal(anonymous.status, 303);
  const cookie = await f.login();
  const response = await fetch(workspace, { headers: { cookie } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /PRIVATE DRAFT FIXTURE/);
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);
  for (const method of ['GET', 'HEAD']) {
    const raw = await fetch(`${f.base}/content-agent/engine/outputs/${runId}/final/article.md`, { method, headers: { cookie } });
    assert.equal(raw.status, 403);
  }
  const save = await fetch(`${f.base}/app/content/actions/article/save`, {
    method: 'POST', redirect: 'manual', headers: { cookie },
    body: new URLSearchParams({ _csrf: csrf, runId, articleMarkdown: '# Fixture article\n\nUPDATED PRIVATE FIXTURE' }),
  });
  assert.equal(save.status, 200);
  assert.match(await (await fetch(workspace, { headers: { cookie } })).text(), /UPDATED PRIVATE FIXTURE/);
  const manifest = JSON.parse(await fs.readFile(path.join(f.run, 'publication-manifest.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PENDING_FOUNDER_REVIEW');
});

test('static containment preserves public pages, assets, downloads, and well-known metadata', async t => {
  const f = await fixture(t);
  const resources = [
    ['index.html', 'PUBLIC HOME'], ['network.html', 'PUBLIC NETWORK'],
    ['blog/published/index.html', 'PUBLIC ARTICLE'], ['core/guide/index.html', 'PUBLIC GUIDE'],
    ['core/tunnel-setup/app.js', 'PUBLIC TUNNEL UI'], ['images/cover.svg', '<svg>PUBLIC IMAGE</svg>'],
    ['styles/main-site.css', '/* PUBLIC CSS */'], ['scripts/grouped-navigation.js', '/* PUBLIC NAV */'],
    ['scripts/content-dashboard/client.js', '/* PUBLIC WORKSPACE CLIENT */'],
    ['downloads/browser.apk', 'PUBLIC APK FIXTURE'], ['robots.txt', 'PUBLIC ROBOTS'],
    ['feed.xml', '<feed>PUBLIC FEED</feed>'], ['sitemap.xml', '<urlset/>'],
    ['.well-known/assetlinks.json', '[]'], ['public-indexnow-key.txt', 'PUBLIC INDEXNOW'],
  ];
  for (const [resource, body] of resources) await f.write(resource, body);
  for (const [resource, body] of resources) {
    const get = await fetch(`${f.base}/${resource}`);
    assert.equal(get.status, 200, resource);
    assert.equal(await get.text(), body);
    assert.equal((await fetch(`${f.base}/${resource}`, { method: 'HEAD' })).status, 200, resource);
  }
  assert.equal((await fetch(`${f.base}/core/guide/`)).status, 200);
  assert.equal((await fetch(`${f.base}/missing-public-file.css`)).status, 404);
});

test('static containment blocks encoded private paths, traversal, and symlink aliases', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.siteRoot, 'images'), { recursive: true });
  await fs.symlink(f.agentRoot, path.join(f.siteRoot, 'images/private-alias'));
  await fs.symlink(path.join(f.run, 'final/article.md'), path.join(f.siteRoot, 'images/private-alias.md'));
  const outside = path.join(f.root, 'site-sibling');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), privateMarker);
  await fs.symlink(outside, path.join(f.siteRoot, 'images/outside'));
  await fs.mkdir(path.join(f.siteRoot, 'public-directory'));
  await fs.symlink(path.join(f.run, 'final/article.md'), path.join(f.siteRoot, 'public-directory/index.html'));
  for (const resource of [
    `/content%2dagent/engine/outputs/${runId}/final/article.md`,
    `/images/..%2fcontent-agent/engine/outputs/${runId}/final/article.md`,
    `/images/private-alias/engine/outputs/${runId}/final/article.md`,
    '/images/private-alias.md', '/images/outside/secret.txt', '/public-directory/',
    '/..%2fsite-sibling/secret.txt',
  ]) {
    for (const method of ['GET', 'HEAD']) assert.equal((await fetch(f.base + resource, { method })).status, 403, resource);
  }
  for (const resource of ['/bad%ZZpath', '/bad%00path']) assert.equal((await fetch(f.base + resource)).status, 400);
});

test('static containment protects configured runtime roots outside the conventional namespace', async t => {
  const f = await fixture(t, { agentDirectory: 'private-runtime', separateOutputs: true });
  await f.write('private-runtime/knowledge/constitution.md', privateMarker);
  for (const resource of [
    '/private-runtime/knowledge/constitution.md', `/separate-drafts/${runId}/final/article.md`,
  ]) assert.equal((await fetch(f.base + resource)).status, 403, resource);
  assert.equal((await fetch(f.base + '/index.html')).status, 200);
});
