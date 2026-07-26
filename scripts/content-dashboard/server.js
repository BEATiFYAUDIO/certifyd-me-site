import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDashboardConfig, permissionsForRole } from './config.js';
import { ContentRunRepository, ContentBrainRepository } from './repository.js';
import { ContentDashboardActions, AuditLogRepository } from './actions.js';
import { createCsrfToken, escapeHtml, parseCookies, safeReturnPath, validateRunId, verifyCsrf, verifySession, signSession } from './security.js';
import { card, humanizeLabel, layout, loginPage, renderMarkdown, statusPill } from './render.js';
import { verifyCloudflareAccessRequest } from './cloudflare-access.js';
import { DashboardUserRepository } from './users.js';

const STATIC_TYPES = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.xml','application/xml; charset=utf-8'],['.txt','text/plain; charset=utf-8'],['.mp4','video/mp4']]);

const TRENDING_CATEGORIES = ['Music', 'Technology', 'AI', 'Creator Economy', 'Media', 'Sports'];

const TRENDING_OPPORTUNITIES = [
  {
    id: 'spotify-creator-business',
    category: 'Music',
    title: 'Compare Certifyd to Spotify',
    whyTrending: 'Artists keep looking for better ways to earn beyond streaming payout models.',
    whyCertifyd: 'This lets Certifyd explain the difference between renting attention and building a creator business.',
    brainCoverage: 'Strong',
    topic: 'Compare Certifyd to Spotify',
  },
  {
    id: 'creator-ownership-explainer',
    category: 'Creator Economy',
    title: 'Explain creator ownership',
    whyTrending: 'Creators increasingly sell memberships, releases, services and direct access.',
    whyCertifyd: 'This is the cleanest way to explain why Certifyd reduces platform dependency.',
    brainCoverage: 'Strong',
    topic: 'Explain what creator ownership means in Certifyd',
  },
  {
    id: 'local-ai-publishing',
    category: 'AI',
    title: 'Write about local AI',
    whyTrending: 'Teams are adopting local models for private workflows and lower operating costs.',
    whyCertifyd: 'Certifyd can show how local AI supports internal editorial work without turning it into a public claim about automation.',
    brainCoverage: 'Partial',
    topic: 'Write about local AI and Certifyd editorial workflows',
  },
  {
    id: 'media-response',
    category: 'Media',
    title: 'Respond to this article',
    whyTrending: 'Industry articles often surface problems around attribution, payments and platform dependency.',
    whyCertifyd: 'This creates timely commentary when a source is supplied and approved for research.',
    brainCoverage: 'Needs source',
    topic: 'Respond to this article from a Certifyd perspective',
  },
  {
    id: 'sports-creator-commerce',
    category: 'Sports',
    title: 'Creator-owned sports media',
    whyTrending: 'Athletes, teams and independent sports publishers are becoming direct media businesses.',
    whyCertifyd: 'This can position Certifyd as infrastructure for identity, discovery and direct commerce without overstating live sports features.',
    brainCoverage: 'Partial',
    topic: 'Write about creator-owned sports media and direct fan commerce',
  },
  {
    id: 'open-web-publishing',
    category: 'Technology',
    title: 'Why publishing should be portable',
    whyTrending: 'More companies want content and commerce systems that are not locked inside one platform.',
    whyCertifyd: 'This connects Certifyd Core, public profiles and discovery surfaces into one business story.',
    brainCoverage: 'Strong',
    topic: 'Explain why creator publishing should be portable',
  },
];

const KNOWLEDGE_SUGGESTIONS = [
  {
    title: 'Clarify Certifyd Core responsibilities',
    category: 'Update existing Brain record',
    summary: 'Separate Core from Network in plain language: Core handles local creator/operator software, identity, publishing and commerce context; Network handles discovery, routing and distribution.',
    confidence: 'High',
    sources: ['approved-public-claims.md', 'founder-decisions.md'],
  },
  {
    title: 'Add article guidance for creator ownership',
    category: 'New Brain record',
    summary: 'Create a reusable writing note that prefers “reduces platform dependency” over absolute ownership claims unless stronger evidence is available.',
    confidence: 'High',
    sources: ['approved-public-claims.md'],
  },
  {
    title: 'Mark old monetization wording for review',
    category: 'Mark record as stale',
    summary: 'Older copy may overemphasize technical layers. Flag it for founder review before future investor or public articles reuse it.',
    confidence: 'Medium',
    sources: ['investor-site-audit.md', 'monetization-ecosystem.md'],
  },
  {
    title: 'Merge repeated profile language',
    category: 'Merge duplicate records',
    summary: 'Combine repeated profile descriptions into one source that distinguishes public profiles, creator identity and discovery surfaces.',
    confidence: 'Medium',
    sources: ['brand.md', 'vocabulary.md'],
  },
];

export function createContentDashboardServer(options = {}) {
  const config = options.config || getDashboardConfig(options.env || process.env);
  const runRepo = new ContentRunRepository(config);
  const brainRepo = new ContentBrainRepository(config);
  const actions = new ContentDashboardActions(config);
  const audit = new AuditLogRepository(config);
  const userRepo = new DashboardUserRepository(config);

  return http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID();
    try {
      setSecurityHeaders(res);
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/health' || url.pathname === '/api/health') return sendJson(res, { status: 'ok' });
      if (url.pathname === '/ready') return sendJson(res, { ok: config.enabled, authMode: config.authMode });
      if (url.pathname === '/version') return sendJson(res, { name: 'certifyd-content-dashboard', version: process.env.npm_package_version || 'dev' });
      if (url.pathname === '/app' || url.pathname === '/app/') return redirect(res, '/app/content');
      if (isAdminHost(req.headers.host) && url.pathname === '/') return redirect(res, '/app/content');
      if (url.pathname === '/app/login') return await handleLogin(req, res, url, { config, userRepo });
      if (url.pathname === '/app/logout') return handleLogout(req, res);
      if (url.pathname.startsWith('/app/content')) return await handleProtected(req, res, url, { config, runRepo, brainRepo, actions, audit, userRepo, requestId });
      return await serveStatic(req, res, url, config.siteRoot);
    } catch (error) {
      sendError(res, error);
    }
  });
}

