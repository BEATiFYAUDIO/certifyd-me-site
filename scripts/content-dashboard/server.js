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
import { filterTrendingOpportunities, getTrendingOpportunities, TRENDING_CATEGORIES } from './trends.js';

const STATIC_TYPES = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.xml','application/xml; charset=utf-8'],['.txt','text/plain; charset=utf-8'],['.mp4','video/mp4']]);

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
  req.on('aborted', () => abortController.abort());
  res.on('close', () => {
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
  else if (action.endsWith('/publishing/pr')) { needs('content.article.publish.prepare'); result = await ctx.actions.publishToCertifyd({ actor: ctx.user, runId: form.get('runId'), version: form.get('version') }); }
  else if (action.endsWith('/publishing/verify-live')) { needs('content.article.publish.prepare'); result = await ctx.actions.verifyLivePublication({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/publishing/unpublish')) { needs('content.article.publish.prepare'); result = await ctx.actions.unpublishFromCertifyd({ actor: ctx.user, runId: form.get('runId'), confirmUnpublish: form.get('confirmUnpublish') }); }
  else if (action.endsWith('/publishing/verify-unpublished')) { needs('content.article.publish.prepare'); result = await ctx.actions.verifyUnpublishedPublication({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/article/archive')) { needs('content.article.archive'); result = await ctx.actions.archiveArticle({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/article/delete-draft')) { needs('content.article.delete'); result = await ctx.actions.deleteDraft({ actor: ctx.user, runId: form.get('runId'), confirmDelete: form.get('confirmDelete') }); }
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
  if (pathName === '/app/content/brain') { allow('brain.read'); return sendHtml(res, await renderBrain(ctx, url)); }
  if (pathName === '/app/content/topics') { allow('content.article.view'); return redirect(res, '/app/content/articles?view=ideas'); }
  if (pathName === '/app/content/publishing') { allow('content.publishing.view'); return redirect(res, '/app/content/articles?view=approved'); }
  if (pathName === '/app/content/review') { allow('content.article.review'); return redirect(res, '/app/content/articles?view=review'); }
  if (pathName === '/app/content/knowledge-review') { allow('brain.read'); return redirect(res, '/app/content/brain?view=suggestions'); }
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

async function renderOverview(ctx, csrf) {
  const runs = await ctx.runRepo.listRuns();
  const trends = await getTrendingOpportunities(ctx.config);
  const drafts = runs.filter((run) => ['DRAFT', 'GENERATED'].includes(run.status));
  const inReview = runs.filter((run) => run.status === 'PENDING_FOUNDER_REVIEW');
  const published = runs.filter((run) => run.status === 'PUBLISHED').slice(0, 4);
  const needsAttention = runs.filter((run) => articleMatchesView(run, 'attention'));
  const recent = runs
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, 5);
  const statusText = ctx.config.ollama.enabled ? `Qwen ready: ${ctx.config.ollama.model}` : 'Qwen not configured';
  const body = `<section class="mission-head">
    <p class="eyebrow">Dashboard</p>
    <h1>What needs attention?</h1>
  </section>

  <section class="attention-grid" aria-label="Attention summary">
    ${summaryCard('Trending opportunities', trends.items.length, trends.provider === 'rss' ? 'Live source scan' : 'Seeded ideas', '/app/content/articles?view=ideas')}
    ${summaryCard('Drafts', drafts.length, 'Open drafts', '/app/content/articles?view=drafts')}
    ${summaryCard('In review', inReview.length, 'Review queue', '/app/content/articles?view=review')}
    ${summaryCard('Brain suggestions', KNOWLEDGE_SUGGESTIONS.length, 'Review Brain', '/app/content/brain?view=suggestions')}
    ${summaryCard('Needs attention', needsAttention.length, 'Distribution status', '/app/content/distribution?view=attention')}
  </section>

  <section class="workspace-section grid dashboard-grid">
    ${card('Recent Activity', recent.length ? `<div class="review-list compact-list">${recent.map((run) => compactRunRow(run)).join('')}</div>` : '<p>No recent activity yet.</p>')}
    ${card('Recently Published', published.length ? `<div class="review-list compact-list">${published.map((run) => publishedRow(run)).join('')}</div>` : '<p>No published articles yet.</p>')}
  </section>

  <section class="status-strip panel" aria-label="System status">
    <span>${escapeHtml(statusText)}</span>
    <span>Brain: approved knowledge source</span>
    <span>Publishing: ${escapeHtml(ctx.config.githubPublishing.enabled ? 'draft PRs enabled' : 'disabled')}</span>
  </section>`;
  return layout({ title: 'Dashboard', user: ctx.user, permissions: ctx.permissions, active: 'Dashboard', body });
}

function summaryCard(title, count, label, href) {
  return `<a class="summary-card" href="${escapeHtml(href)}"><span>${escapeHtml(title)}</span><strong>${escapeHtml(count)}</strong><em>${escapeHtml(label)} →</em></a>`;
}

function compactRunRow(run) {
  return `<article class="review-item compact-row"><div><h3>${escapeHtml(run.title || 'Untitled article')}</h3><p>${statusPill(run.status)} <span class="muted">${escapeHtml(formatDashboardDate(run.updatedAt || run.createdAt))}</span></p></div><a class="ghost" href="/app/content/articles/${escapeHtml(run.runId)}">Open</a></article>`;
}

function qwenPromptForm({ csrf, compact = false, advanced = false } = {}) {
  const promptId = compact ? 'blog-qwen-topic-compact' : 'blog-qwen-topic';
  const body = `<form class="prompt-form ${compact ? 'prompt-form-compact' : ''}" method="post" action="/app/content/actions/generate" data-generating-form data-primary-generation-form>
    <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
    <input type="hidden" name="provider" value="ollama">
    ${advanced ? '' : '<input type="hidden" name="contentType" value="article">'}
    <input type="hidden" name="audience" value="Creators, partners and investors">
    <input type="hidden" name="objective" value="Create a grounded Certifyd article using approved Brain context. Keep current capabilities distinct from planned capabilities.">
    <label class="sr-only" for="${promptId}">Article prompt</label>
    <textarea id="${promptId}" class="prompt-input" name="topic" required maxlength="300" placeholder="Tell Qwen what to write. Paste a topic, angle, document notes or article response request."></textarea>
    ${advanced ? `<details><summary>Advanced options</summary><label>Working title<input name="workingTitle" maxlength="160"></label><label>Article type<select name="contentType"><option value="article">Article</option><option value="brief">Brief</option><option value="explainer">Explainer</option></select></label><label>Style<input name="writingStyle" maxlength="240" value="Plain, factual, investor-safe Certifyd editorial"></label><label>Source restrictions<textarea name="sourceRestrictions" maxlength="800">Use Certifyd Brain and approved public claims only. Distinguish live features from planned capabilities.</textarea></label><label><input type="checkbox" name="externalResearchAllowed" value="true"> Approved external research allowed when configured</label></details>` : ''}
    <div class="generation-progress" role="status" aria-live="polite" hidden><span>Qwen is generating. This can take about one to two minutes.</span><i></i></div>
    <div class="actions"><button class="primary" type="submit">Ask Qwen</button><a class="ghost" href="/app/content/model-health">Check Qwen</a></div>
  </form>`;
  return compact ? `${body}<div class="example-chips" aria-label="Prompt examples">${['Compare Certifyd to Spotify', 'Explain creator ownership', 'Respond to this article', 'Write about local AI', 'Turn this document into a blog article'].map((example) => quickGenerateForm({ csrf, label: example, topic: example })).join('')}</div>` : body;
}

function opportunityCard(item, csrf, canCreate) {
  return `<article class="opportunity-card">
    <div class="meta-row"><span class="pill warn">${escapeHtml(item.category)}</span>${brainCoveragePill(item.brainCoverage)}<span class="pill">${escapeHtml(item.sourceLabel || item.sourceType || 'Source')}</span></div>
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
  return `<form method="post" action="/app/content/actions/generate" data-generating-form>
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
  const selectedCategory = String(url.searchParams.get('category') || 'All');
  const trends = await getTrendingOpportunities(ctx.config);
  const search = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
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
    <td>${articleRowActions(run, csrf, ctx.permissions, ctx.config)}</td>
  </tr>`).join('');
  const opportunities = filterTrendingOpportunities(trends, selectedCategory);
  const canCreate = ctx.permissions.includes('content.article.create');
  const categoryTabs = `<div class="tabs compact"><a class="tab ${selectedCategory === 'All' ? 'active' : ''}" href="/app/content/articles?view=ideas">All</a>${TRENDING_CATEGORIES.map((category) => `<a class="tab ${category === selectedCategory ? 'active' : ''}" href="/app/content/articles?view=ideas&category=${encodeURIComponent(category)}">${escapeHtml(category)}</a>`).join('')}</div>`;
  const trendMeta = `<p class="muted">Provider: ${escapeHtml(trends.provider)}${trends.lastScannedAt ? ` · Last scanned: ${escapeHtml(formatDashboardDate(trends.lastScannedAt))}` : ''}${trends.sourceLabels?.length ? ` · Sources: ${escapeHtml(trends.sourceLabels.join(', '))}` : ''}</p>${trends.note ? `<p class="notice">${escapeHtml(trends.note)}</p>` : ''}`;
  const ideas = view === 'ideas' ? `<section class="workspace-section" aria-labelledby="ideas-title"><div class="section-head"><div><p class="eyebrow">Trending Opportunities</p><h2 id="ideas-title">What Qwen should watch.</h2>${trendMeta}</div>${categoryTabs}</div><div class="opportunity-grid">${opportunities.map((item) => opportunityCard(item, csrf, canCreate)).join('')}</div></section>` : '';
  const create = `<section class="editorial-prompt panel compact-prompt">
    <div>
      <p class="eyebrow">Ask Qwen</p>
      <h2>What should Certifyd write about?</h2>
    </div>
    ${canCreate ? qwenPromptForm({ csrf, compact: true }) : '<p class="notice">You can review content, but this role cannot generate new drafts.</p>'}
  </section>`;
  const filters = `<section class="panel"><div class="tabs">${tabs.map(([key, label]) => `<a class="tab ${key === view ? 'active' : ''}" href="/app/content/articles?view=${escapeHtml(key)}">${escapeHtml(label)}</a>`).join('')}</div><form class="search-row" method="get" action="/app/content/articles"><input type="hidden" name="view" value="${escapeHtml(view)}"><label>Search<input name="q" value="${escapeHtml(search)}" placeholder="Title, slug, topic, source or author"></label><button class="ghost" type="submit">Search</button></form></section>`;
  return layout({ title: 'Blog Engine', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body: `<p class="eyebrow">Blog Engine</p><h1>Article workspace</h1>${filters}${create}${ideas}<section class="panel"><table class="table"><thead><tr><th>Title</th><th>Status</th><th>Updated</th><th>Author</th><th>Canonical URL</th><th>Sources</th><th>Distribution</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="8"><p class="empty">No articles match this view.</p></td></tr>'}</tbody></table></section>` });
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
  const body = `<p class="eyebrow">Article Workspace</p><h1>${escapeHtml(summary.title || 'Untitled article')}</h1>${runSummaryHtml(summary)}${actionButtons(summary, csrf, ctx.permissions, ctx.config)}<div class="workspace-tabs"><a href="#write">Write</a><a href="#preview">Preview</a><a href="#sources">Sources</a><a href="#distribution">Distribution</a><a href="#history">History</a></div><section id="write" class="workspace-section">${card('Write', `<p class="muted">Editing persistence is intentionally staged. Review and approval use the exact generated version shown here.</p><textarea rows="16">${escapeHtml(run.articleMarkdown || run.draftMarkdown || '')}</textarea>`)}</section><section id="preview" class="workspace-section">${card('Preview', articlePreviewHtml(run))}</section><section id="sources" class="workspace-section"><div class="grid">${card('Source coverage', `<p>Claims: ${claims.length}</p><p>Unresolved blockers: ${escapeHtml(summary.unresolvedIssueCount ?? 0)}</p>`)}${card('Approved Brain context', `<pre>${escapeHtml(JSON.stringify({ brain: evidenceCount, external: externalCount }, null, 2))}</pre>`)}${card('Claims', claimTable(claims))}</div></section><section id="distribution" class="workspace-section">${card('Distribution', distributionList(distributionAssets, run.distribution?.plan))}</section><section id="history" class="workspace-section">${card('History', versions.map((item) => `<p>${escapeHtml(item.version)}</p>`).join('') || '<p>No versions found.</p>')}</section>`;
  return layout({ title: summary.title || 'Article', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderFounderReview(ctx, runId, csrf) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const summary = run.summary || {};
  const claims = Array.isArray(run.claimLedger?.claims) ? run.claimLedger.claims : [];
  const body = `<p class="eyebrow">Founder Review</p><h1>${escapeHtml(summary.title || 'Untitled article')}</h1><p class="notice">Approval requires founder permission, exact displayed version, zero blocking claims and explicit confirmation. This approves version ${escapeHtml(summary.version || 'v1')} for Certifyd Blog publishing preparation.</p>${runSummaryHtml(summary)}${card('Final Checklist', `<ul><li>Version: ${escapeHtml(summary.version || 'v1')}</li><li>Blocking claims: ${escapeHtml(summary.unresolvedIssueCount ?? 0)}</li><li>Canonical URL: ${escapeHtml(summary.canonicalUrl || 'Not set')}</li><li>Publishability: ${escapeHtml(humanizeLabel(summary.publishability || 'UNKNOWN'))}</li></ul>`)}${card('Blocked or Qualified Claims', claimTable(claims.filter((claim) => claim.status !== 'APPROVED')))}${card('Article Preview', articlePreviewHtml(run))}${actionButtons(summary, csrf, ctx.permissions, ctx.config)}`;
  return layout({ title: 'Founder Review', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderPreview(ctx, runId) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const pkg = run.blogPackage || {};
  const summary = run.summary || {};
  const body = `<p class="eyebrow">Internal preview — not published</p><h1>${escapeHtml(pkg.title || summary.title || 'Untitled article')}</h1><p>${escapeHtml(pkg.description || '')}</p><div class="panel"><p><strong>Author:</strong> ${escapeHtml(pkg.author || 'Certifyd')}</p><p><strong>Canonical:</strong> ${escapeHtml(summary.canonicalUrl || 'Not set')}</p><p><strong>Structured metadata:</strong> ${pkg.structuredData ? 'Available' : 'Missing'}</p></div><article class="panel article">${renderMarkdown(articleMarkdownForPreview(run))}</article>`;
  return layout({ title: 'Preview', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderBrain(ctx, url = new URL('http://localhost/app/content/brain')) {
  const view = String(url.searchParams.get('view') || 'knowledge');
  const files = await ctx.brainRepo.listFiles();
  const canWriteBrain = ctx.permissions.includes('brain.write');
  const tabs = [['knowledge', 'Knowledge'], ['suggestions', 'Suggestions'], ['stale', 'Stale'], ['conflicts', 'Conflicts']];
  const tabHtml = `<div class="tabs">${tabs.map(([key, label]) => `<a class="tab ${key === view ? 'active' : ''}" href="/app/content/brain?view=${escapeHtml(key)}">${escapeHtml(label)}</a>`).join('')}</div>`;
  let content = '';
  if (view === 'suggestions') {
    content = `<section class="panel"><div class="section-head"><div><p class="eyebrow">Knowledge Suggestions</p><h2>Founder-reviewed Brain updates.</h2></div></div><p>Qwen can suggest Brain changes, but approved knowledge is never updated automatically.</p><div class="review-list">${KNOWLEDGE_SUGGESTIONS.map((suggestion) => knowledgeSuggestionRow(suggestion, canWriteBrain)).join('')}</div></section>`;
  } else if (view === 'stale') {
    content = `<section class="panel"><p class="empty">No stale Brain records are queued in this pass.</p></section>`;
  } else if (view === 'conflicts') {
    content = `<section class="panel"><p class="empty">No Brain conflicts are queued in this pass.</p></section>`;
  } else {
    const rows = files.map((file) => `<tr><td>${escapeHtml(file.name)}</td><td>${escapeHtml(humanizeLabel(file.classification))}</td><td>${escapeHtml(file.lastUpdated)}</td><td>${escapeHtml(file.evidenceUsageCount)}</td><td>${escapeHtml(humanizeLabel(file.staleStatus))}</td></tr>`).join('');
    content = `<section class="panel"><form class="search-row"><label>Filter Brain records<input placeholder="Search by file, status or topic" disabled></label><button class="ghost" disabled>Search</button></form></section><section class="panel"><table class="table"><thead><tr><th>File</th><th>Classification</th><th>Updated</th><th>Usage</th><th>Review state</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No Brain records found.</td></tr>'}</tbody></table></section>`;
  }
  return layout({ title: 'Brain', user: ctx.user, permissions: ctx.permissions, active: 'Brain', body: `<p class="eyebrow">Brain</p><h1>Knowledge system</h1>${tabHtml}${content}` });
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
  return layout({ title: 'Publishing', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body: `<p class="eyebrow">Publishing</p><h1>Blog package preparation</h1><p class="notice">${escapeHtml(notice)}</p>${runs.map((run) => card(run.title, runSummaryHtml(run) + actionButtons(run, csrf, ctx.permissions, ctx.config))).join('')}` });
}

async function renderDistribution(ctx) {
  const runs = await ctx.runRepo.listRuns();
  const blocks = [];
  for (const run of runs) {
    const detail = await ctx.runRepo.readRun(run.runId).catch(() => null);
    blocks.push(card(run.title || 'Untitled article', distributionList(detail?.distribution?.assets, detail?.distribution?.plan)));
  }
  const primary = card('Certifyd Blog', '<strong>Primary publishing target</strong><p>Approved articles publish to <code>content/blog/[slug].md</code> and become available at <code>https://certifyd.me/blog/[slug]/</code> after the draft pull request is reviewed and merged.</p>');
  const channels = ['X', 'Medium', 'Substack', 'LinkedIn', 'Newsletter'].map((name) => card(name, '<strong>Disconnected</strong><p>Generate, preview, copy and export are staged. No external account publishes from this dashboard yet.</p>')).join('');
  return layout({ title: 'Distribution', user: ctx.user, permissions: ctx.permissions, active: 'Distribution', body: `<p class="eyebrow">Distribution</p><h1>Blog and channel versions</h1><p>Certifyd Blog is the canonical publishing path. Social and newsletter channels remain draft-only exports.</p><div class="grid">${primary}${channels}</div>${blocks.join('')}` });
}

function renderAnalytics(ctx) {
  const body = `<p class="eyebrow">Analytics</p><h1>Future analytics</h1><div class="grid">${['Search Console','Google Analytics','LinkedIn analytics','X analytics','Newsletter analytics'].map((name) => card(name, '<strong>Not connected</strong><p>Adapter contract exists; no live numbers are fabricated.</p>')).join('')}</div>`;
  return layout({ title: 'Analytics', user: ctx.user, permissions: ctx.permissions, active: 'Analytics', body });
}

function renderSettings(ctx) {
  const safe = { dashboardEnabled: ctx.config.enabled, authMode: ctx.config.authMode, publicAdminUrl: ctx.config.publicAdminUrl, database: ctx.config.databasePath === ':memory:' ? 'memory' : 'sqlite configured', userCount: ctx.userRepo.listUsers().length, localAi: { enabled: ctx.config.ollama.enabled, model: ctx.config.ollama.model, baseUrl: ctx.config.ollama.baseUrl ? 'configured' : 'not configured' }, trendResearch: ctx.config.trendResearchProvider || 'manual only', trendSourceCount: ctx.config.trendResearch?.sourceUrls?.length || 0, externalResearch: ctx.config.externalResearchProvider || 'not configured', brain: 'content-agent/knowledge', githubPublishing: ctx.config.githubPublishing.enabled ? 'draft pull requests' : 'disabled', githubRepositoryConfigured: Boolean(ctx.config.githubPublishing.owner && ctx.config.githubPublishing.repo), distributionAccounts: 'none connected', cloudflareAccessConfigured: Boolean(ctx.config.cloudflareAccess.teamDomain && ctx.config.cloudflareAccess.audience), environment: ctx.config.environmentName };
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
    'Trend research': safe.trendResearch === 'fixture' ? 'Seeded opportunities only. Configure approved RSS/search sources for live scans.' : `${safe.trendResearch} configured with ${safe.trendSourceCount} approved source${safe.trendSourceCount === 1 ? '' : 's'}.`,
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

function articleRowActions(run, csrf, permissions, config = {}) {
  const runId = escapeHtml(run.runId);
  const links = [
    `<a class="ghost" href="/app/content/articles/${runId}">Open</a>`,
    `<a class="ghost" href="/app/content/articles/${runId}/preview">Preview</a>`,
  ];
  if (permissions.includes('content.article.review')) links.push(`<a class="ghost" href="/app/content/review/${runId}">Review</a>`);
  return `<div class="actions">${links.join('')}${compactLifecycleForms(run, csrf, permissions, config)}</div>`;
}

function actionButtons(run, csrf, permissions, config = {}) {
  const runId = run.runId;
  const version = run.version || 'v1';
  const status = String(run.status || '');
  const publishability = String(run.publishability || '');
  const hasCertifydBlogUrl = /^https:\/\/certifyd\.me\/blog\/[a-z0-9-]+\/$/.test(String(run.canonicalUrl || ''));
  const forms = [];
  if (permissions.includes('content.article.review')) forms.push(form('/app/content/actions/review/start', 'Open Review', { runId, _csrf: csrf }), form('/app/content/actions/review/revise', 'Request Revision', { runId, _csrf: csrf }), form('/app/content/actions/review/reject', 'Reject', { runId, note: 'Rejected from dashboard.', _csrf: csrf }));
  if (permissions.includes('content.article.approve')) forms.push(form('/app/content/actions/review/approve', 'Approve', { runId, version, confirm: 'true', _csrf: csrf }, 'primary'));
  if (permissions.includes('content.article.publish.prepare')) {
    if (status === 'FOUNDER_APPROVED') forms.push(form('/app/content/actions/publishing/prepare', 'Prepare for Certifyd Blog', { runId, _csrf: csrf }));
    if (publishability === 'READY_TO_PUBLISH') {
      forms.push(form('/app/content/actions/publishing/validate', 'Validate', { runId, _csrf: csrf }));
      forms.push(form('/app/content/actions/publishing/pr', 'Publish to Certifyd', { runId, version, _csrf: csrf }, 'primary'));
      if (!config.githubPublishing?.enabled) forms.push('<span class="muted">GitHub publishing is disabled in Settings.</span>');
    }
    if (status === 'PUBLISHING') forms.push(form('/app/content/actions/publishing/verify-live', 'Verify Live', { runId, _csrf: csrf }, 'primary'));
    if (status === 'UNPUBLISHING') forms.push(form('/app/content/actions/publishing/verify-unpublished', 'Verify Removed', { runId, _csrf: csrf }, 'primary'));
    if (hasCertifydBlogUrl && !['ARCHIVED', 'UNPUBLISHING'].includes(status) && publishability !== 'REMOVED_FROM_LIVE_SITE') {
      forms.push(`<a class="primary" href="${escapeHtml(run.canonicalUrl)}">View Live</a>`);
      forms.push(`<form class="inline-confirm" method="post" action="/app/content/actions/publishing/unpublish"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label class="sr-only" for="confirm-unpublish-${escapeHtml(runId)}">Type unpublish to confirm live article removal</label><input id="confirm-unpublish-${escapeHtml(runId)}" name="confirmUnpublish" placeholder="type unpublish" autocomplete="off"><button class="ghost danger" type="submit">Unpublish from Certifyd</button></form>`);
    }
  }
  forms.push(compactLifecycleForms(run, csrf, permissions, config));
  forms.push(`<a class="ghost" href="/app/content/articles/${escapeHtml(runId)}/preview">Preview</a>`);
  return `<div class="actions">${forms.join('')}</div>`;
}

function compactLifecycleForms(run, csrf, permissions) {
  const forms = [];
  const runId = run.runId;
  const status = String(run.status || '');
  if (permissions.includes('content.article.archive') && status !== 'ARCHIVED') {
    forms.push(form('/app/content/actions/article/archive', 'Archive', { runId, _csrf: csrf }));
  }
  if (permissions.includes('content.article.delete') && !['PUBLISHED', 'PUBLISHING', 'ARCHIVED'].includes(status)) {
    forms.push(`<form class="inline-confirm" method="post" action="/app/content/actions/article/delete-draft"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label class="sr-only" for="confirm-delete-${escapeHtml(runId)}">Type delete to confirm draft deletion</label><input id="confirm-delete-${escapeHtml(runId)}" name="confirmDelete" placeholder="type delete" autocomplete="off"><button class="ghost danger" type="submit">Delete draft</button></form>`);
  }
  return forms.join('');
}

function form(action, label, fields, className = 'ghost') {
  return `<form method="post" action="${action}">${Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('')}<button class="${className}" type="submit">${escapeHtml(label)}</button></form>`;
}

function claimTable(claims) {
  if (!claims.length) return '<p>No claims found.</p>';
  return `<table class="table"><thead><tr><th>Claim</th><th>Status</th><th>Classification</th><th>Note</th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${escapeHtml(claim.text || claim.claim || '')}</td><td>${statusPill(claim.status)}</td><td>${escapeHtml(claim.classification || '')}</td><td>${escapeHtml(claim.reviewerNote || claim.requiredQualification || claim.blockingReason || '')}</td></tr>`).join('')}</tbody></table>`;
}

function distributionList(assets, plan = {}) {
  const primary = plan?.primaryTarget
    ? `<div class="notice"><strong>${escapeHtml(plan.primaryTarget.channel || 'Certifyd Blog')}</strong><p>${escapeHtml(plan.primaryTarget.url || '')}</p><p>Repository path: ${escapeHtml(plan.primaryTarget.repositoryPath || '')}</p></div>`
    : '<div class="notice"><strong>Certifyd Blog</strong><p>Prepare publishing to create the canonical blog package for <code>https://certifyd.me/blog/[slug]/</code>.</p></div>';
  if (!assets?.length) return `${primary}<p>No distribution assets found.</p>`;
  return `${primary}${assets.map((asset) => `<details><summary>${escapeHtml(asset.channel)} · ${escapeHtml(asset.status || 'DRAFT')}</summary><pre>${escapeHtml(asset.body)}</pre></details>`).join('')}`;
}

function articlePreviewHtml(run) {
  return `<article class="article">${renderMarkdown(articleMarkdownForPreview(run))}</article>`;
}

function articleMarkdownForPreview(run) {
  return stripMarkdownFrontmatter(run.articleMarkdown || run.draftMarkdown || run.blogPackage?.body || '');
}

function stripMarkdownFrontmatter(markdown) {
  return String(markdown || '').replace(/^\uFEFF?---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]?/, '').trimStart();
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
