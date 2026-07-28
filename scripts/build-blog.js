import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import matter from 'gray-matter';
import { marked } from 'marked';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'content', 'blog');
const TEMPLATE_DIR = path.join(ROOT, 'templates');
const OUT_DIR = path.join(ROOT, 'blog');
const BASE_URL = 'https://certifyd.me';
const DEFAULT_IMAGE = '/images/certifyd-main-image-independent-scene-20260613.png';
const ORGANIZATION = {
  name: 'Certifyd',
  url: BASE_URL,
  logo: `${BASE_URL}/images/certifyd-tab-icon.svg`,
  description: 'Certifyd provides creator-owned publishing, identity, attribution and direct commerce infrastructure.',
};
const IMPORTANT_PUBLIC_PAGES = [
  { path: '/', file: 'index.html', priority: '1.0' },
  { path: '/network.html', file: 'network.html', priority: '0.7' },
  { path: '/services', file: 'services/index.html', priority: '0.8' },
  { path: '/blog/', file: 'blog/index.html', priority: '0.8' },
];
const HOME_FILE = path.join(ROOT, 'index.html');
const HOME_CSS_START = '/* BLOG_STYLES_START */';
const HOME_CSS_END = '/* BLOG_STYLES_END */';
const HOME_SECTION_START = '<!-- BLOG_RECENT_START -->';
const HOME_SECTION_END = '<!-- BLOG_RECENT_END -->';

marked.setOptions({ async: false, breaks: false, gfm: true });

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function envValue(name) {
  return String(process.env[name] || '').trim();
}

