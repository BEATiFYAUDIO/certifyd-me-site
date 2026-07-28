import fs from 'node:fs/promises';
import path from 'node:path';
import { validateRunId } from './security.js';

export const DESTINATION_STATES = {
  NOT_SELECTED: 'not_selected',
  QUEUED: 'queued',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
  MANUAL_READY: 'manual_export_ready',
};

const fullArticleDestinations = [
  ['wordpress', 'WordPress'],
  ['ghost', 'Ghost'],
  ['devto', 'DEV Community'],
  ['hashnode', 'Hashnode'],
  ['blogger', 'Blogger'],
];
const socialDestinations = [
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
  ['facebook', 'Facebook Page'],
  ['reddit', 'Reddit'],
];
const manualDestinations = [
  ['medium', 'Medium export'],
  ['substack', 'Substack export'],
  ['markdown', 'Markdown export'],
  ['html', 'HTML export'],
  ['pdf', 'PDF export'],
  ['email', 'Email export'],
];

export function buildDistributionAdapters(config = {}) {
  const env = config.env || process.env;
  return [
    new CertifydDestination(),
    new DevToDestination(env),
    new BloggerDestination(env),
    new WordPressDestination(env),
    new GhostDestination(env),
    new HashnodeDestination(env),
    ...socialDestinations.map(([id, displayName]) => new ScaffoldDestination(id, displayName, 'social')),
    ...manualDestinations.map(([id, displayName]) => new ManualExportDestination(id, displayName)),
  ];
}

export function publicDestinationStatus(adapter) {
  const status = adapter.connectionStatus();
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    kind: adapter.kind,
    status: status.status,
    label: status.label,
    message: status.message,
    supportsCanonical: adapter.supportsCanonical,
    supportsUpdate: adapter.supportsUpdate,
    supportsDelete: adapter.supportsDelete,
    manual: adapter.kind === 'manual',
    automatic: adapter.kind === 'canonical' || adapter.kind === 'full-article' || adapter.kind === 'social',
  };
}

class BaseDestination {
  constructor({ id, displayName, kind, supportsCanonical = false, supportsUpdate = false, supportsDelete = false }) {
    this.id = id;
    this.displayName = displayName;
    this.kind = kind;
    this.supportsCanonical = supportsCanonical;
    this.supportsUpdate = supportsUpdate;
    this.supportsDelete = supportsDelete;
  }

  connectionStatus() { return { status: 'not_connected', label: 'Not connected', message: 'Credentials are not configured.' }; }
  async testConnection() { return this.connectionStatus(); }
  async publishArticle() { throw new Error(`${this.displayName} publishing is not configured.`); }
  async updateArticle() { throw new Error(`${this.displayName} updates are not configured.`); }
  async removeArticle() { throw new Error(`${this.displayName} deletion is not configured.`); }
}

class CertifydDestination extends BaseDestination {
  constructor() { super({ id: 'certifyd', displayName: 'Certifyd Blog', kind: 'canonical', supportsCanonical: true, supportsUpdate: true, supportsDelete: true }); }
  connectionStatus() { return { status: 'connected', label: 'Connected', message: 'Canonical Certifyd Blog publishing uses the existing GitHub publisher.' }; }
  async testConnection() { return this.connectionStatus(); }
}

class EnvHttpDestination extends BaseDestination {
  constructor(options, env, requiredKeys = []) {
    super(options);
    this.env = env;
    this.requiredKeys = requiredKeys;
  }
  connectionStatus() {
    const missing = this.requiredKeys.filter((key) => !this.env[key]);
    if (missing.length) return { status: 'not_connected', label: 'Not connected', message: `${this.displayName} credentials are not configured.` };
    return { status: 'connected', label: 'Connected', message: `${this.displayName} credentials are configured server-side.` };
  }
  async testConnection() {
    const status = this.connectionStatus();
    if (status.status !== 'connected') return status;
    return { status: 'connected', label: 'Connected', message: `${this.displayName} credentials are present.` };
  }
  async request(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    if (!response.ok) throw new Error(`${this.displayName} API failed: HTTP ${response.status}. ${text.slice(0, 220)}`);
    return text ? JSON.parse(text) : {};
  }
}

