import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Marked, Renderer } from 'marked';
import { validateRunId } from './security.js';

export const DESTINATION_STATES = {
  NOT_SELECTED: 'not_selected',
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
  UNCERTAIN: 'uncertain',
  SKIPPED: 'skipped',
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
  ['pdf', 'PDF source'],
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
    supportsImage: Boolean(adapter.supportsImage),
    manual: adapter.kind === 'manual',
    automatic: adapter.kind === 'canonical' || adapter.kind === 'full-article' || adapter.kind === 'social',
    availableInPhase2: ['certifyd', 'devto', 'wordpress'].includes(adapter.id) || adapter.kind === 'manual',
  };
}

class BaseDestination {
  constructor({ id, displayName, kind, supportsCanonical = false, supportsUpdate = false, supportsDelete = false, supportsImage = false }) {
    this.id = id;
    this.displayName = displayName;
    this.kind = kind;
    this.supportsCanonical = supportsCanonical;
    this.supportsUpdate = supportsUpdate;
    this.supportsDelete = supportsDelete;
    this.supportsImage = supportsImage;
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
    return { status: 'configured', label: 'Configured', message: `${this.displayName} credentials are configured; test the connection before publishing.` };
  }
  async testConnection() {
    const status = this.connectionStatus();
    return status;
  }
  async request(url, options = {}) {
    const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(20_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${this.displayName} API failed: HTTP ${response.status}. Response body withheld from logs and state.`);
    let result;
    try { result = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`${this.displayName} API returned invalid JSON. Response body withheld from logs and state.`); }
    if (result.errors?.length) throw new Error(`${this.displayName} API returned errors. Response details withheld from logs and state.`);
    return result;
  }
}

class DevToDestination extends EnvHttpDestination {
  constructor(env) { super({ id: 'devto', displayName: 'DEV Community', kind: 'full-article', supportsCanonical: true, supportsUpdate: true, supportsDelete: false, supportsImage: true }, env, ['CONTENT_DISTRIBUTION_DEVTO_API_KEY']); }
  async testConnection() {
    if (this.connectionStatus().status !== 'configured') return this.connectionStatus();
    const account = await this.request('https://dev.to/api/users/me', { headers: devHeaders(this.env.CONTENT_DISTRIBUTION_DEVTO_API_KEY) });
    if (!account.id || !account.username) throw new Error('DEV Community connection test returned no account identity.');
    if (this.env.CONTENT_DISTRIBUTION_DEVTO_USERNAME && account.username.toLowerCase() !== String(this.env.CONTENT_DISTRIBUTION_DEVTO_USERNAME).toLowerCase()) throw new Error('DEV Community credential belongs to a different account.');
    return { status: 'connected', label: 'Connected', message: `DEV account @${account.username} verified.`, accountId: String(account.id) };
  }
  async publishArticle(article) {
    const payload = { article: devArticle(article) };
    const json = await this.request('https://dev.to/api/articles', { method: 'POST', headers: devHeaders(this.env.CONTENT_DISTRIBUTION_DEVTO_API_KEY, true), body: JSON.stringify(payload) });
    if (!positiveId(json.id)) throw new Error('DEV Community returned no valid article ID; reconcile before retrying.');
    if (!isHttpsUrl(json.url)) throw new Error('DEV Community returned no valid public URL; reconcile before retrying.');
    return { externalPostId: String(json.id || ''), externalUrl: json.url || '', raw: json };
  }
  async updateArticle(article, state) {
    if (!positiveId(state.externalPostId)) throw new Error('DEV Community update requires a valid existing article ID. Reconcile the destination first.');
    const payload = { article: devArticle(article) };
    const json = await this.request(`https://dev.to/api/articles/${encodeURIComponent(state.externalPostId)}`, { method: 'PUT', headers: devHeaders(this.env.CONTENT_DISTRIBUTION_DEVTO_API_KEY, true), body: JSON.stringify(payload) });
    if (json.id && String(json.id) !== String(state.externalPostId)) throw new Error('DEV Community returned a different article ID; reconcile before retrying.');
    if (!isHttpsUrl(json.url || state.externalUrl)) throw new Error('DEV Community returned no valid public URL; reconcile before retrying.');
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
  constructor(env) { super({ id: 'wordpress', displayName: 'WordPress', kind: 'full-article', supportsCanonical: false, supportsUpdate: true, supportsDelete: false, supportsImage: true }, env, ['CONTENT_DISTRIBUTION_WORDPRESS_API_URL', 'CONTENT_DISTRIBUTION_WORDPRESS_USERNAME', 'CONTENT_DISTRIBUTION_WORDPRESS_APPLICATION_PASSWORD']); }
  baseUrl() {
    const base = String(this.env.CONTENT_DISTRIBUTION_WORDPRESS_API_URL || '').replace(/\/$/, '');
    if (!/^https:\/\//.test(base)) throw new Error('WordPress must use an HTTPS site URL.');
    return base;
  }
  headers() { return jsonHeaders({ Authorization: `Basic ${Buffer.from(`${this.env.CONTENT_DISTRIBUTION_WORDPRESS_USERNAME}:${this.env.CONTENT_DISTRIBUTION_WORDPRESS_APPLICATION_PASSWORD}`).toString('base64')}` }); }
  async testConnection() {
    if (this.connectionStatus().status !== 'configured') return this.connectionStatus();
    const user = await this.request(`${this.baseUrl()}/wp-json/wp/v2/users/me?context=edit`, { headers: this.headers() });
    if (!positiveId(user.id)) throw new Error('WordPress connection test returned no account identity.');
    if (user.capabilities?.edit_posts === false) throw new Error('WordPress account cannot edit posts.');
    return { status: 'connected', label: 'Connected', message: `WordPress account ${user.name || user.slug || user.id} verified.`, accountId: String(user.id) };
  }
  async publishArticle(article, state = {}, context = {}) { return this.sendPost(article, '', state, context); }
  async updateArticle(article, state, context = {}) {
    if (!positiveId(state.externalPostId)) throw new Error('WordPress update requires a valid existing post ID. Reconcile the destination first.');
    return this.sendPost(article, state.externalPostId, state, context);
  }
  async sendPost(article, postId = '', state = {}, context = {}) {
    const base = this.baseUrl();
    const body = { title: article.title, content: markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl)), excerpt: article.excerpt, status: 'publish' };
    const imageUrl = publicImageUrl(article);
    let mediaId = imageUrl && state.mediaSourceUrl === imageUrl && positiveId(state.mediaId) ? Number(state.mediaId) : 0;
    if (imageUrl && !mediaId) {
      const image = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
      const type = image.headers.get('content-type') || '';
      if (!image.ok || !/^image\/(jpeg|png|webp)(?:;|$)/i.test(type)) throw new Error('Certifyd cover image could not be fetched safely for WordPress media.');
      const bytes = Buffer.from(await image.arrayBuffer());
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Certifyd cover image is empty or exceeds the 8 MB media limit.');
      const filename = `certifyd-${new URL(article.canonicalUrl).pathname.split('/').filter(Boolean).at(-1)}.${type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'}`;
      const uploaded = await this.request(`${base}/wp-json/wp/v2/media`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': type.split(';')[0], 'Content-Disposition': `attachment; filename="${filename}"` }, body: bytes });
      if (!positiveId(uploaded.id)) throw new Error('WordPress returned no media ID; reconcile before retrying.');
      mediaId = Number(uploaded.id);
      if (context.checkpoint) await context.checkpoint({ mediaId, mediaSourceUrl: imageUrl });
    }
    if (mediaId) body.featured_media = mediaId;
    else if (postId && state.mediaId && !imageUrl) body.featured_media = 0;
    const metaKey = String(this.env.CONTENT_DISTRIBUTION_WORDPRESS_CANONICAL_META_KEY || '').trim();
    if (metaKey && /^[a-zA-Z0-9_]+$/.test(metaKey)) body.meta = { [metaKey]: article.canonicalUrl };
    const url = `${base}/wp-json/wp/v2/posts${postId ? `/${encodeURIComponent(postId)}` : ''}`;
    const json = await this.request(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!positiveId(json.id)) throw new Error('WordPress returned no valid post ID; reconcile before retrying.');
    if (postId && String(json.id) !== String(postId)) throw new Error('WordPress returned a different post ID; reconcile before retrying.');
    const externalUrl = json.link || '';
    if (!isHttpsUrl(externalUrl)) throw new Error('WordPress returned no valid public URL; reconcile before retrying.');
    let canonicalVerified = false;
    if (externalUrl) {
      try {
        if (new URL(externalUrl).protocol !== 'https:' || new URL(externalUrl).origin !== new URL(base).origin) throw new Error('Public WordPress post URL is outside the configured origin.');
        const response = await fetch(externalUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        if (response.ok) canonicalVerified = htmlCanonicalMatches(await response.text(), article.canonicalUrl);
      } catch { /* The post identity still succeeded; show canonical warning. */ }
    }
    return { externalPostId: String(json.id), externalUrl, mediaId, mediaSourceUrl: imageUrl, canonicalVerified, canonicalWarning: canonicalVerified ? '' : 'WordPress canonical tag is unverified; the visible Certifyd attribution link is present.' };
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
  let contents;
  try {
    contents = await fs.readFile(path.join(base, 'distribution', 'destinations.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    const state = JSON.parse(contents);
    if (!state || typeof state !== 'object' || Array.isArray(state) || (state.destinations && (typeof state.destinations !== 'object' || Array.isArray(state.destinations)))) throw new Error('Invalid distribution state.');
    return state;
  } catch {
    throw Object.assign(new Error('Distribution state cannot be read safely. Repair or restore it before publishing to avoid duplicate posts.'), { statusCode: 409 });
  }
}

export async function writeDistributionState(runRepo, runId, state) {
  const base = runRepo.runPath(validateRunId(runId));
  await fs.mkdir(path.join(base, 'distribution'), { recursive: true });
  const target = path.join(base, 'distribution', 'destinations.json');
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(state, null, 2));
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function withDistributionLock(runRepo, runId, callback) {
  const lock = path.join(runRepo.runPath(validateRunId(runId)), 'distribution', '.operation-lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = safeJson(await fs.readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => '{}'), {});
    const age = Date.now() - (await fs.stat(lock)).mtimeMs;
    if ((owner.pid && !processExists(owner.pid)) || (!owner.pid && age > 60_000)) {
      const recovery = `${lock}.recovery`;
      const abandoned = `${lock}.abandoned-${crypto.randomUUID()}`;
      let recoveryOwned = false;
      try {
        await fs.mkdir(recovery);
        recoveryOwned = true;
        await fs.rename(lock, abandoned);
        await fs.rm(abandoned, { recursive: true, force: true });
        await fs.mkdir(lock);
      } catch {
        throw Object.assign(new Error('Another distribution operation acquired the article lock. Retry after checking status.'), { statusCode: 409 });
      } finally {
        if (recoveryOwned) await fs.rm(recovery, { recursive: true, force: true });
      }
    } else {
      throw Object.assign(new Error('A distribution operation is already running for this article. Check its destination status before trying again.'), { statusCode: 409 });
    }
  }
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await callback();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

function processExists(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export async function readDistributionDefaults(config) {
  const file = path.join(config.agentRoot, 'dashboard', 'distribution-defaults.json');
  const source = await fs.readFile(file, 'utf8').catch(() => '');
  return source ? safeJson(source, {}) : { destinations: ['devto', 'wordpress', 'medium', 'substack', 'markdown', 'html', 'pdf', 'email'] };
}

export async function writeDistributionDefaults(config, defaults) {
  const file = path.join(config.agentRoot, 'dashboard', 'distribution-defaults.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(defaults, null, 2));
}

export async function readConnectionTests(config) {
  const file = path.join(config.agentRoot, 'dashboard', 'distribution-connections.json');
  return safeJson(await fs.readFile(file, 'utf8').catch(() => '{}'), {});
}

export async function writeConnectionTests(config, tests) {
  const file = path.join(config.agentRoot, 'dashboard', 'distribution-connections.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(tests, null, 2));
}

function jsonHeaders(extra = {}) { return { 'Content-Type': 'application/json', Accept: 'application/json', ...extra }; }
function devHeaders(key, json = false) { return { ...(json ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/vnd.forem.api-v1+json', 'api-key': key }; }
function devArticle(article) { return { title: article.title, body_markdown: withCanonicalFooter(article.markdown, article.canonicalUrl), published: true, tags: normalizeDevTags(article.tags).join(','), canonical_url: article.canonicalUrl, description: article.excerpt, ...(publicImageUrl(article) ? { main_image: publicImageUrl(article) } : {}) }; }
function publicImageUrl(article) {
  const value = String(article.featuredImage || '');
  if (/^https:\/\/certifyd\.me\/images\/[a-zA-Z0-9/_.,%-]+$/.test(value)) return value;
  if (/^\/images\/[a-zA-Z0-9/_.,%-]+$/.test(value)) return `https://certifyd.me${value}`;
  return '';
}
function positiveId(value) { return /^[1-9][0-9]*$/.test(String(value || '')); }
function isHttpsUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }
function htmlCanonicalMatches(html, canonicalUrl) {
  const tags = String(html).match(/<link\b[^>]*>/gi) || [];
  const attribute = (tag, name) => {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match?.[1] || match?.[2] || match?.[3] || '';
  };
  const canonicalTags = tags.filter((tag) => attribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical'));
  return canonicalTags.length === 1 && attribute(canonicalTags[0], 'href') === canonicalUrl;
}
function safeJson(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }
function withCanonicalFooter(markdown, canonicalUrl) { return `${String(markdown || '').trim()}\n\n---\n\nOriginally published on [Certifyd](${canonicalUrl}).\n`; }
function normalizeDevTags(tags = []) { return tags.map((tag) => String(tag || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)).filter(Boolean).slice(0, 4); }
function slugify(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); }
export function markdownToHtml(markdown = '') {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = ({ href, title, text }) => safeHref(href) ? `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>` : text;
  renderer.image = ({ href, title, text }) => safeHref(href) ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>` : escapeHtml(text);
  return new Marked({ renderer }).parse(String(markdown));
}
function safeHref(value) { try { const url = new URL(value, 'https://certifyd.me'); return ['https:', 'http:', 'mailto:'].includes(url.protocol); } catch { return false; } }
function escapeHtml(value = '') { return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }
function manualExport(id, article) {
  if (id === 'html') return markdownToHtml(withCanonicalFooter(article.markdown, article.canonicalUrl));
  if (id === 'email') return `Subject: ${article.title}\n\n${article.excerpt}\n\n${withCanonicalFooter(article.markdown, article.canonicalUrl)}`;
  if (id === 'pdf') return `PDF source: ${article.title}\n\n${withCanonicalFooter(article.markdown, article.canonicalUrl)}`;
  return withCanonicalFooter(article.markdown, article.canonicalUrl);
}