function canonicalUrlForPath(pathname) {
  const normalized = String(pathname || '/').startsWith('/') ? pathname : `/${pathname}`;
  if (normalized === '/') return `${BASE_URL}/`;
  return `${BASE_URL}${normalized}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseDate(value, field, file) {
  if (!value) throw new Error(`${file}: missing ${field}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${file}: invalid ${field}`);
  return date;
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function cleanSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!slug) return '';
  return slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

function validateSlug(rawSlug, fallback, file) {
  const slug = cleanSlug(rawSlug || fallback);
  if (!slug) throw new Error(`${file}: missing slug`);
  if (slug !== String(rawSlug || fallback).trim().toLowerCase()) throw new Error(`${file}: slug must use lowercase letters, numbers and hyphens only`);
  return slug;
}

function validateImagePath(value, file) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_IMAGE;
  if (!raw.startsWith('/images/')) throw new Error(`${file}: coverImage must be a root-relative /images/ path`);
  if (raw.includes('..') || raw.includes('\\') || /%2f|%5c/i.test(raw) || raw.split('/').some((part) => part === '..')) {
    throw new Error(`${file}: coverImage contains an unsafe path`);
  }
  return raw;
}

function isNoindex(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true' || String(value || '').trim().toLowerCase() === 'noindex';
}

function absoluteUrl(value) {
  const raw = String(value || DEFAULT_IMAGE).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function verificationMeta() {
  const value = envValue('GOOGLE_SITE_VERIFICATION') || envValue('CONTENT_DASHBOARD_GOOGLE_SITE_VERIFICATION');
  if (!value) return '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new Error('GOOGLE_SITE_VERIFICATION must contain only letters, numbers, underscores and hyphens.');
  return `<meta name="google-site-verification" content="${escapeHtml(value)}" />`;
}

function indexNowKey() {
  const key = envValue('INDEXNOW_KEY') || envValue('CONTENT_DASHBOARD_INDEXNOW_KEY');
  if (!key) return '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new Error('INDEXNOW_KEY must contain only letters, numbers, underscores and hyphens.');
  return key;
}

function googleVerificationFile() {
  const name = envValue('GOOGLE_SITE_VERIFICATION_FILE') || envValue('GOOGLE_SITE_VERIFICATION_FILE_NAME');
  const content = envValue('GOOGLE_SITE_VERIFICATION_FILE_CONTENT') || envValue('GOOGLE_SITE_VERIFICATION_CONTENT');
  if (!name && !content) return null;
  if (!/^google[A-Za-z0-9_-]+\.html$/.test(name)) throw new Error('GOOGLE_SITE_VERIFICATION_FILE must look like google-site-verification HTML filename.');
  if (!content) throw new Error('GOOGLE_SITE_VERIFICATION_FILE_CONTENT is required when GOOGLE_SITE_VERIFICATION_FILE is set.');
  return { name, content };
}

function validateOptionalUrl(value, file) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new Error(`${file}: coverImageCreditUrl must be an absolute http(s) URL`);
  }
}

function renderTemplate(template, replacements) {
  return template
    .replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_, key) => replacements[key] ?? '')
    .replace(/^[ \t]+$/gm, '');
}

async function ensureEmptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function readMatter(raw, file) {
  try {
    return matter(raw);
  } catch (error) {
    throw new Error(`${file}: malformed front matter: ${error.message}`);
  }
}

async function readArticles() {
  const files = (await fs.readdir(CONTENT_DIR).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })).filter((file) => file.endsWith('.md')).sort();
  const articles = [];

  for (const file of files) {
    const fullPath = path.join(CONTENT_DIR, file);
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = readMatter(raw, file);
    const data = parsed.data || {};
    const status = String(data.status || (data.draft === true ? 'draft' : 'published')).trim().toLowerCase();
    if (status !== 'published') continue;
    if (isNoindex(data.noindex || data.robots)) continue;

    const title = String(data.title || '').trim();
    if (!title) throw new Error(`${file}: missing title`);
    const slug = validateSlug(data.slug, path.basename(file, '.md'), file);
    const date = parseDate(data.date || data.publishedAt, 'date', file);
    const updated = parseDate(data.updated || data.updatedAt || data.date || data.publishedAt, 'updated', file);
    const excerpt = String(data.excerpt || data.description || '').trim();
    if (!excerpt) throw new Error(`${file}: missing excerpt`);
    const coverImage = validateImagePath(data.coverImage || data.image, file);
    const coverImageAlt = String(data.coverImageAlt || '').trim();
    const coverImageCredit = String(data.coverImageCredit || '').trim();
    const coverImageCreditUrl = validateOptionalUrl(data.coverImageCreditUrl || '', file);
    const coverImageProvider = String(data.coverImageProvider || '').trim();
    const author = String(data.author || 'Certifyd').trim() || 'Certifyd';
    const tags = asArray(data.tags || data.keywords);
    const body = marked.parse(parsed.content || '');

    articles.push({
      file,
      title,
      slug,
      date,
      updated,
      author,
      excerpt,
      coverImage,
      coverImageAlt,
      coverImageCredit,
      coverImageCreditUrl,
      coverImageProvider,
      tags,
      status,
      noindex: false,
      seoTitle: String(data.seoTitle || '').trim(),
      seoDescription: String(data.seoDescription || '').trim(),
      body,
    });
  }

  const slugs = new Set();
  for (const article of articles) {
    if (slugs.has(article.slug)) throw new Error(`Duplicate blog slug: ${article.slug}`);
    slugs.add(article.slug);
  }

  return articles.sort((a, b) => b.date.getTime() - a.date.getTime() || a.title.localeCompare(b.title));
}

function articleUrl(article) {
  return `${BASE_URL}/blog/${article.slug}/`;
}

function localArticlePath(article) {
  return `/blog/${article.slug}/`;
}

function tagList(article) {
  return article.tags.length
    ? `<div class="tag-list" aria-label="Tags">${article.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
}

function renderArticleCard(article) {
  return `
    <article class="blog-card">
      <a class="blog-card-media" href="${localArticlePath(article)}" aria-label="Read ${escapeHtml(article.title)}">
        <img src="${escapeHtml(article.coverImage)}" alt="${escapeHtml(article.coverImageAlt)}" loading="lazy" decoding="async" onerror="this.src='${DEFAULT_IMAGE}'" />
      </a>
      <div class="blog-card-body">
        <div class="blog-card-meta">${escapeHtml(article.author)} · ${escapeHtml(formatDisplayDate(article.date))}</div>
        <h2><a href="${localArticlePath(article)}">${escapeHtml(article.title)}</a></h2>
        <p>${escapeHtml(article.excerpt)}</p>
        ${tagList(article)}
        <a class="blog-btn" href="${localArticlePath(article)}">Read article →</a>
      </div>
    </article>
  `.trim();
}

function renderCategoryTags(articles) {
  const tags = [...new Set(articles.flatMap((article) => article.tags))].sort();
  if (!tags.length) return '<span class="category-tag">Certifyd</span>';
  return tags.map((tag) => `<span class="category-tag">${escapeHtml(tag)}</span>`).join('\n');
}

function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: ORGANIZATION.name,
    url: ORGANIZATION.url,
    logo: {
      '@type': 'ImageObject',
      url: ORGANIZATION.logo,
    },
    description: ORGANIZATION.description,
  };
}