class DevToDestination extends EnvHttpDestination {
  constructor(env) { super({ id: 'devto', displayName: 'DEV Community', kind: 'full-article', supportsCanonical: true, supportsUpdate: true, supportsDelete: false }, env, ['CONTENT_DISTRIBUTION_DEVTO_API_KEY']); }
  async testConnection() {
    if (this.connectionStatus().status !== 'connected') return this.connectionStatus();
    await this.request('https://dev.to/api/users/me', { headers: { 'api-key': this.env.CONTENT_DISTRIBUTION_DEVTO_API_KEY } });
    return { status: 'connected', label: 'Connected', message: 'DEV Community API credentials passed.' };
  }
  async publishArticle(article) {
    const payload = { article: { title: article.title, body_markdown: withCanonicalFooter(article.markdown, article.canonicalUrl), published: true, tags: normalizeDevTags(article.tags), canonical_url: article.canonicalUrl, description: article.excerpt } };
    const json = await this.request('https://dev.to/api/articles', { method: 'POST', headers: jsonHeaders({ 'api-key': this.env.CONTENT_DISTRIBUTION_DEVTO_API_KEY }), body: JSON.stringify(payload) });
    return { externalPostId: String(json.id || ''), externalUrl: json.url || '', raw: json };
  }
  async updateArticle(article, state) {
    if (!state.externalPostId) return this.publishArticle(article);
    const payload = { article: { title: article.title, body_markdown: withCanonicalFooter(article.markdown, article.canonicalUrl), published: true, tags: normalizeDevTags(article.tags), canonical_url: article.canonicalUrl, description: article.excerpt } };
    const json = await this.request(`https://dev.to/api/articles/${encodeURIComponent(state.externalPostId)}`, { method: 'PUT', headers: jsonHeaders({ 'api-key': this.env.CONTENT_DISTRIBUTION_DEVTO_API_KEY }), body: JSON.stringify(payload) });
    return { externalPostId: String(json.id || state.externalPostId), externalUrl: json.url || state.externalUrl || '', raw: json };
  }
}

class BloggerDestination extends EnvHttpDestination {
  constructor(env) { super({ id: 'blogger', displayName: 'Blogger', kind: 'full-article', supportsCanonical: true, supportsUpdate: true, supportsDelete: true }, env, ['CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID', 'CONTENT_DISTRIBUTION_BLOGGER_ACCESS_TOKEN']); }
  async publishArticle(article) {
    const url = `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(this.env.CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID)}/posts/`;
    const json = await this.request(url, { method: 'POST', headers: jsonHeaders({ Authorization: `Bearer ${this.env.CONTENT_DISTRIBUTION_BLOGGER_ACCESS_TOKEN}` }), body: JSON.stringify({ title: article.title, content: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), labels: article.tags }) });
    return { externalPostId: String(json.id || ''), externalUrl: json.url || '', raw: json };
  }
  async updateArticle(article, state) {
    if (!state.externalPostId) return this.publishArticle(article);
    const url = `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(this.env.CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID)}/posts/${encodeURIComponent(state.externalPostId)}`;
    const json = await this.request(url, { method: 'PUT', headers: jsonHeaders({ Authorization: `Bearer ${this.env.CONTENT_DISTRIBUTION_BLOGGER_ACCESS_TOKEN}` }), body: JSON.stringify({ title: article.title, content: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), labels: article.tags }) });
    return { externalPostId: String(json.id || state.externalPostId), externalUrl: json.url || state.externalUrl || '', raw: json };
  }
}

