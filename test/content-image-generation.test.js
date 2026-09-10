import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContentDashboardServer } from '../scripts/content-dashboard/server.js';
import { getDashboardConfig } from '../scripts/content-dashboard/config.js';
import { ContentDashboardActions } from '../scripts/content-dashboard/actions.js';
import { buildImageBrief, readImageGenerationState, setFrontmatterValue } from '../scripts/content-dashboard/image-generation.js';

const env = {
  ...process.env,
  CONTENT_DASHBOARD_ENABLED: 'true',
  CONTENT_DASHBOARD_SESSION_SECRET: 'test-secret-for-image-tests',
  CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN: 'test-token',
  CONTENT_DASHBOARD_FOUNDER_EMAILS: 'founder@example.test',
  CONTENT_AGENT_ROOT: '/tmp/certifyd-image-test-agent',
  CONTENT_DASHBOARD_DB_PATH: ':memory:',
  BLOG_IMAGE_ENABLED: 'true',
  BLOG_IMAGE_MODEL: 'test-image-model',
};

test('blog image brief uses article signals and image style guide only', async () => {
  const { config, run } = await fixture();
  const brief = await buildImageBrief(config, run);
  assert.match(brief.imageBrief, /Story: Spotify Bundling Ruling/);
  assert.match(brief.prompt, /Certifyd Blog Image Style Guide/);
  assert.match(brief.prompt, /No text baked into image/);
  assert.match(brief.prompt, /Subscription packaging/);
});