function articleJsonLd(article) {
  const canonicalUrl = articleUrl(article);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${canonicalUrl}#article`,
    url: canonicalUrl,
    headline: article.title,
    description: article.seoDescription || article.excerpt,
    image: [absoluteUrl(article.coverImage)],
    author: { '@type': 'Organization', name: article.author, url: BASE_URL },
    publisher: {
      '@type': 'Organization',
      name: ORGANIZATION.name,
      logo: { '@type': 'ImageObject', url: ORGANIZATION.logo },
    },
    datePublished: article.date.toISOString(),
    dateModified: article.updated.toISOString(),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
  };
}

function breadcrumbJsonLd(article) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${BASE_URL}/blog/` },
      { '@type': 'ListItem', position: 3, name: article.title, item: articleUrl(article) },
    ],
  };
}

function jsonLdScriptsForArticle(article) {
  return [articleJsonLd(article), organizationJsonLd(), breadcrumbJsonLd(article)].map(jsonLdScript).join('\n  ');
}

function imageCreditHtml(article) {
  if (!article.coverImageCredit) return '';
  const credit = article.coverImageCreditUrl
    ? `<a href="${escapeHtml(article.coverImageCreditUrl)}" rel="noopener noreferrer">${escapeHtml(article.coverImageCredit)}</a>`
    : escapeHtml(article.coverImageCredit);
  const provider = article.coverImageProvider === 'pexels'
    ? ' · <a href="https://www.pexels.com" rel="noopener noreferrer">Photos provided by Pexels</a>'
    : '';
  return `<p class="article-image-credit">${credit}${provider}</p>`;
}

async function writeBlogIndex(articles, template) {
  const html = renderTemplate(template, {
    metaTitle: 'Certifyd Blog | Creator-Owned Commerce Infrastructure',
    metaDescription: 'Articles from Certifyd on creator ownership, publishing, discovery, attribution and direct commerce.',
    canonicalUrl: `${BASE_URL}/blog/`,
    googleVerificationMeta: verificationMeta(),
    socialImage: absoluteUrl(DEFAULT_IMAGE),
    categories: renderCategoryTags(articles),
    articles: articles.length ? articles.map(renderArticleCard).join('\n') : '<p class="empty-state">No published articles yet.</p>',
  });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), html);
}

async function writeArticle(article, template) {
  const outDir = path.join(OUT_DIR, article.slug);
  await fs.mkdir(outDir, { recursive: true });
  const metaTitle = article.seoTitle || `${article.title} | Certifyd Blog`;
  const metaDescription = article.seoDescription || article.excerpt;
  const html = renderTemplate(template, {
    metaTitle: escapeHtml(metaTitle),
    ogTitle: escapeHtml(article.title),
    metaDescription: escapeHtml(metaDescription),
    canonicalUrl: articleUrl(article),
    robotsMeta: '',
    googleVerificationMeta: verificationMeta(),
    ogImage: absoluteUrl(article.coverImage),
    publishedIso: article.date.toISOString(),
    updatedIso: article.updated.toISOString(),
    author: escapeHtml(article.author),
    articleTagMeta: article.tags.map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}" />`).join('\n  '),
    keywordMeta: article.tags.length ? `<meta name="keywords" content="${escapeHtml(article.tags.join(', '))}" />` : '',
    jsonLdScripts: jsonLdScriptsForArticle(article),
    title: escapeHtml(article.title),
    excerpt: escapeHtml(article.excerpt),
    publishedAt: escapeHtml(formatDisplayDate(article.date)),
    updatedAt: escapeHtml(formatDisplayDate(article.updated)),
    heroImage: `<div class="article-hero-image"><img src="${escapeHtml(article.coverImage)}" alt="${escapeHtml(article.coverImageAlt)}" loading="eager" decoding="async" onerror="this.src='${DEFAULT_IMAGE}'" />${imageCreditHtml(article)}</div>`,
    tags: tagList(article),
    body: article.body,
  });
  await fs.writeFile(path.join(outDir, 'index.html'), html);
}