class WordPressDestination extends EnvHttpDestination {
  constructor(env) { super({ id: 'wordpress', displayName: 'WordPress', kind: 'full-article', supportsCanonical: true, supportsUpdate: true, supportsDelete: true }, env, ['CONTENT_DISTRIBUTION_WORDPRESS_API_URL', 'CONTENT_DISTRIBUTION_WORDPRESS_TOKEN']); }
  async publishArticle(article) {
    const json = await this.request(`${this.env.CONTENT_DISTRIBUTION_WORDPRESS_API_URL.replace(/\/$/, '')}/wp-json/wp/v2/posts`, { method: 'POST', headers: jsonHeaders({ Authorization: `Bearer ${this.env.CONTENT_DISTRIBUTION_WORDPRESS_TOKEN}` }), body: JSON.stringify({ title: article.title, content: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), excerpt: article.excerpt, status: 'publish', date: article.date, meta: { canonical_url: article.canonicalUrl } }) });
    return { externalPostId: String(json.id || ''), externalUrl: json.link || '', raw: json };
  }
  async updateArticle(article, state) {
    if (!state.externalPostId) return this.publishArticle(article);
    const json = await this.request(`${this.env.CONTENT_DISTRIBUTION_WORDPRESS_API_URL.replace(/\/$/, '')}/wp-json/wp/v2/posts/${encodeURIComponent(state.externalPostId)}`, { method: 'POST', headers: jsonHeaders({ Authorization: `Bearer ${this.env.CONTENT_DISTRIBUTION_WORDPRESS_TOKEN}` }), body: JSON.stringify({ title: article.title, content: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), excerpt: article.excerpt, status: 'publish', meta: { canonical_url: article.canonicalUrl } }) });
    return { externalPostId: String(json.id || state.externalPostId), externalUrl: json.link || state.externalUrl || '', raw: json };
  }
}

class GhostDestination extends EnvHttpDestination {
  constructor(env) { super({ id: 'ghost', displayName: 'Ghost', kind: 'full-article', supportsCanonical: true, supportsUpdate: true, supportsDelete: true }, env, ['CONTENT_DISTRIBUTION_GHOST_ADMIN_API_URL', 'CONTENT_DISTRIBUTION_GHOST_ADMIN_TOKEN']); }
  async publishArticle(article) {
    const json = await this.request(`${this.env.CONTENT_DISTRIBUTION_GHOST_ADMIN_API_URL.replace(/\/$/, '')}/ghost/api/admin/posts/?source=html`, { method: 'POST', headers: jsonHeaders({ Authorization: `Ghost ${this.env.CONTENT_DISTRIBUTION_GHOST_ADMIN_TOKEN}` }), body: JSON.stringify({ posts: [{ title: article.title, html: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), excerpt: article.excerpt, status: 'published', canonical_url: article.canonicalUrl, published_at: article.date }] }) });
    const post = json.posts?.[0] || {};
    return { externalPostId: String(post.id || ''), externalUrl: post.url || '', raw: json };
  }
  async updateArticle(article, state) {
    if (!state.externalPostId) return this.publishArticle(article);
    const json = await this.request(`${this.env.CONTENT_DISTRIBUTION_GHOST_ADMIN_API_URL.replace(/\/$/, '')}/ghost/api/admin/posts/${encodeURIComponent(state.externalPostId)}/?source=html`, { method: 'PUT', headers: jsonHeaders({ Authorization: `Ghost ${this.env.CONTENT_DISTRIBUTION_GHOST_ADMIN_TOKEN}` }), body: JSON.stringify({ posts: [{ title: article.title, html: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), excerpt: article.excerpt, status: 'published', canonical_url: article.canonicalUrl }] }) });
    const post = json.posts?.[0] || {};
    return { externalPostId: String(post.id || state.externalPostId), externalUrl: post.url || state.externalUrl || '', raw: json };
  }
}