test('mocked image generation saves site-local pending asset without approving cover', async () => {
  const { config, outputDir, siteRoot, runId } = await fixture();
  const calls = [];
  config.blogImages.providerImpl = mockProvider(calls);
  const actions = new ContentDashboardActions(config);
  const actor = founder();

  const result = await actions.generateCoverImage({
    actor,
    runId,
    imageBrief: 'Physical royalty statement wrapped in subscription packaging.',
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const state = await readImageGenerationState(config, runId);
  assert.equal(state.imageStatus, 'generated');
  assert.equal(state.provider, 'mock-openai');
  assert.equal(state.model, 'test-image-model');
  assert.equal(state.imageRevision, 1);
  assert.match(state.generatedImagePath, /^\/images\/blog\/\d{4}\/\d{2}\/spotify-bundling-ruling-r1\.png$/);
  assert.equal(state.approvedImagePath, '');
  await fs.stat(path.join(siteRoot, state.generatedImagePath.slice(1)));
  const blogPackage = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.coverImage, '/images/existing-cover.png');
});

test('image approval writes only cover image metadata and Markdown frontmatter', async () => {
  const { config, outputDir, runId } = await fixture();
  config.blogImages.providerImpl = mockProvider();
  const actions = new ContentDashboardActions(config);
  const actor = founder();

  await actions.generateCoverImage({ actor, runId, imageBrief: 'Magazine-style photo collage.' });
  const beforeMarkdown = await fs.readFile(path.join(outputDir, runId, 'final', 'article.md'), 'utf8');
  const result = await actions.approveGeneratedCoverImage({ actor, runId });
  const afterMarkdown = await fs.readFile(path.join(outputDir, runId, 'final', 'article.md'), 'utf8');
  const state = await readImageGenerationState(config, runId);
  const blogPackage = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'blog', 'blog-post.json'), 'utf8'));

  assert.equal(result.ok, true);
  assert.equal(state.imageStatus, 'approved');
  assert.equal(state.approvedImagePath, state.generatedImagePath);
  assert.equal(blogPackage.coverImage, state.generatedImagePath);
  assert.equal(blogPackage.title, 'Spotify Bundling Ruling');
  assert.match(afterMarkdown, new RegExp(`coverImage: "${state.generatedImagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(afterMarkdown, /# Spotify Bundling Ruling\n\nSubscription packaging body stays intact\./);
  assert.equal(afterMarkdown.replace(/coverImage: ".*"/, 'coverImage: "/images/existing-cover.png"'), beforeMarkdown);
});

test('regeneration creates a new revision while preserving previous approved image', async () => {
  const { config, runId } = await fixture();
  config.blogImages.providerImpl = mockProvider();
  const actions = new ContentDashboardActions(config);
  const actor = founder();

  await actions.generateCoverImage({ actor, runId, imageBrief: 'First image.' });
  await actions.approveGeneratedCoverImage({ actor, runId });
  const approved = await readImageGenerationState(config, runId);

  await actions.generateCoverImage({ actor, runId, imageBrief: 'Second image.' });
  const regenerated = await readImageGenerationState(config, runId);
  assert.equal(regenerated.imageStatus, 'generated');
  assert.equal(regenerated.imageRevision, 2);
  assert.match(regenerated.generatedImagePath, /-r2\.png$/);
  assert.equal(regenerated.approvedImagePath, approved.approvedImagePath);
});

test('logo composite uses exact canonical logo and can be approved as cover', async () => {
  const { config, siteRoot, runId } = await fixture();
  config.blogImages.providerImpl = mockProvider();
  const actions = new ContentDashboardActions(config);

  await actions.generateCoverImage({
    actor: founder(),
    runId,
    imageBrief: 'Cover with exact logo overlay.',
    logoEnabled: 'true',
    logoPosition: 'top-left',
  });
  const state = await readImageGenerationState(config, runId);
  assert.equal(state.logoEnabled, true);
  assert.equal(state.logoPosition, 'top-left');
  assert.match(state.brandedImagePath, /-logo\.svg$/);
  const svg = await fs.readFile(path.join(siteRoot, state.brandedImagePath.slice(1)), 'utf8');
  assert.match(svg, /certifyd-base64-logo-test/);
  await actions.approveGeneratedCoverImage({ actor: founder(), runId });
  const approved = await readImageGenerationState(config, runId);
  assert.equal(approved.approvedImagePath, state.brandedImagePath);
});

test('provider failure records failed status and does not fail article state', async () => {
  const { config, outputDir, runId } = await fixture();
  config.blogImages.providerImpl = { generate: async () => { throw new Error('mock provider offline'); } };
  const actions = new ContentDashboardActions(config);

  const result = await actions.generateCoverImage({ actor: founder(), runId, imageBrief: 'Should fail gracefully.' });
  assert.equal(result.ok, false);
  const state = await readImageGenerationState(config, runId);
  assert.equal(state.imageStatus, 'failed');
  assert.match(state.error, /mock provider offline/);
  const blogPackage = JSON.parse(await fs.readFile(path.join(outputDir, runId, 'blog', 'blog-post.json'), 'utf8'));
  assert.equal(blogPackage.coverImage, '/images/existing-cover.png');
});

test('image controls route exposes generate and approval actions', async () => {
  const { config, runId } = await fixture();
  await withServer(config, async (base) => {
    const cookie = await login(base);
    const response = await fetch(`${base}/app/content/articles/${runId}`, { headers: { cookie } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Image brief/);
    assert.match(html, /\/app\/content\/actions\/publishing\/image-generate/);
    assert.match(html, /Generate cover/);
  });
});

test('image action route redirects back to cover section', async () => {
  const { config, runId } = await fixture();
  config.blogImages.providerImpl = mockProvider();
  await withServer(config, async (base) => {
    const cookie = await login(base);
    const article = await fetch(`${base}/app/content/articles/${runId}`, { headers: { cookie } });
    const html = await article.text();
    const csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1] || '';
    const response = await fetch(`${base}/app/content/actions/publishing/image-generate`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, runId, imageBrief: 'Mock cover.' }),
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `/app/content/articles/${runId}#cover-image`);
  });
});