function renderHomepageArticleCard(article) {
  return `
        <article class="home-blog-card">
          <a class="home-blog-media" href="${localArticlePath(article)}" aria-label="Read ${escapeHtml(article.title)}">
            <img src="${escapeHtml(article.coverImage)}" alt="${escapeHtml(article.coverImageAlt)}" loading="lazy" decoding="async" onerror="this.src='${DEFAULT_IMAGE}'" />
          </a>
          <div class="home-blog-body">
            <p class="home-blog-meta">${escapeHtml(formatDisplayDate(article.date))} · ${escapeHtml(article.author)}</p>
            <h3><a href="${localArticlePath(article)}">${escapeHtml(article.title)}</a></h3>
            <p>${escapeHtml(article.excerpt)}</p>
          </div>
        </article>`;
}

function homepageStyles() {
  return `${HOME_CSS_START}
    .blog-home-section{margin-top:clamp(30px,5vw,64px)}
    .blog-home-panel{border:1px solid var(--border);border-radius:32px;background:linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025)),rgba(5,24,38,.34);box-shadow:var(--shadow);padding:clamp(22px,4vw,42px)}
    .blog-home-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}
    .blog-home-head h2{margin:0;font-size:clamp(34px,5vw,74px);line-height:.9;letter-spacing:-.065em;color:var(--certifyd-text)}
    .blog-home-head p{max-width:620px;margin:12px 0 0;color:var(--text-secondary);font-size:clamp(16px,1.5vw,20px)}
    .blog-home-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
    .home-blog-card{overflow:hidden;border:1px solid var(--glass-border);border-radius:24px;background:rgba(2,12,22,.42);min-height:100%;display:flex;flex-direction:column}
    .home-blog-media{display:block;aspect-ratio:16/9;background:#071421;overflow:hidden}
    .home-blog-media img{width:100%;height:100%;object-fit:cover;transition:transform .25s ease}
    .home-blog-card:hover .home-blog-media img{transform:scale(1.035)}
    .home-blog-body{padding:18px;display:flex;flex-direction:column;gap:10px;flex:1}
    .home-blog-meta{margin:0;color:var(--certifyd-orange);font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
    .home-blog-body h3{margin:0;font-size:clamp(21px,2vw,28px);line-height:1;letter-spacing:-.04em;color:#fff}
    .home-blog-body p{margin:0;color:var(--text-secondary)}
    .blog-home-empty{margin:0;color:var(--text-secondary)}
    @media (max-width:860px){.blog-home-head{align-items:start;flex-direction:column}.blog-home-grid{grid-template-columns:1fr}.blog-home-panel{border-radius:24px}.home-blog-body{padding:16px}}
${HOME_CSS_END}`;
}

function homepageSection(articles) {
  const latest = articles.slice(0, 3);
  const body = latest.length ? `<div class="blog-home-grid">${latest.map(renderHomepageArticleCard).join('\n')}</div>` : '<p class="blog-home-empty">No published articles yet.</p>';
  return `${HOME_SECTION_START}
    <section class="wrap blog-home-section" aria-labelledby="blog-home-heading">
      <div class="blog-home-panel">
        <div class="blog-home-head">
          <div>
            <p class="live-profile-eyebrow">Certifyd Blog</p>
            <h2 id="blog-home-heading">Latest articles.</h2>
            <p>Notes on creator-owned publishing, direct commerce and the Certifyd Network.</p>
          </div>
          <a class="btn primary" href="/blog/">View all articles</a>
        </div>
        ${body}
      </div>
    </section>
${HOME_SECTION_END}`;
}

function replaceBetween(source, start, end, replacement) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null;
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