class HashnodeDestination extends EnvHttpDestination {
  constructor(env) { super({ id: 'hashnode', displayName: 'Hashnode', kind: 'full-article', supportsCanonical: true, supportsUpdate: false, supportsDelete: false }, env, ['CONTENT_DISTRIBUTION_HASHNODE_TOKEN', 'CONTENT_DISTRIBUTION_HASHNODE_PUBLICATION_ID']); }
  async publishArticle(article) {
    const mutation = 'mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }';
    const variables = { input: { publicationId: this.env.CONTENT_DISTRIBUTION_HASHNODE_PUBLICATION_ID, title: article.title, contentMarkdown: withCanonicalFooter(article.markdown, article.canonicalUrl), tags: article.tags.map((name) => ({ name, slug: slugify(name) })), originalArticleURL: article.canonicalUrl } };
    const json = await this.request('https://gql.hashnode.com/', { method: 'POST', headers: jsonHeaders({ Authorization: this.env.CONTENT_DISTRIBUTION_HASHNODE_TOKEN }), body: JSON.stringify({ query: mutation, variables }) });
    const post = json.data?.publishPost?.post || {};
    return { externalPostId: String(post.id || ''), externalUrl: post.url || '', raw: json };
  }
}

class ScaffoldDestination extends BaseDestination {
  constructor(id, displayName, kind) { super({ id, displayName, kind, supportsCanonical: true, supportsUpdate: false, supportsDelete: false }); }
  connectionStatus() { return { status: 'not_connected', label: 'Not connected', message: `${this.displayName} API is scaffolded but not connected. Founder approval and OAuth/platform access are required before posting.` }; }
}

class ManualExportDestination extends BaseDestination {
  constructor(id, displayName) { super({ id, displayName, kind: 'manual', supportsCanonical: true, supportsUpdate: false, supportsDelete: false }); }
  connectionStatus() { return { status: 'manual_export', label: 'Manual export', message: `${this.displayName} generates copy/download content only.` }; }
  async publishArticle(article) {
    return { externalPostId: '', externalUrl: '', exportContent: manualExport(this.id, article) };
  }
}

export async function readDistributionState(runRepo, runId) {
  const base = runRepo.runPath(validateRunId(runId));
  return safeJson(await fs.readFile(path.join(base, 'distribution', 'destinations.json'), 'utf8').catch(() => '{}'), {});
}

export async function writeDistributionState(runRepo, runId, state) {
  const base = runRepo.runPath(validateRunId(runId));
  await fs.mkdir(path.join(base, 'distribution'), { recursive: true });
  await fs.writeFile(path.join(base, 'distribution', 'destinations.json'), JSON.stringify(state, null, 2));
}

export async function readDistributionDefaults(config) {
  const file = path.join(config.agentRoot, 'dashboard', 'distribution-defaults.json');
  return safeJson(await fs.readFile(file, 'utf8').catch(() => '{}'), {});
}

export async function writeDistributionDefaults(config, defaults) {
  const file = path.join(config.agentRoot, 'dashboard', 'distribution-defaults.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(defaults, null, 2));
}

function jsonHeaders(extra = {}) { return { 'Content-Type': 'application/json', Accept: 'application/json', ...extra }; }
function safeJson(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }
function withCanonicalFooter(markdown, canonicalUrl) { return `${String(markdown || '').trim()}\n\n---\n\nOriginally published on [Certifyd](${canonicalUrl}).\n`; }
function normalizeDevTags(tags = []) { return tags.map(slugify).filter(Boolean).slice(0, 4); }
function slugify(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); }
function markdownToHtml(markdown = '') { return String(markdown).split(/\n{2,}/).map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('\n'); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }
function manualExport(id, article) {
  if (id === 'html') return markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl));
  if (id === 'email') return `Subject: ${article.title}\n\n${article.excerpt}\n\nRead the canonical article: ${article.canonicalUrl}`;
  if (id === 'pdf') return `PDF export source for ${article.title}\n\n${withCanonicalFooter(article.markdown, article.canonicalUrl)}`;
  return withCanonicalFooter(article.markdown, article.canonicalUrl);
}
