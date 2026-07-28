#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const BASE_URL = 'https://certifyd.me';
const CONTENT_DIR = path.join(ROOT, 'content', 'blog');
const BLOG_DIR = path.join(ROOT, 'blog');
const errors = [];

function fail(message) {
  errors.push(message);
}

function slugFromFile(file) {
  return path.basename(file, '.md');
}

function cleanSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

function isPublished(data) {
  return String(data.status || (data.draft === true ? 'draft' : 'published')).trim().toLowerCase() === 'published';
}

function isNoindex(data) {
  return data.noindex === true || String(data.noindex || data.robots || '').toLowerCase().includes('noindex');
}

function extract(html, regex) {
  return String(html || '').match(regex)?.[1] || '';
}

function extractAll(html, regex) {
  return [...String(html || '').matchAll(regex)].map((match) => match[1]);
}

async function readBlogSources() {
  const files = (await fs.readdir(CONTENT_DIR).catch(() => [])).filter((file) => file.endsWith('.md'));
  const published = new Map();
  const excluded = new Set();
  for (const file of files) {
    const parsed = matter(await fs.readFile(path.join(CONTENT_DIR, file), 'utf8'));
    const slug = cleanSlug(parsed.data.slug || slugFromFile(file));
    if (isPublished(parsed.data) && !isNoindex(parsed.data)) published.set(slug, parsed.data);
    else if (slug) excluded.add(slug);
  }
  return { published, excluded };
}

async function readSitemapLocs() {
  const sitemap = await fs.readFile(path.join(ROOT, 'sitemap.xml'), 'utf8').catch(() => '');
  if (!sitemap) fail('sitemap.xml is missing.');
  return extractAll(sitemap, /<loc>([^<]+)<\/loc>/g);
}

async function validateGeneratedArticles(published) {
  const canonicals = new Map();
  const titles = new Map();
  const descriptions = new Map();
  for (const slug of published.keys()) {
    const file = path.join(BLOG_DIR, slug, 'index.html');
    const html = await fs.readFile(file, 'utf8').catch(() => '');
    if (!html) {
      fail(`Generated article page is missing for ${slug}.`);
      continue;
    }
    const title = extract(html, /<title>([^<]+)<\/title>/i);
    const description = extract(html, /<meta name="description" content="([^"]+)"/i);
    const canonical = extract(html, /<link rel="canonical" href="([^"]+)"/i);
    const ogUrl = extract(html, /<meta property="og:url" content="([^"]+)"/i);
    const expectedCanonical = `${BASE_URL}/blog/${slug}/`;
    if (!title) fail(`${file}: missing title.`);
    if (!description) fail(`${file}: missing meta description.`);
    if (!canonical) fail(`${file}: missing canonical.`);
    if (canonical !== expectedCanonical) fail(`${file}: canonical mismatch: ${canonical}`);
    if (ogUrl !== canonical) fail(`${file}: og:url does not match canonical.`);
    if (!/^https:\/\/certifyd\.me\/blog\/[a-z0-9-]+\/$/.test(canonical)) fail(`${file}: canonical is not a valid absolute trailing-slash URL.`);
    if (titles.has(title)) fail(`${file}: duplicate title with ${titles.get(title)}.`);
    if (descriptions.has(description)) fail(`${file}: duplicate description with ${descriptions.get(description)}.`);
    titles.set(title, file);
    descriptions.set(description, file);
    if (canonicals.has(canonical)) fail(`${file}: duplicate canonical with ${canonicals.get(canonical)}.`);
    canonicals.set(canonical, file);
    validateJsonLd(file, html, expectedCanonical);
    validateInternalArticleLinks(file, html, published);
  }
}

function validateJsonLd(file, html, expectedCanonical) {
  const scripts = extractAll(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (!scripts.length) fail(`${file}: missing JSON-LD.`);
  const types = new Set();
  for (const script of scripts) {
    try {
      const data = JSON.parse(script);
      types.add(data['@type']);
      if ((data['@type'] === 'BlogPosting' || data['@type'] === 'Article') && data.url !== expectedCanonical) fail(`${file}: Article JSON-LD URL mismatch.`);
      if ((data['@type'] === 'BlogPosting' || data['@type'] === 'Article') && data.mainEntityOfPage?.['@id'] !== expectedCanonical) fail(`${file}: Article JSON-LD mainEntityOfPage mismatch.`);
    } catch (error) {
      fail(`${file}: malformed JSON-LD: ${error.message}`);
    }
  }
  for (const requiredType of ['BlogPosting', 'Organization', 'BreadcrumbList']) {
    if (!types.has(requiredType)) fail(`${file}: missing ${requiredType} JSON-LD.`);
  }
}

function validateInternalArticleLinks(file, html, published) {
  const links = extractAll(html, /href="(\/blog\/[^"#?]*)"/g);
  for (const href of links) {
    if (href === '/blog/') continue;
    if (!/^\/blog\/[a-z0-9-]+\/$/.test(href)) fail(`${file}: internal article link is not canonical trailing-slash format: ${href}`);
    const slug = href.replace(/^\/blog\//, '').replace(/\/$/, '');
    if (!published.has(slug)) fail(`${file}: broken internal article link: ${href}`);
  }
}

function validateSitemap(locs, published, excluded) {
  const seen = new Set();
  for (const loc of locs) {
    if (!/^https:\/\/certifyd\.me\/.+/.test(loc) && loc !== `${BASE_URL}/`) fail(`sitemap.xml has malformed absolute URL: ${loc}`);
    if (loc.includes('/app/') || loc.includes('/admin') || loc.includes('/login') || loc.includes('vassal.certifyd.me') || loc.includes('preview')) fail(`sitemap.xml includes private/preview URL: ${loc}`);
    if (seen.has(loc)) fail(`sitemap.xml has duplicate URL: ${loc}`);
    seen.add(loc);
    if (/\/blog\/[a-z0-9-]+$/.test(loc)) fail(`sitemap.xml URL missing trailing slash: ${loc}`);
  }
  for (const slug of published.keys()) {
    const loc = `${BASE_URL}/blog/${slug}/`;
    if (!seen.has(loc)) fail(`sitemap.xml missing published article: ${loc}`);
  }
  for (const slug of excluded) {
    const loc = `${BASE_URL}/blog/${slug}/`;
    if (seen.has(loc)) fail(`sitemap.xml includes unpublished/noindex article: ${loc}`);
  }
}

async function validateRobots() {
  const robots = await fs.readFile(path.join(ROOT, 'robots.txt'), 'utf8').catch(() => '');
  if (!robots.includes(`Sitemap: ${BASE_URL}/sitemap.xml`)) fail('robots.txt missing exact sitemap declaration.');
  if (/Disallow:\s*\/images/i.test(robots)) fail('robots.txt blocks image assets.');
}

async function main() {
  const { published, excluded } = await readBlogSources();
  const locs = await readSitemapLocs();
  await validateGeneratedArticles(published);
  validateSitemap(locs, published, excluded);
  await validateRobots();
  if (errors.length) {
    console.error(`SEO validation failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`SEO validation passed for ${published.size} published article${published.size === 1 ? '' : 's'}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