async function updateHomepage(articles) {
  let html = await fs.readFile(HOME_FILE, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (!html) return;

  const styles = homepageStyles();
  const section = homepageSection(articles);
  const replacedStyles = replaceBetween(html, HOME_CSS_START, HOME_CSS_END, styles);
  if (replacedStyles) html = replacedStyles;
  else html = html.replace('  </style>', `\n${styles}\n  </style>`);

  const replacedSection = replaceBetween(html, HOME_SECTION_START, HOME_SECTION_END, section);
  if (replacedSection) html = replacedSection;
  else html = html.replace('<!-- Lightboxes -->', `${section}\n\n    <!-- Lightboxes -->`);

  await fs.writeFile(HOME_FILE, html);
}

async function writeSitemap(articles) {
  const staticUrls = [];
  for (const page of IMPORTANT_PUBLIC_PAGES) {
    const fullPath = path.join(ROOT, page.file);
    const html = await fs.readFile(fullPath, 'utf8').catch(() => '');
    if (!html || pageHasNoindex(html)) continue;
    const stat = await fs.stat(fullPath).catch(() => null);
    staticUrls.push({
      loc: canonicalUrlForPath(page.path),
      lastmod: page.path === '/blog/'
        ? (articles[0]?.updated || stat?.mtime || new Date()).toISOString().slice(0, 10)
        : (stat?.mtime || new Date()).toISOString().slice(0, 10),
      priority: page.priority,
    });
  }
  const urls = [
    ...staticUrls,
    ...articles.map((article) => ({ loc: articleUrl(article), lastmod: article.updated.toISOString().slice(0, 10), priority: '0.6' })),
  ];
  const seen = new Set();
  const uniqueUrls = urls.filter((url) => {
    if (seen.has(url.loc)) return false;
    seen.add(url.loc);
    return true;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueUrls.map((url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
${url.lastmod ? `    <lastmod>${escapeXml(url.lastmod)}</lastmod>\n` : ''}    <priority>${escapeXml(url.priority)}</priority>
  </url>`).join('\n')}
</urlset>
`;
  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), xml);
}

async function writeRobots() {
  await fs.writeFile(path.join(ROOT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /app/
Disallow: /admin/
Disallow: /login
Disallow: /content-agent/
Disallow: /deploy/

Sitemap: ${BASE_URL}/sitemap.xml
`);
}

function pageHasNoindex(html) {
  return /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(String(html || ''));
}

async function writeFeed(articles) {
  const lastBuildDate = articles[0]?.updated || articles[0]?.date || new Date('2026-01-01T00:00:00Z');
  const items = articles.map((article) => `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(articleUrl(article))}</link>
      <guid>${escapeXml(articleUrl(article))}</guid>
      <description>${escapeXml(article.excerpt)}</description>
      <pubDate>${article.date.toUTCString()}</pubDate>
      ${article.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join('\n      ')}
    </item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Certifyd Blog</title>
    <link>${BASE_URL}/blog/</link>
    <description>Articles from Certifyd on creator-owned publishing, attribution, discovery and direct commerce.</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
  await fs.writeFile(path.join(ROOT, 'feed.xml'), xml);
}

async function writeGoogleVerificationFile() {
  const file = googleVerificationFile();
  if (!file) return '';
  await fs.writeFile(path.join(ROOT, file.name), file.content.endsWith('\n') ? file.content : `${file.content}\n`);
  return file.name;
}

async function writeIndexNowKeyFile() {
  const key = indexNowKey();
  if (!key) return '';
  const fileName = `${key}.txt`;
  await fs.writeFile(path.join(ROOT, fileName), `${key}\n`);
  return fileName;
}

export async function buildBlog() {
  const [indexTemplate, articleTemplate] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_DIR, 'blog-index.html'), 'utf8'),
    fs.readFile(path.join(TEMPLATE_DIR, 'blog-article.html'), 'utf8'),
  ]);
  const articles = await readArticles();
  await ensureEmptyDir(OUT_DIR);
  await writeBlogIndex(articles, indexTemplate);
  await Promise.all(articles.map((article) => writeArticle(article, articleTemplate)));
  await updateHomepage(articles);
  await writeSitemap(articles);
  await writeRobots();
  await writeFeed(articles);
  await writeGoogleVerificationFile();
  await writeIndexNowKeyFile();
  console.log(`Built ${articles.length} published blog article${articles.length === 1 ? '' : 's'}.`);
  return articles;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildBlog().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
