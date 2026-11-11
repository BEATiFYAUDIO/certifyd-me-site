import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const BASE = 'https://certifyd.me';
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export async function readGuides(root) {
  const dir = path.join(root, 'content/guides');
  const guides = [];
  for (const file of (await fs.readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; })).filter(f => f.endsWith('.md')).sort()) {
    const parsed = matter(await fs.readFile(path.join(dir, file), 'utf8'));
    const data = parsed.data;
    if (data.status !== 'published' || data.noindex === true) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug || '')) throw new Error(`${file}: invalid guide slug`);
    for (const key of ['title', 'description', 'date', 'updated']) if (!data[key]) throw new Error(`${file}: missing ${key}`);
    for (const key of ['date', 'updated']) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data[key])) || Number.isNaN(Date.parse(data[key]))) throw new Error(`${file}: invalid ${key}`);
    if (guides.some(g => g.slug === data.slug)) throw new Error(`${file}: duplicate guide slug`);
    guides.push({ ...data, file, body: parsed.content });
  }
  return guides;
}

export async function writeGuides(root, guides, template) {
  for (const guide of guides) {
    const url = `${BASE}/guides/${guide.slug}/`;
    const image = `${BASE}/images/certifyd-main-image-independent-scene-20260613.png`;
    const org = { '@type': 'Organization', name: 'Certifyd', url: `${BASE}/`, logo: { '@type': 'ImageObject', url: `${BASE}/images/certifyd-tab-icon.svg` } };
    const schema = { '@context': 'https://schema.org', '@type': 'Article', '@id': `${url}#article`, url, headline: guide.title, description: guide.description, mainEntityOfPage: { '@type': 'WebPage', '@id': url }, datePublished: `${guide.date}T00:00:00.000Z`, dateModified: `${guide.updated}T00:00:00.000Z`, author: org, publisher: org, image: [image] };
    const breadcrumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` }, { '@type': 'ListItem', position: 2, name: 'Creator guides', item: `${BASE}/blog/#featured-heading` }, { '@type': 'ListItem', position: 3, name: guide.title, item: url }] };
    const values = {
      metaTitle: escape(`${guide.title} | Certifyd`), ogTitle: escape(guide.title), title: escape(guide.title), excerpt: escape(guide.description), metaDescription: escape(guide.description), canonicalUrl: url,
      ogImage: image, ogImageType: 'image/png', ogImageWidth: 1200, ogImageHeight: 630, ogImageAlt: 'Certifyd creator guides', author: 'Certifyd', publishedIso: `${guide.date}T00:00:00.000Z`, updatedIso: `${guide.updated}T00:00:00.000Z`, publishedAt: guide.date, updatedAt: guide.updated,
      jsonLdScripts: [schema, { '@context': 'https://schema.org', ...org }, breadcrumbs].map(s => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script>`).join('\n  '),
      body: marked.parse(guide.body),
      relatedStyles: 'article a{text-decoration:underline;text-underline-offset:3px}article table{display:block;overflow-x:auto;border-collapse:collapse;width:100%;margin:24px 0}article th,article td{padding:12px;border:1px solid var(--border);text-align:left;vertical-align:top}article th{color:#fff}article td{color:#d8ecf8}',
    };
    const html = template.replace('<p class="eyebrow">Certifyd Blog</p>', '<p class="eyebrow">Certifyd Creator Guides</p>').replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_, key) => values[key] ?? '');
    const out = path.join(root, 'guides', guide.slug);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'index.html'), html);
  }
}
