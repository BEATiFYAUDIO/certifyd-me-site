import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-blog.js');
const SEO_VALIDATE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'validate-seo.js');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates');

async function makeFixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-blog-test-'));
  await fs.mkdir(path.join(root, 'content', 'blog'), { recursive: true });
  await fs.mkdir(path.join(root, 'templates'), { recursive: true });
  await fs.mkdir(path.join(root, 'images'), { recursive: true });
  await fs.copyFile(path.join(TEMPLATE_DIR, 'blog-index.html'), path.join(root, 'templates', 'blog-index.html'));
  await fs.copyFile(path.join(TEMPLATE_DIR, 'blog-article.html'), path.join(root, 'templates', 'blog-article.html'));
  await fs.writeFile(path.join(root, 'index.html'), '<html><head><title>Certifyd</title><meta name="description" content="Certifyd test homepage."><link rel="canonical" href="https://certifyd.me/"><style></style></head><body><main>Home</main><!-- Lightboxes --></body></html>');
  await fs.writeFile(path.join(root, 'network.html'), '<html>Network</html>');
  await fs.writeFile(path.join(root, 'images', 'fallback.png'), 'x');
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(root, 'content', 'blog', name), body);
  }
  return root;
}

function runBuild(root) {
  return spawnSync(process.execPath, [BUILD_SCRIPT], { cwd: root, encoding: 'utf8' });
}

function article({ title, slug, date, status = 'published', excerpt = 'Sample excerpt.', coverImage = '/images/fallback.png', noindex = false }) {
  return `---\ntitle: "${title}"\nslug: "${slug}"\ndate: "${date}"\nupdated: "${date}"\nauthor: "Certifyd"\nexcerpt: "${excerpt}"\ncoverImage: "${coverImage}"\ntags:\n  - sample\nstatus: "${status}"\n${noindex ? 'noindex: true\n' : ''}---\n\n# ${title}\n\nBody.\n`;
}

test('build renders blog index, article pages, homepage section and metadata', async () => {
  const root = await makeFixture({
    'older.md': article({ title: 'Older Article', slug: 'older-article', date: '2026-07-20', excerpt: 'Unique older article description.' }),
    'newer.md': article({ title: 'Newer Article', slug: 'newer-article', date: '2026-07-26', excerpt: 'Unique newer article description.' }),
    'draft.md': article({ title: 'Draft Article', slug: 'draft-article', date: '2026-07-27', status: 'draft' }),
    'noindex.md': article({ title: 'Noindex Article', slug: 'noindex-article', date: '2026-07-28', noindex: true }),
  });
  const result = runBuild(root);
  assert.equal(result.status, 0, result.stderr);

  const index = await fs.readFile(path.join(root, 'blog', 'index.html'), 'utf8');
  assert.match(index, /Newer Article/);
  assert.match(index, /Older Article/);
  assert.doesNotMatch(index, /Draft Article/);
  assert.doesNotMatch(index, /Noindex Article/);
  assert.ok(index.indexOf('Newer Article') < index.indexOf('Older Article'));

  const articleHtml = await fs.readFile(path.join(root, 'blog', 'newer-article', 'index.html'), 'utf8');
  assert.match(articleHtml, /<link rel="canonical" href="https:\/\/certifyd\.me\/blog\/newer-article\/"/);
  assert.match(articleHtml, /<meta name="author" content="Certifyd"/);
  assert.match(articleHtml, /property="og:image"/);
  assert.match(articleHtml, /property="og:url" content="https:\/\/certifyd\.me\/blog\/newer-article\/"/);
  assert.match(articleHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(articleHtml, /"@type":"BlogPosting"/);
  assert.match(articleHtml, /"@type":"Organization"/);
  assert.match(articleHtml, /"@type":"BreadcrumbList"/);
  const jsonLd = [...articleHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  assert.equal(jsonLd.find((item) => item['@type'] === 'BlogPosting').mainEntityOfPage['@id'], 'https://certifyd.me/blog/newer-article/');
  assert.equal(jsonLd.find((item) => item['@type'] === 'BreadcrumbList').itemListElement[1].item, 'https://certifyd.me/blog/');

  const home = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(home, /Ideas for the Creator-Owned Economy/);
  assert.match(home, /View all articles/);
  assert.doesNotMatch(home, /Draft Article/);

  const sitemap = await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /https:\/\/certifyd\.me\/blog\//);
  assert.match(sitemap, /https:\/\/certifyd\.me\/blog\/newer-article\//);
  assert.doesNotMatch(sitemap, /draft-article|noindex-article/);
  for (const loc of [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).filter((loc) => loc.includes('/blog/'))) {
    assert.match(loc, /\/$/);
  }

  const robots = await fs.readFile(path.join(root, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/certifyd\.me\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/app\//);
  assert.doesNotMatch(robots, /Disallow: \/images/);

  const feed = await fs.readFile(path.join(root, 'feed.xml'), 'utf8');
  assert.match(feed, /<rss version="2.0">/);
  assert.match(feed, /Newer Article/);

  const seo = spawnSync(process.execPath, [SEO_VALIDATE_SCRIPT], { cwd: root, encoding: 'utf8' });
  assert.equal(seo.status, 0, seo.stderr);
  assert.match(seo.stdout, /SEO validation passed/);
});

test('build writes safe Google and IndexNow verification files from environment', async () => {
  const root = await makeFixture({
    'article.md': article({ title: 'Verification Article', slug: 'verification-article', date: '2026-07-26' }),
  });
  const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GOOGLE_SITE_VERIFICATION: 'google_meta_token',
      GOOGLE_SITE_VERIFICATION_FILE: 'googleabc123.html',
      GOOGLE_SITE_VERIFICATION_FILE_CONTENT: 'google-site-verification: googleabc123.html',
      INDEXNOW_KEY: 'indexnow_test_key',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const articleHtml = await fs.readFile(path.join(root, 'blog', 'verification-article', 'index.html'), 'utf8');
  assert.match(articleHtml, /name="google-site-verification" content="google_meta_token"/);
  assert.match(await fs.readFile(path.join(root, 'googleabc123.html'), 'utf8'), /google-site-verification/);
  assert.equal((await fs.readFile(path.join(root, 'indexnow_test_key.txt'), 'utf8')).trim(), 'indexnow_test_key');
});

test('published article missing required fields fails with useful error', async () => {
  const root = await makeFixture({
    'bad.md': `---\ntitle: "Bad"\nslug: "bad"\ndate: "2026-07-26"\nauthor: "Certifyd"\nstatus: "published"\n---\n\nBody.`,
  });
  const result = runBuild(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing excerpt/);
});

test('duplicate slugs fail validation', async () => {
  const root = await makeFixture({
    'a.md': article({ title: 'A', slug: 'same-slug', date: '2026-07-26' }),
    'b.md': article({ title: 'B', slug: 'same-slug', date: '2026-07-25' }),
  });
  const result = runBuild(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate blog slug/);
});

test('unsafe cover image paths fail validation', async () => {
  const root = await makeFixture({
    'bad-image.md': article({ title: 'Bad Image', slug: 'bad-image', date: '2026-07-26', coverImage: '/images/../secret.png' }),
  });
  const result = runBuild(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe path/);
});