function isAdminHost(host = '') {
  return String(host).split(':')[0].toLowerCase() === 'admin.certifyd.me';
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

async function handleLogin(req, res, url, { config, userRepo }) {
  const localLoginEnabled = config.authMode !== 'cloudflare-access' || config.allowTemporaryTunnelTesting;
  if (req.method === 'GET') return sendHtml(res, loginPage({ returnTo: safeReturnPath(url.searchParams.get('returnTo') || '/app/content'), localLoginEnabled }));
  if (req.method !== 'POST') return sendStatus(res, 405, 'Method not allowed');
  if (!localLoginEnabled) return sendHtml(res, loginPage({ returnTo: '/app/content', error: 'Local login is disabled in Cloudflare Access mode.', localLoginEnabled: false }), 403);
  const form = await readForm(req);
  const email = String(form.get('email') || '').trim().toLowerCase();
  const token = String(form.get('token') || '');
  const returnTo = safeReturnPath(String(form.get('returnTo') || '/app/content'));
  if (!config.enabled) return sendHtml(res, loginPage({ returnTo, error: 'Dashboard is not enabled.' }), 403);
  if (!config.sessionSecret || !config.localLoginToken) return sendHtml(res, loginPage({ returnTo, error: 'Dashboard auth environment is incomplete.' }), 503);
  if (token !== config.localLoginToken) return sendHtml(res, loginPage({ returnTo, error: 'Invalid local access token.' }), 401);
  const dbUser = userRepo.resolveAuthenticatedUser({ id: email, email });
  if (!dbUser) return sendHtml(res, loginPage({ returnTo, error: 'This account is not authorized for the content dashboard.' }), 403);
  const sid = crypto.randomUUID();
  const session = signSession({ id: dbUser.id, email: dbUser.email, role: dbUser.role, sid, exp: Date.now() + 8 * 60 * 60 * 1000 }, config.sessionSecret);
  res.writeHead(303, {
    Location: returnTo,
    'Set-Cookie': `certifyd_content_session=${encodeURIComponent(session)}; HttpOnly; SameSite=Lax; Path=/app; Max-Age=28800`,
  });
  res.end();
}

function handleLogout(req, res) {
  if (req.method !== 'POST') return sendStatus(res, 405, 'Method not allowed');
  res.writeHead(303, { Location: '/', 'Set-Cookie': 'certifyd_content_session=; HttpOnly; SameSite=Lax; Path=/app; Max-Age=0' });
  res.end();
}

async function handleProtected(req, res, url, ctx) {
  const user = await getUser(req, ctx);
  if (!user) {
    if (ctx.config.authMode === 'cloudflare-access' && !ctx.config.allowTemporaryTunnelTesting) return sendStatus(res, 401, 'Cloudflare Access required');
    res.writeHead(303, { Location: `/app/login?returnTo=${encodeURIComponent(safeReturnPath(url.pathname + url.search))}` });
    return res.end();
  }
  const permissions = permissionsForRole(user.role);
  if (!permissions.includes('content.dashboard.view')) return sendStatus(res, 403, 'Forbidden');
  if (req.method === 'POST') return handleAction(req, res, url, { ...ctx, user, permissions });
  await ctx.audit.append({ action: 'dashboard_access', actorUserId: user.id, actorDisplayName: user.email, actorRole: user.role, result: 'SUCCESS', requestId: ctx.requestId });
  return handlePage(req, res, url, { ...ctx, user, permissions });
}

async function getUser(req, ctx) {
  const { config, userRepo } = ctx;
  if (config.authMode === 'cloudflare-access' || config.authMode === 'hybrid') {
    const accessUser = await verifyCloudflareAccessRequest(req, config).catch(() => null);
    if (accessUser) {
      const dbUser = userRepo.resolveAuthenticatedUser(accessUser);
      if (dbUser) return { ...dbUser, sid: `cf:${dbUser.id}` };
    }
    if (config.authMode === 'cloudflare-access' && !config.allowTemporaryTunnelTesting) return null;
  }
  const token = parseCookies(req.headers.cookie || '').get('certifyd_content_session');
  const session = verifySession(token, config.sessionSecret);
  if (!session) return null;
  const dbUser = userRepo.resolveAuthenticatedUser({ id: session.id, email: session.email });
  if (!dbUser || dbUser.role !== session.role) return null;
  return { ...dbUser, sid: session.sid };
}

async function handleAction(req, res, url, ctx) {
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });
  const form = await readForm(req);
  if (!verifyCsrf(ctx.config.sessionSecret, ctx.user.sid, String(form.get('_csrf') || ''))) return sendStatus(res, 403, 'CSRF validation failed');
  const action = url.pathname;
  const needs = (permission) => {
    if (!ctx.permissions.includes(permission)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  };
  let result;
  if (action.endsWith('/generate')) { needs('content.article.create'); validateIntake(form); result = await ctx.actions.generateDraft({ actor: ctx.user, form, signal: abortController.signal }); }
  else if (action.endsWith('/review/start')) { needs('content.article.review'); result = await ctx.actions.startReview({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/review/revise')) { needs('content.article.review'); result = await ctx.actions.requestRevision({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/review/approve')) { needs('content.article.approve'); result = await ctx.actions.approve({ actor: ctx.user, runId: form.get('runId'), version: form.get('version'), confirm: form.get('confirm') }); }
  else if (action.endsWith('/review/reject')) { needs('content.article.review'); result = await ctx.actions.reject({ actor: ctx.user, runId: form.get('runId'), note: form.get('note') }); }
  else if (action.endsWith('/publishing/prepare')) { needs('content.article.publish.prepare'); result = await ctx.actions.preparePublishing({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/publishing/validate')) { needs('content.article.publish.prepare'); result = await ctx.actions.validatePublishing({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/publishing/pr')) { needs('content.article.publish.prepare'); result = await ctx.actions.createPublishingPullRequest({ actor: ctx.user, runId: form.get('runId') }); }
  else return sendStatus(res, 404, 'Unknown action');
  sendHtml(res, layout({ title: 'Action Result', user: ctx.user, permissions: ctx.permissions, body: `<p class="eyebrow">Action result</p><h1>Completed</h1><pre>${escapeHtml(result.output || JSON.stringify(result, null, 2))}</pre><p><a class="primary" href="/app/content">Back to dashboard</a></p>` }));
}

async function handlePage(req, res, url, ctx) {
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
  const pathName = url.pathname;
  const allow = (permission) => {
    if (!ctx.permissions.includes(permission)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  };
  if (pathName === '/app/content' || pathName === '/app/content/') { allow('content.dashboard.view'); return sendHtml(res, await renderOverview(ctx, csrf, url)); }
  if (pathName === '/app/content/articles' || pathName === '/app/content/blog-engine') { allow('content.article.view'); return sendHtml(res, await renderArticles(ctx, url)); }
  if (pathName === '/app/content/model-health') { allow('content.article.create'); return sendJson(res, await ctx.actions.generationHealth({ provider: 'ollama' })); }
  if (pathName === '/app/content/brain') { allow('brain.read'); return sendHtml(res, await renderBrain(ctx)); }
  if (pathName === '/app/content/topics') { allow('content.article.view'); return redirect(res, '/app/content/articles?view=ideas'); }
  if (pathName === '/app/content/publishing') { allow('content.publishing.view'); return redirect(res, '/app/content/articles?view=approved'); }
  if (pathName === '/app/content/distribution') { allow('content.distribution.view'); return sendHtml(res, await renderDistribution(ctx)); }
  if (pathName === '/app/content/analytics') { allow('content.analytics.view'); return redirect(res, '/app/content/settings#advanced-diagnostics'); }
  if (pathName === '/app/content/settings') { allow('content.settings.manage'); return sendHtml(res, renderSettings(ctx)); }
  const previewMatch = pathName.match(/^\/app\/content\/articles\/([^/]+)\/preview$/);
  if (previewMatch) { allow('content.article.view'); return sendHtml(res, await renderPreview(ctx, previewMatch[1])); }
  const articleMatch = pathName.match(/^\/app\/content\/articles\/([^/]+)$/);
  if (articleMatch) { allow('content.article.view'); return sendHtml(res, await renderArticle(ctx, articleMatch[1], csrf)); }
  const reviewMatch = pathName.match(/^\/app\/content\/review\/([^/]+)$/);
  if (reviewMatch) { allow('content.article.review'); return sendHtml(res, await renderFounderReview(ctx, reviewMatch[1], csrf)); }
  return sendStatus(res, 404, 'Not found');
}

async function renderOverview(ctx, csrf, url) {
  const runs = await ctx.runRepo.listRuns();
  const selectedCategory = String(url.searchParams.get('category') || 'All');
  const opportunities = trendingOpportunities(selectedCategory);
  const drafts = runs.filter((run) => ['DRAFT', 'GENERATED', 'PENDING_FOUNDER_REVIEW'].includes(run.status)).slice(0, 6);
  const published = runs.filter((run) => run.status === 'PUBLISHED').slice(0, 5);
  const canCreate = ctx.permissions.includes('content.article.create');
  const canWriteBrain = ctx.permissions.includes('brain.write');
  const promptExamples = [
    'Compare Certifyd to Spotify',
    'Explain creator ownership',
    'Respond to this article',
    'Write about local AI',
    'Turn this document into a blog article',
  ];
  const body = `<section class="editorial-prompt panel">
    <p class="eyebrow">Editorial workspace</p>
    <h1>What should Certifyd write about?</h1>
    <p>Ask Qwen for a grounded article draft. The Blog Engine handles Brain context, approved research settings, draft creation and founder review.</p>
    ${canCreate ? `<form class="prompt-form" method="post" action="/app/content/actions/generate">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <input type="hidden" name="provider" value="ollama">
      <input type="hidden" name="contentType" value="article">
      <input type="hidden" name="audience" value="Creators, partners and investors">
      <input type="hidden" name="objective" value="Create a grounded Certifyd article using approved Brain context. Keep current capabilities distinct from planned capabilities.">
      <label class="sr-only" for="qwen-topic">Article prompt</label>
      <textarea id="qwen-topic" class="prompt-input" name="topic" required maxlength="300" placeholder="Tell Qwen what to write. Paste a topic, angle, document notes or article response request."></textarea>
      <div class="actions"><button class="primary">Ask Qwen</button><a class="ghost" href="/app/content/model-health">Check Qwen</a></div>
    </form>
    <div class="example-chips" aria-label="Prompt examples">${promptExamples.map((example) => quickGenerateForm({ csrf, label: example, topic: example })).join('')}</div>` : '<p class="notice">You can review articles, but this role cannot generate new drafts.</p>'}
  </section>

  <section class="workspace-section" aria-labelledby="trending-title">
    <div class="section-head">
      <div><p class="eyebrow">Trending Opportunities</p><h2 id="trending-title">What Qwen should watch.</h2></div>
      <div class="tabs compact"><a class="tab ${selectedCategory === 'All' ? 'active' : ''}" href="/app/content">All</a>${TRENDING_CATEGORIES.map((category) => `<a class="tab ${category === selectedCategory ? 'active' : ''}" href="/app/content?category=${encodeURIComponent(category)}">${escapeHtml(category)}</a>`).join('')}</div>
    </div>
    <div class="opportunity-grid">${opportunities.map((item) => opportunityCard(item, csrf, canCreate)).join('')}</div>
  </section>

  <section class="workspace-section panel" aria-labelledby="drafts-title">
    <div class="section-head"><div><p class="eyebrow">Drafts Awaiting Review</p><h2 id="drafts-title">What needs a founder decision.</h2></div><a class="ghost" href="/app/content/articles?view=review">Open review queue</a></div>
    ${drafts.length ? `<div class="review-list">${drafts.map((run) => draftRow(run, ctx.permissions)).join('')}</div>` : '<p class="empty">No generated drafts are waiting for review yet.</p>'}
  </section>

  <section class="workspace-section panel" aria-labelledby="knowledge-title">
    <div class="section-head"><div><p class="eyebrow">Knowledge Suggestions</p><h2 id="knowledge-title">What the Brain may need next.</h2></div><a class="ghost" href="/app/content/brain">Open Brain</a></div>
    <p>Qwen can suggest Brain changes, but it cannot update approved knowledge automatically.</p>
    <div class="review-list">${KNOWLEDGE_SUGGESTIONS.map((suggestion) => knowledgeSuggestionRow(suggestion, canWriteBrain)).join('')}</div>
  </section>

  <section class="workspace-section grid">
    ${card('Recently Published', published.length ? `<div class="review-list">${published.map((run) => publishedRow(run)).join('')}</div>` : '<p>No published articles yet.</p>')}
    ${card('Article Management', `<p>Markdown remains the canonical source. Use these queues to create, edit, preview, publish, unpublish, archive, delete drafts and view live articles.</p><div class="management-grid">
      <a class="ghost" href="/app/content/articles#create-with-qwen">Create</a>
      <a class="ghost" href="/app/content/articles?view=drafts">Edit drafts</a>
      <a class="ghost" href="/app/content/articles?view=drafts">Preview</a>
      <a class="ghost" href="/app/content/articles?view=approved">Publish</a>
      <a class="ghost" href="/app/content/articles?view=published">View live</a>
      <a class="ghost" href="/app/content/articles?view=archived">Archive</a>
    </div>`)}
  </section>`;
  return layout({ title: 'Dashboard', user: ctx.user, permissions: ctx.permissions, active: 'Dashboard', body });
}

function trendingOpportunities(category) {
  if (!category || category === 'All') return TRENDING_OPPORTUNITIES;
  return TRENDING_OPPORTUNITIES.filter((item) => item.category === category);
}

function opportunityCard(item, csrf, canCreate) {
  return `<article class="opportunity-card">
    <div class="meta-row"><span class="pill warn">${escapeHtml(item.category)}</span>${brainCoveragePill(item.brainCoverage)}</div>
    <h3>${escapeHtml(item.title)}</h3>
    <dl>
      <dt>Why it is trending</dt><dd>${escapeHtml(item.whyTrending)}</dd>
      <dt>Why it matters to Certifyd</dt><dd>${escapeHtml(item.whyCertifyd)}</dd>
    </dl>
    ${canCreate ? quickGenerateForm({ csrf, label: 'Generate Article', topic: item.topic, className: 'primary' }) : '<p class="muted">Generation unavailable for this role.</p>'}
  </article>`;
}

function brainCoveragePill(value) {
  const normalized = String(value || '').toLowerCase();
  const tone = normalized.includes('strong') ? 'good' : normalized.includes('needs') ? 'bad' : 'warn';
  return `<span class="pill ${tone}">Brain: ${escapeHtml(value || 'Unknown')}</span>`;
}

function quickGenerateForm({ csrf, label, topic, className = 'example-chip' }) {
  return `<form method="post" action="/app/content/actions/generate">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
    <input type="hidden" name="provider" value="ollama">
    <input type="hidden" name="contentType" value="article">
    <input type="hidden" name="topic" value="${escapeHtml(topic)}">
    <input type="hidden" name="audience" value="Creators, partners and investors">
    <input type="hidden" name="objective" value="Create a grounded Certifyd article using approved Brain context. Keep current capabilities distinct from planned capabilities.">
    <button class="${escapeHtml(className)}" type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function draftRow(run, permissions) {
  const runId = escapeHtml(run.runId);
  const canReview = permissions.includes('content.article.review');
  return `<article class="review-item">
    <div><h3>${escapeHtml(run.title || 'Untitled draft')}</h3><p>${statusPill(run.status)} <span class="muted">${escapeHtml(formatDashboardDate(run.updatedAt || run.createdAt))}</span></p></div>
    <div class="mini-actions">
      <a class="ghost" href="/app/content/articles/${runId}">Open</a>
      <a class="ghost" href="/app/content/articles/${runId}#write">Edit</a>
      <a class="ghost" href="/app/content/articles/${runId}/preview">Preview</a>
      ${canReview ? `<a class="primary" href="/app/content/review/${runId}">Publish</a>` : ''}
    </div>
  </article>`;
}

function knowledgeSuggestionRow(suggestion, canWriteBrain) {
  return `<article class="review-item knowledge-item">
    <div>
      <div class="meta-row"><span class="pill warn">${escapeHtml(suggestion.category)}</span><span class="pill ${suggestion.confidence === 'High' ? 'good' : 'warn'}">${escapeHtml(suggestion.confidence)} confidence</span></div>
      <h3>${escapeHtml(suggestion.title)}</h3>
      <p>${escapeHtml(suggestion.summary)}</p>
      <p class="muted">Sources: ${suggestion.sources.map((source) => escapeHtml(source)).join(', ')}</p>
    </div>
    <div class="mini-actions">${canWriteBrain ? '<button class="ghost" type="button" disabled>Approve</button><button class="ghost" type="button" disabled>Edit</button><button class="ghost" type="button" disabled>Reject</button>' : '<span class="muted">Brain approval requires write permission.</span>'}</div>
  </article>`;
}

function publishedRow(run) {
  const live = run.canonicalUrl ? `<a class="primary" href="${escapeHtml(run.canonicalUrl)}">View Live</a>` : `<a class="ghost" href="/app/content/articles/${escapeHtml(run.runId)}">Open</a>`;
  return `<article class="review-item"><div><h3>${escapeHtml(run.title || 'Untitled article')}</h3><p>${escapeHtml(formatDashboardDate(run.publishedAt || run.updatedAt || run.createdAt))}</p></div><div class="mini-actions">${live}</div></article>`;
}

function formatDashboardDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

async function renderArticles(ctx, url) {
  const runs = await ctx.runRepo.listRuns();
  const view = String(url.searchParams.get('view') || 'drafts');
  const search = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const tabs = [
    ['ideas', 'Ideas'],
    ['drafts', 'Drafts'],
    ['review', 'In review'],
    ['approved', 'Approved'],
    ['published', 'Published'],
    ['archived', 'Archived'],
    ['attention', 'Needs attention'],
  ];
  const filteredRuns = runs.filter((run) => articleMatchesView(run, view)).filter((run) => {
    if (!search) return true;
    return [run.title, run.runId, run.slug, run.audience, run.topic, run.canonicalUrl, run.modelProvider, run.modelMode].some((value) => String(value || '').toLowerCase().includes(search));
  });
  const rows = filteredRuns.map((run) => `<tr>
    <td><a href="/app/content/articles/${escapeHtml(run.runId)}"><strong>${escapeHtml(run.title || 'Untitled draft')}</strong></a><br><span class="muted">${escapeHtml(run.runId)}</span></td>
    <td>${statusPill(run.status)}<br><span class="muted">${statusPill(run.publishability)}</span></td>
    <td>${escapeHtml(run.updatedAt || run.createdAt || run.version || 'Unknown')}</td>
    <td>${escapeHtml(run.author || 'Certifyd')}</td>
    <td>${run.canonicalUrl ? `<a href="${escapeHtml(run.canonicalUrl)}">${escapeHtml(run.canonicalUrl)}</a>` : '<span class="muted">Not set</span>'}</td>
    <td>${Number(run.unresolvedIssueCount || 0) > 0 ? statusPill('Needs attention') : statusPill('READY')}</td>
    <td><span class="muted">Canonical first. Distribution generated after approval.</span></td>
    <td><div class="actions"><a class="ghost" href="/app/content/articles/${escapeHtml(run.runId)}">Open</a><a class="ghost" href="/app/content/articles/${escapeHtml(run.runId)}/preview">Preview</a>${ctx.permissions.includes('content.article.review') ? `<a class="ghost" href="/app/content/review/${escapeHtml(run.runId)}">Review</a>` : ''}</div></td>
  </tr>`).join('');
  const ideaState = view === 'ideas' ? card('Topic ideas', '<p class="empty">No topic opportunities are available yet. Add a manual topic or connect a real trend source in Settings.</p>') : '';
  const create = ctx.permissions.includes('content.article.create') ? card('Create with Qwen', `<div id="create-with-qwen"></div><p>Write a grounded Certifyd article from approved Brain context. If Qwen is unavailable, generation stops and explains the problem instead of silently substituting another provider.</p><div class="notice"><strong>Generation stages:</strong> Checking trends → Finding approved Brain sources → Gathering approved research → Preparing context → Writing with Qwen → Checking claims → Saving draft.</div><form class="intake" method="post" action="/app/content/actions/generate"><input type="hidden" name="_csrf" value="CSRF_PLACEHOLDER"><input type="hidden" name="provider" value="ollama"><label>What should Certifyd write about?<input name="topic" required maxlength="160" value="What Certifyd Core Is"></label><label>Audience<input name="audience" required maxlength="160" value="Creators, partners and investors"></label><label>Purpose<textarea name="objective" required maxlength="360">Explain Certifyd Core without overstating current capabilities.</textarea></label><details><summary>Advanced</summary><label>Working title<input name="workingTitle" maxlength="160"></label><label>Article type<select name="contentType"><option value="article">Article</option><option value="brief">Brief</option><option value="explainer">Explainer</option></select></label><label>Style<input name="writingStyle" maxlength="240" value="Plain, factual, investor-safe Certifyd editorial"></label><label>Source restrictions<textarea name="sourceRestrictions" maxlength="800">Use Certifyd Brain and approved public claims only. Distinguish live features from planned capabilities.</textarea></label><label><input type="checkbox" name="externalResearchAllowed" value="true"> Approved external research allowed when configured</label><p class="muted">Local AI: ${escapeHtml(ctx.config.ollama.enabled ? 'enabled' : 'disabled')}. Model: ${escapeHtml(ctx.config.ollama.model)}. Deterministic generation is available only if explicitly selected by an operator in a future advanced control.</p><p><a href="/app/content/model-health">Check Qwen availability</a></p></details><div class="actions"><button class="primary">Generate with Qwen</button></div></form>`).replace('CSRF_PLACEHOLDER', createCsrfToken(ctx.config.sessionSecret, ctx.user.sid)) : '';
  const filters = `<section class="panel"><div class="tabs">${tabs.map(([key, label]) => `<a class="tab ${key === view ? 'active' : ''}" href="/app/content/articles?view=${escapeHtml(key)}">${escapeHtml(label)}</a>`).join('')}</div><form class="search-row" method="get" action="/app/content/articles"><input type="hidden" name="view" value="${escapeHtml(view)}"><label>Search<input name="q" value="${escapeHtml(search)}" placeholder="Title, slug, topic, source or author"></label><button class="ghost" type="submit">Search</button></form></section>`;
  return layout({ title: 'Blog Engine', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body: `<p class="eyebrow">Blog Engine</p><h1>Editorial workspace</h1>${filters}${ideaState}${create}<section class="panel"><table class="table"><thead><tr><th>Title</th><th>Status</th><th>Updated</th><th>Author</th><th>Canonical URL</th><th>Sources</th><th>Distribution</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="8"><p class="empty">No articles match this view.</p></td></tr>'}</tbody></table></section>` });
}

async function renderArticle(ctx, runId, csrf) {
  validateRunId(runId);
  const run = await ctx.runRepo.readRun(runId);
  const summary = run.summary || {};
  const claims = Array.isArray(run.claimLedger?.claims) ? run.claimLedger.claims : [];
  const evidenceCount = Array.isArray(run.research?.evidence) ? run.research.evidence.length : 0;
  const externalCount = Array.isArray(run.externalResearch?.items) ? run.externalResearch.items.length : 0;
  const distributionAssets = Array.isArray(run.distribution?.assets) ? run.distribution.assets : [];
  const versions = Array.isArray(run.versions) ? run.versions : [];
  const body = `<p class="eyebrow">Article Workspace</p><h1>${escapeHtml(summary.title || 'Untitled article')}</h1>${runSummaryHtml(summary)}${actionButtons(runId, summary.version || 'v1', csrf, ctx.permissions, ctx.config)}<div class="workspace-tabs"><a href="#write">Write</a><a href="#preview">Preview</a><a href="#sources">Sources</a><a href="#distribution">Distribution</a><a href="#history">History</a></div><section id="write" class="workspace-section">${card('Write', `<p class="muted">Editing persistence is intentionally staged. Review and approval use the exact generated version shown here.</p><textarea rows="16">${escapeHtml(run.articleMarkdown || run.draftMarkdown || '')}</textarea>`)}</section><section id="preview" class="workspace-section">${card('Preview', `<article class="article">${renderMarkdown(run.articleMarkdown || run.draftMarkdown || '')}</article>`)}</section><section id="sources" class="workspace-section"><div class="grid">${card('Source coverage', `<p>Claims: ${claims.length}</p><p>Unresolved blockers: ${escapeHtml(summary.unresolvedIssueCount ?? 0)}</p>`)}${card('Approved Brain context', `<pre>${escapeHtml(JSON.stringify({ brain: evidenceCount, external: externalCount }, null, 2))}</pre>`)}${card('Claims', claimTable(claims))}</div></section><section id="distribution" class="workspace-section">${card('Distribution', distributionList(distributionAssets))}</section><section id="history" class="workspace-section">${card('History', versions.map((item) => `<p>${escapeHtml(item.version)}</p>`).join('') || '<p>No versions found.</p>')}</section>`;
  return layout({ title: summary.title || 'Article', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderFounderReview(ctx, runId, csrf) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const summary = run.summary || {};
  const claims = Array.isArray(run.claimLedger?.claims) ? run.claimLedger.claims : [];
  const body = `<p class="eyebrow">Founder Review</p><h1>${escapeHtml(summary.title || 'Untitled article')}</h1><p class="notice">Approval requires founder permission, exact displayed version, zero blocking claims and explicit confirmation. This approves version ${escapeHtml(summary.version || 'v1')} for Certifyd Blog publishing preparation.</p>${runSummaryHtml(summary)}${card('Final Checklist', `<ul><li>Version: ${escapeHtml(summary.version || 'v1')}</li><li>Blocking claims: ${escapeHtml(summary.unresolvedIssueCount ?? 0)}</li><li>Canonical URL: ${escapeHtml(summary.canonicalUrl || 'Not set')}</li><li>Publishability: ${escapeHtml(humanizeLabel(summary.publishability || 'UNKNOWN'))}</li></ul>`)}${card('Blocked or Qualified Claims', claimTable(claims.filter((claim) => claim.status !== 'APPROVED')))}${card('Article Preview', `<article class="article">${renderMarkdown(run.articleMarkdown || run.draftMarkdown || '')}</article>`)}${actionButtons(runId, summary.version || 'v1', csrf, ctx.permissions, ctx.config)}`;
  return layout({ title: 'Founder Review', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderPreview(ctx, runId) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const pkg = run.blogPackage || {};
  const summary = run.summary || {};
  const body = `<p class="eyebrow">Internal preview — not published</p><h1>${escapeHtml(pkg.title || summary.title || 'Untitled article')}</h1><p>${escapeHtml(pkg.description || '')}</p><div class="panel"><p><strong>Author:</strong> ${escapeHtml(pkg.author || 'Certifyd')}</p><p><strong>Canonical:</strong> ${escapeHtml(summary.canonicalUrl || 'Not set')}</p><p><strong>Structured metadata:</strong> ${pkg.structuredData ? 'Available' : 'Missing'}</p></div><article class="panel article">${renderMarkdown(run.articleMarkdown || run.draftMarkdown || '')}</article>`;
  return layout({ title: 'Preview', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderBrain(ctx) {
  const files = await ctx.brainRepo.listFiles();
  const rows = files.map((file) => `<tr><td>${escapeHtml(file.name)}</td><td>${escapeHtml(humanizeLabel(file.classification))}</td><td>${escapeHtml(file.lastUpdated)}</td><td>${escapeHtml(file.evidenceUsageCount)}</td><td>${escapeHtml(humanizeLabel(file.staleStatus))}</td></tr>`).join('');
  return layout({ title: 'Brain', user: ctx.user, permissions: ctx.permissions, active: 'Brain', body: `<p class="eyebrow">Brain</p><h1>Approved knowledge</h1><p>Editorial reference for approved Certifyd facts, vocabulary and founder decisions. Raw Brain editing is intentionally not enabled in this pass.</p><section class="panel"><form class="search-row"><label>Filter Brain records<input placeholder="Search by file, status or topic" disabled></label><button class="ghost" disabled>Search</button></form></section><section class="panel"><table class="table"><thead><tr><th>File</th><th>Classification</th><th>Updated</th><th>Usage</th><th>Review state</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No Brain records found.</td></tr>'}</tbody></table></section>` });
}

async function renderTopics(ctx) {
  const runs = await ctx.runRepo.listRuns();
  const rows = [];
  for (const run of runs) {
    const detail = await ctx.runRepo.readRun(run.runId);
    const topic = detail.topicOpportunity || {};
    rows.push(`<tr><td>${escapeHtml(topic.topic || run.topic)}</td><td>${escapeHtml(topic.primarySearchQuestion || 'NOT_AVAILABLE')}</td><td>${escapeHtml(run.audience)}</td><td>${escapeHtml(topic.searchIntent || 'NOT_AVAILABLE')}</td><td>${escapeHtml(topic.priority || 'NOT_AVAILABLE')}</td><td>${escapeHtml((topic.blockers || []).join(', ') || 'None recorded')}</td></tr>`);
  }
  return layout({ title: 'Topics', user: ctx.user, permissions: ctx.permissions, active: 'Topics', body: `<p class="eyebrow">Topics</p><h1>Topic opportunities</h1><p>External research is fixture-only. Missing live metrics are shown as unavailable, not estimated.</p><section class="panel"><table class="table"><thead><tr><th>Topic</th><th>Search question</th><th>Audience</th><th>Intent</th><th>Priority</th><th>Blockers</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>` });
}

async function renderPublishing(ctx, csrf) {
  const runs = await ctx.runRepo.listRuns();
  const notice = ctx.config.githubPublishing.enabled
    ? 'GitHub App publishing is enabled. Approved packages can create draft pull requests only; merging remains a separate human review step.'
    : 'GitHub App publishing is disabled. No live site publication occurs. Highest status is READY_TO_PUBLISH.';
  return layout({ title: 'Publishing', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body: `<p class="eyebrow">Publishing</p><h1>Blog package preparation</h1><p class="notice">${escapeHtml(notice)}</p>${runs.map((run) => card(run.title, runSummaryHtml(run) + actionButtons(run.runId, run.version, csrf, ctx.permissions, ctx.config))).join('')}` });
}

async function renderDistribution(ctx) {
  const runs = await ctx.runRepo.listRuns();
  const blocks = [];
  for (const run of runs) {
    const detail = await ctx.runRepo.readRun(run.runId).catch(() => null);
    blocks.push(card(run.title || 'Untitled article', distributionList(detail?.distribution?.assets)));
  }
  const channels = ['X', 'Medium', 'Substack', 'LinkedIn', 'Newsletter'].map((name) => card(name, '<strong>Disconnected</strong><p>Generate, preview, copy and export are staged. No external account publishes from this dashboard yet.</p>')).join('');
  return layout({ title: 'Distribution', user: ctx.user, permissions: ctx.permissions, active: 'Distribution', body: `<p class="eyebrow">Distribution</p><h1>Channel versions</h1><p>Distribution versions are derived from approved canonical Certifyd articles. No social APIs are connected.</p><div class="grid">${channels}</div>${blocks.join('')}` });
}

function renderAnalytics(ctx) {
  const body = `<p class="eyebrow">Analytics</p><h1>Future analytics</h1><div class="grid">${['Search Console','Google Analytics','LinkedIn analytics','X analytics','Newsletter analytics'].map((name) => card(name, '<strong>Not connected</strong><p>Adapter contract exists; no live numbers are fabricated.</p>')).join('')}</div>`;
  return layout({ title: 'Analytics', user: ctx.user, permissions: ctx.permissions, active: 'Analytics', body });
}

function renderSettings(ctx) {
  const safe = { dashboardEnabled: ctx.config.enabled, authMode: ctx.config.authMode, publicAdminUrl: ctx.config.publicAdminUrl, database: ctx.config.databasePath === ':memory:' ? 'memory' : 'sqlite configured', userCount: ctx.userRepo.listUsers().length, localAi: { enabled: ctx.config.ollama.enabled, model: ctx.config.ollama.model, baseUrl: ctx.config.ollama.baseUrl ? 'configured' : 'not configured' }, trendResearch: ctx.config.trendResearchProvider || 'manual only', externalResearch: ctx.config.externalResearchProvider || 'not configured', brain: 'content-agent/knowledge', githubPublishing: ctx.config.githubPublishing.enabled ? 'draft pull requests' : 'disabled', githubRepositoryConfigured: Boolean(ctx.config.githubPublishing.owner && ctx.config.githubPublishing.repo), distributionAccounts: 'none connected', cloudflareAccessConfigured: Boolean(ctx.config.cloudflareAccess.teamDomain && ctx.config.cloudflareAccess.audience), environment: ctx.config.environmentName };
  return layout({ title: 'Settings', user: ctx.user, permissions: ctx.permissions, active: 'Settings', body: `<p class="eyebrow">Settings</p><h1>Configuration</h1><p>Secrets, tokens and raw session data are never displayed.</p><div class="grid">${['Local AI','Trend research','External research','Brain','GitHub publishing','Distribution accounts','Access','Advanced diagnostics'].map((name) => card(name, `<p>${escapeHtml(settingsSummary(name, safe))}</p>`)).join('')}</div><section id="advanced-diagnostics" class="panel"><h2>Advanced diagnostics</h2><pre>${escapeHtml(JSON.stringify(safe, null, 2))}</pre></section>` });
}

function articleMatchesView(run, view) {
  const status = String(run.status || '');
  const publishability = String(run.publishability || '');
  if (view === 'ideas') return false;
  if (view === 'drafts') return ['DRAFT', 'GENERATED'].includes(status) || (!status && !run.canonicalUrl);
  if (view === 'review') return status === 'PENDING_FOUNDER_REVIEW';
  if (view === 'approved') return ['FOUNDER_APPROVED', 'READY_TO_PUBLISH'].includes(status);
  if (view === 'published') return status === 'PUBLISHED';
  if (view === 'archived') return status === 'ARCHIVED';
  if (view === 'attention') return publishability.includes('BLOCKED') || Number(run.unresolvedIssueCount || 0) > 0;
  return true;
}

function settingsSummary(name, safe) {
  const summaries = {
    'Local AI': safe.localAi.enabled ? `Qwen configured (${safe.localAi.model}).` : 'Qwen is unavailable until Ollama is configured.',
    'Trend research': safe.trendResearch === 'fixture' ? 'Manual topics only. No live trend provider is connected.' : `${safe.trendResearch} configured.`,
    'External research': safe.externalResearch === 'fixture' ? 'No live external research provider is connected.' : `${safe.externalResearch} configured.`,
    Brain: 'Approved Certifyd knowledge powers grounded drafts.',
    'GitHub publishing': safe.githubPublishing === 'draft pull requests' ? 'Draft PR publishing is configured.' : 'Publishing is disabled.',
    'Distribution accounts': 'No social or newsletter accounts are connected.',
    Access: `${safe.authMode}; Cloudflare Access ${safe.cloudflareAccessConfigured ? 'configured' : 'not configured'}.`,
    'Advanced diagnostics': 'Safe, redacted configuration only.',
  };
  return summaries[name] || 'Not configured.';
}

function runSummaryHtml(run) {
  return `<div class="grid"><div><h3>${escapeHtml(run.title || 'Untitled article')}</h3><p>${escapeHtml(run.runId)} · ${escapeHtml(run.version)}</p></div><div>${statusPill(run.status)} ${statusPill(run.publishability)}</div><div><strong>${escapeHtml(humanizeLabel(run.modelMode || run.modelProvider || 'Unknown'))}</strong><p>Writing provider</p></div><div><strong>${escapeHtml(run.unresolvedIssueCount ?? 0)}</strong><p>Unresolved issues</p></div></div><p>Canonical: ${escapeHtml(run.canonicalUrl || 'Not set')}</p>`;
}

function actionButtons(runId, version, csrf, permissions, config = {}) {
  const forms = [];
  if (permissions.includes('content.article.review')) forms.push(form('/app/content/actions/review/start', 'Open Review', { runId, _csrf: csrf }), form('/app/content/actions/review/revise', 'Request Revision', { runId, _csrf: csrf }), form('/app/content/actions/review/reject', 'Reject', { runId, note: 'Rejected from dashboard.', _csrf: csrf }));
  if (permissions.includes('content.article.approve')) forms.push(form('/app/content/actions/review/approve', 'Approve', { runId, version, confirm: 'true', _csrf: csrf }, 'primary'));
  if (permissions.includes('content.article.publish.prepare')) {
    forms.push(form('/app/content/actions/publishing/prepare', 'Prepare for Certifyd', { runId, _csrf: csrf }), form('/app/content/actions/publishing/validate', 'Validate', { runId, _csrf: csrf }));
    if (config.githubPublishing?.enabled) forms.push(form('/app/content/actions/publishing/pr', 'Publish to Certifyd Draft PR', { runId, _csrf: csrf }, 'primary'));
  }
  forms.push(`<a class="ghost" href="/app/content/articles/${escapeHtml(runId)}/preview">Preview</a>`);
  return `<div class="actions">${forms.join('')}</div>`;
}

function form(action, label, fields, className = 'ghost') {
  return `<form method="post" action="${action}">${Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('')}<button class="${className}" type="submit">${escapeHtml(label)}</button></form>`;
}

function claimTable(claims) {
  if (!claims.length) return '<p>No claims found.</p>';
  return `<table class="table"><thead><tr><th>Claim</th><th>Status</th><th>Classification</th><th>Note</th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${escapeHtml(claim.text || claim.claim || '')}</td><td>${statusPill(claim.status)}</td><td>${escapeHtml(claim.classification || '')}</td><td>${escapeHtml(claim.reviewerNote || claim.requiredQualification || claim.blockingReason || '')}</td></tr>`).join('')}</tbody></table>`;
}

function distributionList(assets) {
  if (!assets?.length) return '<p>No distribution assets found.</p>';
  return assets.map((asset) => `<details><summary>${escapeHtml(asset.channel)} · DRAFT</summary><pre>${escapeHtml(asset.body)}</pre></details>`).join('');
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  return new URLSearchParams(body);
}

function validateIntake(form) {
  const requiredFields = ['topic', 'audience', 'objective', 'contentType', 'provider'];
  for (const field of requiredFields) {
    const value = String(form.get(field) || '').trim();
    if (!value) throw Object.assign(new Error(`Missing required intake field: ${field}`), { statusCode: 400 });
    if (value.length > 300) throw Object.assign(new Error(`Intake field is too long: ${field}`), { statusCode: 400 });
  }
  const contentType = String(form.get('contentType') || '');
  const provider = String(form.get('provider') || '');
  if (!['article', 'brief', 'explainer'].includes(contentType)) throw Object.assign(new Error('Invalid content type.'), { statusCode: 400 });
  if (!['deterministic', 'ollama'].includes(provider)) throw Object.assign(new Error('Invalid generation provider.'), { statusCode: 400 });
}

async function serveStatic(req, res, url, siteRoot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405, 'Method not allowed');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  let file = path.resolve(siteRoot, `.${pathname}`);
  if (!file.startsWith(siteRoot)) return sendStatus(res, 403, 'Forbidden');
  let stat = await fs.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    if (!file.startsWith(siteRoot)) return sendStatus(res, 403, 'Forbidden');
    stat = await fs.stat(file).catch(() => null);
  }
  if (!stat?.isFile()) return sendStatus(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': STATIC_TYPES.get(path.extname(file)) || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  res.end(await fs.readFile(file));
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline' 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'");
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendStatus(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function sendError(res, error) {
  if (res.headersSent) return res.end();
  const status = error.statusCode || 500;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(status >= 500 ? 'Internal server error' : error.message);
}