test('frontmatter setter updates only coverImage when frontmatter exists', () => {
  const markdown = '---\ntitle: "Keep Title"\ncoverImage: "/images/old.png"\ntags: ["music"]\n---\n\n# Keep Title\n\nBody.';
  const next = setFrontmatterValue(markdown, 'coverImage', '/images/new.png');
  assert.match(next, /title: "Keep Title"/);
  assert.match(next, /coverImage: "\/images\/new\.png"/);
  assert.match(next, /tags: \["music"\]/);
  assert.match(next, /# Keep Title\n\nBody\./);
});

async function fixture() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blog-image-'));
  const siteRoot = path.join(tmpRoot, 'site');
  const outputDir = path.join(tmpRoot, 'engine', 'outputs');
  const runId = 'image-run-001';
  await fs.mkdir(path.join(siteRoot, 'images'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'image-generation'), { recursive: true });
  await fs.writeFile(path.join(siteRoot, 'images', 'certifyd_logo_transparent.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="428" height="138" viewBox="0 0 428 138"><g id="certifyd-base64-logo-test"/></svg>');
  await fs.writeFile(path.join(tmpRoot, 'image-generation', 'style-guide.md'), '# Certifyd Blog Image Style Guide\n\nNo text baked into image. Use analog editorial imagery.');
  await createMinimalRun(path.join(outputDir, runId));
  const config = getDashboardConfig({
    ...env,
    CONTENT_AGENT_ROOT: tmpRoot,
    CONTENT_AGENT_OUTPUT_DIR: outputDir,
    BLOG_IMAGE_STYLE_GUIDE_PATH: path.join(tmpRoot, 'image-generation', 'style-guide.md'),
    BLOG_IMAGE_CANONICAL_LOGO_PATH: path.join(siteRoot, 'images', 'certifyd_logo_transparent.svg'),
  });
  config.siteRoot = siteRoot;
  const run = await new ContentDashboardActions(config).runs.readRun(runId);
  return { config, outputDir, runId, run, siteRoot };
}

async function createMinimalRun(runDir) {
  await fs.mkdir(path.join(runDir, 'final'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'blog'), { recursive: true });
  const markdown = [
    '---',
    'title: "Spotify Bundling Ruling"',
    'slug: "spotify-bundling-ruling"',
    'coverImage: "/images/existing-cover.png"',
    '---',
    '',
    '# Spotify Bundling Ruling',
    '',
    'Subscription packaging body stays intact.',
  ].join('\n');
  await fs.writeFile(path.join(runDir, 'intake.json'), JSON.stringify({ workingTitle: 'Spotify Bundling Ruling', targetAudience: 'Music business readers' }));
  await fs.writeFile(path.join(runDir, 'publication-manifest.json'), JSON.stringify({ title: 'Spotify Bundling Ruling', slug: 'spotify-bundling-ruling', currentStatus: 'DRAFT', canonicalUrl: 'https://certifyd.me/blog/spotify-bundling-ruling/' }));
  await fs.writeFile(path.join(runDir, 'final', 'article.json'), JSON.stringify({ title: 'Spotify Bundling Ruling', slug: 'spotify-bundling-ruling', excerpt: 'Subscription packaging is becoming an input into music royalty economics.' }));
  await fs.writeFile(path.join(runDir, 'final', 'article.md'), markdown);
  await fs.writeFile(path.join(runDir, 'final-article.md'), markdown);
  await fs.writeFile(path.join(runDir, 'draft.md'), markdown);
  await fs.writeFile(path.join(runDir, 'blog', 'blog-post.md'), markdown);
  await fs.writeFile(path.join(runDir, 'blog', 'blog-post.json'), JSON.stringify({
    title: 'Spotify Bundling Ruling',
    slug: 'spotify-bundling-ruling',
    excerpt: 'Subscription packaging is becoming an input into music royalty economics.',
    description: 'Subscription packaging is becoming an input into music royalty economics.',
    coverImage: '/images/existing-cover.png',
    tags: ['music', 'streaming'],
  }));
  await fs.writeFile(path.join(runDir, 'claim-ledger.json'), JSON.stringify({ claims: [] }));
  await fs.writeFile(path.join(runDir, 'research-record.json'), JSON.stringify({ selectedEvidence: [] }));
}

function mockProvider(calls = []) {
  return {
    async generate(request) {
      calls.push(request);
      return {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
        contentType: 'image/png',
        provider: 'mock-openai',
        model: request.model,
      };
    },
  };
}

function founder() {
  return { id: 'founder@example.test', email: 'founder@example.test', role: 'founder' };
}

async function withServer(config, fn) {
  const server = createContentDashboardServer({ config });
  server.listen(0);
  await once(server, 'listening');
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function login(base) {
  const response = await fetch(`${base}/app/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'founder@example.test', token: 'test-token', returnTo: '/app/content/articles/image-run-001' }),
  });
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}
