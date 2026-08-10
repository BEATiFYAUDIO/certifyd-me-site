import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDashboardConfig, permissionsForRole } from './config.js';
import { ContentRunRepository, ContentBrainRepository } from './repository.js';
import { approvedBrainEvidence, ContentDashboardActions, AuditLogRepository } from './actions.js';
import { createCsrfToken, escapeHtml, parseCookies, safeReturnPath, validateRunId, verifyCsrf, verifySession, signSession } from './security.js';
import { card, humanizeLabel, layout, loginPage, renderMarkdown, statusPill } from './render.js';
import { verifyCloudflareAccessRequest } from './cloudflare-access.js';
import { DashboardUserRepository } from './users.js';
import { KNOWLEDGE_SUGGESTIONS, applyKnowledgeSuggestion, listPendingKnowledgeSuggestions } from './brain-suggestions.js';
import {
  buildSourceRegistry,
  dismissTrendOpportunity,
  filterTrendingOpportunities,
  recommendationCategoryLimit,
  recommendationTotalLimit,
  getTrendingOpportunities,
  readTrendSourceDetail,
  scanTrendOpportunities,
  saveTrendOpportunity,
  startTrendDailyScheduler,
  TRENDING_CATEGORIES,
} from './trends.js';

const STATIC_TYPES = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.xml','application/xml; charset=utf-8'],['.txt','text/plain; charset=utf-8'],['.mp4','video/mp4']]);

export function createContentDashboardServer(options = {}) {
  const config = options.config || getDashboardConfig(options.env || process.env);
  const runRepo = new ContentRunRepository(config);
  const brainRepo = new ContentBrainRepository(config);
  const actions = new ContentDashboardActions(config);
  const audit = new AuditLogRepository(config);
  const userRepo = new DashboardUserRepository(config);
  const trendScheduler = startTrendDailyScheduler(config);

  const server = http.createServer(async (req, res) => {
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
  server.on('close', () => trendScheduler?.stop?.());
  return server;
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
  else if (action.endsWith('/trends/scan')) { needs('content.article.create'); result = await scanTrendOpportunities(ctx.config); }
  else if (action.endsWith('/trends/dismiss')) { needs('content.article.edit'); result = await dismissTrendOpportunity(ctx.config, String(form.get('opportunityId') || '')); }
  else if (action.endsWith('/trends/save')) { needs('content.article.edit'); result = await saveTrendOpportunity(ctx.config, String(form.get('opportunityId') || ''), ctx.user); }
  else if (action.endsWith('/brain/suggestion')) { needs('brain.write'); result = await applyKnowledgeSuggestion({ config: ctx.config, brainRepo: ctx.brainRepo, audit: ctx.audit, actor: ctx.user, suggestionId: form.get('suggestionId'), decision: form.get('decision') }); }
  else if (action.endsWith('/review/start')) { needs('content.article.review'); result = await ctx.actions.startReview({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/review/revise')) { needs('content.article.review'); result = await ctx.actions.requestRevision({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/review/approve')) { needs('content.article.approve'); result = await ctx.actions.approve({ actor: ctx.user, runId: form.get('runId'), version: form.get('version'), confirm: form.get('confirm') }); }
  else if (action.endsWith('/review/reject')) { needs('content.article.review'); result = await ctx.actions.reject({ actor: ctx.user, runId: form.get('runId'), note: form.get('note') }); }
  else if (action.endsWith('/publishing/prepare')) { needs('content.article.publish.prepare'); result = await ctx.actions.preparePublishing({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/publishing/validate')) { needs('content.article.publish.prepare'); result = await ctx.actions.validatePublishing({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/publishing/cover')) { needs('content.article.edit'); result = await ctx.actions.updateCoverImage({ actor: ctx.user, runId: form.get('runId'), coverImage: form.get('coverImage'), mode: form.get('mode') }); }
  else if (action.endsWith('/publishing/cover-upload')) { needs('content.article.edit'); result = await ctx.actions.uploadCoverImage({ actor: ctx.user, runId: form.get('runId'), file: form.getFile('coverUpload') }); }
  else if (action.endsWith('/publishing/pr')) { needs('content.article.publish.prepare'); result = await ctx.actions.publishToCertifyd({ actor: ctx.user, runId: form.get('runId'), version: form.get('version') }); }
  else if (action.endsWith('/publishing/republish')) { needs('content.article.publish.prepare'); result = await ctx.actions.republishToCertifyd({ actor: ctx.user, runId: form.get('runId'), version: form.get('version') }); }
  else if (action.endsWith('/publishing/verify-live')) { needs('content.article.publish.prepare'); result = await ctx.actions.verifyLivePublication({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/publishing/unpublish')) { needs('content.article.publish.prepare'); result = await ctx.actions.unpublishFromCertifyd({ actor: ctx.user, runId: form.get('runId'), confirmUnpublish: form.get('confirmUnpublish') }); }
  else if (action.endsWith('/publishing/verify-unpublished')) { needs('content.article.publish.prepare'); result = await ctx.actions.verifyUnpublishedPublication({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/distribution/publish')) { needs('content.distribution.manage'); result = await ctx.actions.distributeArticle({ actor: ctx.user, runId: form.get('runId'), version: form.get('version'), destinations: form.getAll('destinations') }); }
  else if (action.endsWith('/distribution/retry')) { needs('content.distribution.manage'); result = await ctx.actions.distributeArticle({ actor: ctx.user, runId: form.get('runId'), version: form.get('version'), destinations: form.getAll('destinations'), retryFailed: true }); }
  else if (action.endsWith('/distribution/defaults')) { needs('content.distribution.manage'); result = await ctx.actions.saveDistributionDefaults({ actor: ctx.user, destinations: form.getAll('destinations') }); }
  else if (action.endsWith('/distribution/test')) { needs('content.distribution.manage'); result = await ctx.actions.testDistributionConnection({ actor: ctx.user, destinationId: form.get('destinationId') }); }
  else if (action.endsWith('/article/save')) { needs('content.article.edit'); result = await ctx.actions.saveArticleMarkdown({ actor: ctx.user, runId: form.get('runId'), articleMarkdown: form.get('articleMarkdown') }); }
  else if (action.endsWith('/article/archive')) { needs('content.article.archive'); result = await ctx.actions.archiveArticle({ actor: ctx.user, runId: form.get('runId') }); }
  else if (action.endsWith('/article/delete-draft')) { needs('content.article.delete'); result = await ctx.actions.deleteDraft({ actor: ctx.user, runId: form.get('runId'), confirmDelete: form.get('confirmDelete') }); }
  else return sendStatus(res, 404, 'Unknown action');
  if (action.endsWith('/publishing/cover') || action.endsWith('/publishing/cover-upload')) {
    return redirect(res, `/app/content/articles/${validateRunId(String(form.get('runId') || ''))}#cover-image`);
  }
  if (action.includes('/distribution/')) {
    return redirect(res, `/app/content/distribution${form.get('runId') ? `?runId=${encodeURIComponent(validateRunId(String(form.get('runId') || '')))}` : ''}`);
  }
  if (action.endsWith('/brain/suggestion')) {
    const changed = result?.changedRecord?.id ? `&changed=${encodeURIComponent(result.changedRecord.id)}` : '';
    return redirect(res, `/app/content/brain?view=${result?.decision === 'reject' ? 'suggestions' : 'knowledge'}${changed}`);
  }
  sendHtml(res, layout({ title: 'Action Result', user: ctx.user, permissions: ctx.permissions, body: `<p class="eyebrow">Action result</p><h1>Completed</h1><pre>${escapeHtml(result.output || JSON.stringify(result, null, 2))}</pre>${actionResultLinks(result)}<p><a class="ghost" href="/app/content">Back to dashboard</a></p>` }));
}

async function handlePage(req, res, url, ctx) {
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
  const pathName = url.pathname;
  const allow = (permission) => {
    if (!ctx.permissions.includes(permission)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  };
  if (pathName === '/app/content' || pathName === '/app/content/') { allow('content.dashboard.view'); return sendHtml(res, await renderOverview(ctx, csrf, url)); }
  if (pathName === '/app/content/articles' || pathName === '/app/content/blog-engine') { allow('content.article.view'); return sendHtml(res, await renderArticles(ctx, url)); }
  if (pathName === '/app/content/trends.json') { allow('content.article.view'); return sendJson(res, await getTrendingOpportunities(ctx.config)); }
  const trendSourcesMatch = pathName.match(/^\/app\/content\/trends\/([^/]+)\/sources$/);
  if (trendSourcesMatch) { allow('content.article.view'); return sendHtml(res, await renderTrendSources(ctx, trendSourcesMatch[1])); }
  if (pathName === '/app/content/model-health') { allow('content.article.create'); return sendJson(res, await ctx.actions.generationHealth({ provider: 'ollama' })); }
  if (pathName === '/app/content/brain') { allow('brain.read'); return sendHtml(res, await renderBrain(ctx, url)); }
  if (pathName === '/app/content/topics') { allow('content.article.view'); return redirect(res, '/app/content/articles?view=ideas'); }
  if (pathName === '/app/content/publishing') { allow('content.publishing.view'); return redirect(res, '/app/content/articles?view=approved'); }
  if (pathName === '/app/content/review') { allow('content.article.review'); return redirect(res, '/app/content/articles?view=review'); }
  if (pathName === '/app/content/knowledge-review') { allow('brain.read'); return redirect(res, '/app/content/brain?view=suggestions'); }
  if (pathName === '/app/content/distribution') { allow('content.distribution.view'); return sendHtml(res, await renderDistribution(ctx, url)); }
  if (pathName === '/app/content/analytics') { allow('content.analytics.view'); return redirect(res, '/app/content/settings#advanced-diagnostics'); }
  if (pathName === '/app/content/settings') { allow('content.settings.manage'); return sendHtml(res, await renderSettings(ctx)); }
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
  const drafts = runs.filter((run) => isDraftLikeStatus(run.status) || (!run.status && !run.canonicalUrl));
  const inReview = runs.filter((run) => run.status === 'PENDING_FOUNDER_REVIEW');
  const published = runs.filter(isPublishedStatus).slice(0, 4);
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
    <span>Publishing: ${escapeHtml(publishingStatusLabel(ctx.config.githubPublishing))}</span>
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
  const publishers = Array.isArray(item.sourcePublishers) && item.sourcePublishers.length ? item.sourcePublishers.join(', ') : item.sourceLabel || item.sourceType || 'Source';
  const sourceCount = Number(item.sourceCount || item.sourceItemIds?.length || 0);
  const riskFlags = Array.isArray(item.riskFlags) ? item.riskFlags : [];
  const sourceIds = Array.isArray(item.sourceItemIds) ? item.sourceItemIds.join(',') : '';
  const brainIds = Array.isArray(item.brainRecordIds) ? item.brainRecordIds.join(',') : '';
  const originalLinks = originalSourceLinks(item);
  const restrictions = [
    `Trend opportunity: ${item.id || item.title}.`,
    sourceIds ? `Use only these approved source summaries: ${sourceIds}.` : 'Use approved Brain context only; no live source summaries are attached.',
    brainIds ? `Relevant approved Brain records: ${brainIds}.` : 'If approved Brain context is weak, qualify claims and request review.',
    'Do not claim live web research beyond the attached source summaries.'
  ].join(' ');
  return `<article class="opportunity-card">
    <div class="meta-row"><span class="pill warn">${escapeHtml(item.category)}</span>${brainCoveragePill(item.brainCoverage)}<span class="pill">${escapeHtml(item.evidenceLabel || item.sourceLabel || 'Source-backed')}</span>${item.saved ? '<span class="pill good">Saved</span>' : ''}</div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.summary || item.suggestedAngle || '')}</p>
    <dl>
      <dt>Why it is trending</dt><dd>${escapeHtml(item.whyTrending || 'Source activity detected.')}</dd>
      <dt>Why it matters to Certifyd</dt><dd>${escapeHtml(item.whyItMattersToCertifyd || item.whyCertifyd || '')}</dd>
      <dt>Evidence</dt><dd>${escapeHtml(sourceCount ? `${sourceCount} source item${sourceCount === 1 ? '' : 's'} · ${publishers}` : publishers)}${item.newestSourceDate ? ` · ${escapeHtml(formatDashboardDate(item.newestSourceDate))}` : ''}</dd>
      <dt>Original source${originalLinks.length === 1 ? '' : 's'}</dt><dd>${originalLinks.length ? originalLinks.map((source) => `<a href="${escapeHtml(source.url)}" rel="noreferrer" target="_blank">Read original ↗</a>`).join(' · ') : '<span class="muted">No original source URL supplied.</span>'}</dd>
      <dt>Risk</dt><dd>${riskFlags.length ? riskFlags.map((flag) => `<span class="pill bad">${escapeHtml(flag)}</span>`).join(' ') : '<span class="pill good">No source risk flagged</span>'}</dd>
    </dl>
    <div class="mini-actions">
      ${canCreate ? quickGenerateForm({ csrf, label: 'Generate Article', topic: item.topic || item.title, className: 'primary', extraFields: { trendOpportunityId: item.id || '', trendSourceItemIds: sourceIds, trendBrainRecordIds: brainIds, sourceRestrictions: restrictions } }) : '<p class="muted">Generation unavailable for this role.</p>'}
      ${sourceIds ? `<a class="ghost" href="/app/content/trends/${encodeURIComponent(item.id || '')}/sources">View Sources</a>` : ''}
      <form method="post" action="/app/content/actions/trends/save"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="opportunityId" value="${escapeHtml(item.id || '')}"><button class="ghost" type="submit">${item.saved ? 'Saved' : 'Save'}</button></form>
      <form method="post" action="/app/content/actions/trends/dismiss"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="opportunityId" value="${escapeHtml(item.id || '')}"><button class="ghost" type="submit">Dismiss</button></form>
    </div>
  </article>`;
}

function originalSourceLinks(item = {}) {
  const fromRecords = Array.isArray(item.originalSources)
    ? item.originalSources.map((source) => ({ url: source.sourceUrl || source.articleUrl || '', title: source.sourceTitle || source.title || source.publisher || 'Original source' }))
    : [];
  const fromUrls = Array.isArray(item.sourceUrls)
    ? item.sourceUrls.map((url) => ({ url, title: 'Original source' }))
    : [];
  const links = [...fromRecords, ...fromUrls].filter((source) => /^https?:\/\//i.test(String(source.url || '')));
  const seen = new Set();
  return links.filter((source) => {
    const key = String(source.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function brainCoveragePill(value) {
  const normalized = String(value || '').toLowerCase();
  const tone = normalized.includes('strong') ? 'good' : normalized.includes('needs') ? 'bad' : 'warn';
  return `<span class="pill ${tone}">Brain: ${escapeHtml(value || 'Unknown')}</span>`;
}

function quickGenerateForm({ csrf, label, topic, className = 'example-chip', extraFields = {} }) {
  const hidden = Object.entries(extraFields || {}).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
  return `<form method="post" action="/app/content/actions/generate" data-generating-form>
    <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
    <input type="hidden" name="provider" value="ollama">
    <input type="hidden" name="contentType" value="article">
    <input type="hidden" name="topic" value="${escapeHtml(topic)}">
    <input type="hidden" name="audience" value="Creators, partners and investors">
    <input type="hidden" name="objective" value="Create a grounded Certifyd article using approved Brain context. Keep current capabilities distinct from planned capabilities.">
    ${hidden}
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

function knowledgeSuggestionRow(suggestion, canWriteBrain, csrf) {
  const controls = canWriteBrain
    ? `<form method="post" action="/app/content/actions/brain/suggestion"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="suggestionId" value="${escapeHtml(suggestion.id)}"><input type="hidden" name="decision" value="approve"><button class="ghost" type="submit">Approve</button></form><form method="post" action="/app/content/actions/brain/suggestion"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="suggestionId" value="${escapeHtml(suggestion.id)}"><input type="hidden" name="decision" value="reject"><button class="ghost danger" type="submit">Reject</button></form>`
    : '<span class="muted">Brain approval requires write permission.</span>';
  return `<article class="review-item knowledge-item">
    <div>
      <div class="meta-row"><span class="pill warn">${escapeHtml(suggestion.category)}</span><span class="pill ${suggestion.confidence === 'High' ? 'good' : 'warn'}">${escapeHtml(suggestion.confidence)} confidence</span></div>
      <h3>${escapeHtml(suggestion.title)}</h3>
      <p>${escapeHtml(suggestion.summary)}</p>
      <p class="muted">Target: <code>${escapeHtml(suggestion.targetPath || '')}</code></p>
      <p class="muted">Sources: ${suggestion.sources.map((source) => escapeHtml(source)).join(', ')}</p>
    </div>
    <div class="mini-actions">${controls}</div>
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


function formatDashboardDateTime(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto', timeZoneName: 'short' }).format(date);
}

function trendSummaryPanel(trends) {
  const summary = trends.summary || {};
  const stories = Array.isArray(trends.sourceStories || trends.sourceItems) ? (trends.sourceStories || trends.sourceItems) : [];
  const sourceStatus = Array.isArray(trends.providerStatus) ? trends.providerStatus : [];
  const metrics = [
    ['Sources checked', Number(summary.sourcesChecked || sourceStatus.length || 0)],
    ['Collected', Number(summary.storiesCollected || 0)],
    ['Retained', Number(summary.storiesRetained || stories.length || 0)],
    ['Recommended', Number(summary.opportunitiesCreated || trends.items?.length || 0)],
    ['Failures', Number(summary.sourceFailures || 0)],
  ];
  const lastScan = trends.lastScannedAt ? formatCompactDateTime(trends.lastScannedAt) : 'Not scanned yet';
  return `<div class="panel compact-panel trend-summary"><div class="meta-row trend-summary-metrics">${metrics.map(([label, value]) => `<span class="pill ${label === 'Failures' && value > 0 ? 'bad' : label === 'Failures' ? 'good' : 'warn'}">${escapeHtml(String(value))} ${escapeHtml(label.toLowerCase())}</span>`).join('')}</div><p class="muted">Last scan: ${escapeHtml(lastScan)} · Saved ideas: ${escapeHtml(String(trends.savedIdeas?.length || 0))}</p>${trends.note ? `<p class="muted">${escapeHtml(trends.note)}</p>` : ''}</div>`;
}

function trendSourceDetailsPanel(trends) {
  const stories = Array.isArray(trends.sourceStories || trends.sourceItems) ? (trends.sourceStories || trends.sourceItems) : [];
  const sourceStatus = Array.isArray(trends.providerStatus) ? trends.providerStatus : [];
  if (!sourceStatus.length) return '';
  const newest = newestSourceStory(stories);
  const freshness = newest
    ? `Newest source story: ${formatDashboardDate(newest.publishedAt)}${hasStoryPublishedToday(stories) ? '' : '. No retained stories published today.'}`
    : 'Newest source story: none retained.';
  return `<details class="panel compact-panel trend-source-details"><summary class="ghost">View sources</summary><p class="notice">${escapeHtml(freshness)}</p><div class="review-list source-health-list">${sourceStatus.map((source) => sourceHealthRow(source, stories)).join('')}</div></details>`;
}

function formatCompactDateTime(value) {
  if (!value) return 'Not scanned yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).format(date);
}

function sourceHealthRow(source, stories = []) {
  const tone = source.status === 'available' || source.status === 'ok' ? 'good' : source.status === 'unavailable' ? 'bad' : 'warn';
  const latestPublishedAt = source.latestPublishedAt || newestSourceStory(stories.filter((story) => story.publisher === source.publisher))?.publishedAt || null;
  const details = [
    `${Number(source.itemCount || 0)} feed items`,
    latestPublishedAt ? `latest source publication ${formatDashboardDateTime(latestPublishedAt)}` : 'latest source publication unknown',
    source.latestFetchAt ? `fetched ${formatDashboardDateTime(source.latestFetchAt)}` : '',
  ].filter(Boolean).join(' · ');
  return `<article class="review-item compact-row"><div><h3>${escapeHtml(source.publisher || source.id || 'Source')}</h3><p class="muted">${escapeHtml(details)}</p>${source.latestError ? `<p class="error">${escapeHtml(source.latestError)}</p>` : ''}</div><span class="pill ${tone}">${escapeHtml(source.status || 'unknown')}</span></article>`;
}

function trendStoryFilters(stories, params) {
  const selectedRange = String(params.get('storyRange') || 'all');
  const selectedPublisher = String(params.get('storyPublisher') || 'All');
  const selectedCategory = String(params.get('storyCategory') || 'All');
  const publishers = uniqueSorted(stories.map((story) => story.publisher).filter(Boolean));
  const categories = uniqueSorted(stories.flatMap((story) => story.categories || []).filter(Boolean));
  const rangeTabs = [
    ['all', 'All'],
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['7d', 'Last 7 days'],
  ];
  return `<form class="panel compact-panel source-story-filters" method="get" action="/app/content/articles"><input type="hidden" name="view" value="ideas"><div class="tabs compact">${rangeTabs.map(([key, label]) => `<button class="tab ${selectedRange === key ? 'active' : ''}" type="submit" name="storyRange" value="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join('')}</div><div class="search-row"><label>Publisher<select name="storyPublisher"><option>All</option>${publishers.map((publisher) => `<option ${publisher === selectedPublisher ? 'selected' : ''}>${escapeHtml(publisher)}</option>`).join('')}</select></label><label>Category<select name="storyCategory"><option>All</option>${categories.map((category) => `<option ${category === selectedCategory ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label><input type="hidden" name="storyRange" value="${escapeHtml(selectedRange)}"><button class="ghost" type="submit">Filter stories</button></div></form>`;
}

function filterTrendSourceStories(stories, params) {
  const range = String(params.get('storyRange') || 'all');
  const publisher = String(params.get('storyPublisher') || 'All');
  const category = String(params.get('storyCategory') || 'All');
  return [...stories].filter((story) => {
    const published = story.publishedAt ? new Date(story.publishedAt) : null;
    if (publisher !== 'All' && story.publisher !== publisher) return false;
    if (category !== 'All' && !(story.categories || []).includes(category)) return false;
    if (range !== 'all' && !published) return false;
    if (range === 'today' && relativeDayLabel(published) !== 'Today') return false;
    if (range === 'yesterday' && relativeDayLabel(published) !== 'Yesterday') return false;
    if (range === '7d' && Date.now() - published.getTime() > 7 * 24 * 60 * 60 * 1000) return false;
    return true;
  }).sort((a, b) => Date.parse(b.publishedAt || b.fetchedAt || 0) - Date.parse(a.publishedAt || a.fetchedAt || 0));
}

function sourceStoryCard(story) {
  const opportunity = story.opportunityIds?.length
    ? `<span class="pill good">In recommended opportunity</span><span class="pill">${escapeHtml((story.opportunityTitles || story.opportunityIds).join(', '))}</span>`
    : '<span class="pill">Not grouped into recommendation</span>';
  return `<article class="review-item source-story-card"><div><div class="meta-row"><span class="pill warn">${escapeHtml(story.publisher || 'Source')}</span><span class="pill ${story.retentionStatus === 'Recommended' ? 'good' : ''}">${escapeHtml(story.retentionStatus || story.status || 'Retained')}</span>${story.publishedAt ? `<span class="pill">${escapeHtml(formatDashboardDateTime(story.publishedAt))}</span><span class="pill">${escapeHtml(relativeDayLabel(new Date(story.publishedAt)))}</span>` : '<span class="pill">No source publication date</span>'}${(story.categories || []).map((category) => `<span class="pill">${escapeHtml(category)}</span>`).join('')}</div><h3>${escapeHtml(story.sourceTitle || story.title || 'Untitled source story')}</h3><p>${escapeHtml(story.summary || '')}</p><div class="meta-row">${opportunity}</div><p class="muted"><strong>Original URL:</strong> ${story.sourceUrl ? `<a href="${escapeHtml(story.sourceUrl)}" rel="noreferrer" target="_blank">${escapeHtml(story.sourceUrl)}</a>` : 'No original source URL supplied.'}</p><p class="muted"><strong>Retention:</strong> ${escapeHtml(story.retentionReason || 'Retained source story.')}</p><p class="muted">Source publication time is separate from fetched time${story.fetchedAt ? ` · fetched ${escapeHtml(formatDashboardDateTime(story.fetchedAt))}` : ''}${story.firstDetectedAt ? ` · first detected ${escapeHtml(formatDashboardDateTime(story.firstDetectedAt))}` : ''}</p></div>${story.sourceUrl ? `<a class="ghost" href="${escapeHtml(story.sourceUrl)}" rel="noreferrer" target="_blank">Read original ↗</a>` : '<span class="muted">No original source</span>'}</article>`;
}

function newestSourceStory(stories) {
  return stories.filter((story) => story.publishedAt && !Number.isNaN(Date.parse(story.publishedAt))).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] || null;
}

function hasStoryPublishedToday(stories) {
  return stories.some((story) => story.publishedAt && relativeDayLabel(new Date(story.publishedAt)) === 'Today');
}

function relativeDayLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown date';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = (value) => formatter.formatToParts(value).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const todayParts = parts(new Date());
  const dateParts = parts(date);
  const today = Date.UTC(Number(todayParts.year), Number(todayParts.month) - 1, Number(todayParts.day));
  const target = Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day));
  const days = Math.round((today - target) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1) return `${days} days ago`;
  return 'Future dated';
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function renderArticles(ctx, url) {
  const runs = await ctx.runRepo.listRuns();
  const view = String(url.searchParams.get('view') || 'drafts');
  const showAdvanced = url.searchParams.get('advanced') === '1';
  const selectedCategory = String(url.searchParams.get('category') || 'All');
  const trends = await getTrendingOpportunities(ctx.config);
  const search = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
  const tabs = [
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
  const articleCards = filteredRuns.map((run) => articleListCard(run, csrf, ctx.permissions, ctx.config)).join('');
  const draftsAndReview = runs
    .filter((run) => articleMatchesView(run, 'drafts') || articleMatchesView(run, 'review'))
    .slice(0, 6)
    .map((run) => draftRow(run, ctx.permissions))
    .join('');
  const opportunities = filterTrendingOpportunities(trends, selectedCategory);
  const displayLimit = selectedCategory === 'All' ? recommendationTotalLimit(ctx.config) : recommendationCategoryLimit(ctx.config);
  const recommended = opportunities.slice(0, displayLimit);
  const sourceStories = filterTrendSourceStories(trends.sourceStories || trends.sourceItems || [], url.searchParams);
  const canCreate = ctx.permissions.includes('content.article.create');
  const categoryTabs = `<div class="tabs compact"><a class="tab ${selectedCategory === 'All' ? 'active' : ''}" href="/app/content/articles?view=ideas">All</a>${TRENDING_CATEGORIES.map((category) => `<a class="tab ${category === selectedCategory ? 'active' : ''}" href="/app/content/articles?view=ideas&category=${encodeURIComponent(category)}">${escapeHtml(category)}</a>`).join('')}</div>`;
  const storyControls = trendStoryFilters(trends.sourceStories || trends.sourceItems || [], url.searchParams);
  const trendMeta = trendSummaryPanel(trends);
  const trendSourceDetails = trendSourceDetailsPanel(trends);
  const scanControls = `<form method="post" action="/app/content/actions/trends/scan" data-generating-form><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="primary" type="submit">Find trends now</button><div class="generation-progress" role="status" aria-live="polite" hidden><span>Scanning approved sources and ranking opportunities.</span><i></i></div></form><button class="ghost" type="button" disabled>Add idea manually</button>`;
  const emptyIdeas = `<p class="empty panel">No source-backed opportunities match this view. Run Find trends now, change category, or add an idea manually later.</p>`;
  const emptyStories = `<p class="empty panel">No retained source stories match this filter. This is normal when no approved source published in the selected window.</p>`;
  const trendsPanel = view === 'ideas'
    ? `<section class="workspace-section" aria-labelledby="ideas-title"><div class="section-head"><div><p class="eyebrow">B. Trending Opportunities</p><h2 id="ideas-title">Trending Opportunities</h2><p class="muted">The highest-ranked story opportunities from the latest scan.</p><div class="meta-row"><span class="pill warn">${escapeHtml(String(recommended.length))} recommended</span></div></div><div class="mini-actions">${scanControls}</div></div>${trendMeta}${categoryTabs}<div class="opportunity-grid">${recommended.length ? recommended.map((item) => opportunityCard(item, csrf, canCreate)).join('') : emptyIdeas}</div>${trendSourceDetails}<section class="workspace-section" aria-labelledby="recent-source-stories-title"><div class="section-head"><div><p class="eyebrow">Recent Source Stories</p><h2 id="recent-source-stories-title">Recent Source Stories</h2><p class="muted">Full retained source-story feed from the latest scan, sorted by source publication time.</p></div></div>${storyControls}<div class="review-list source-story-list">${sourceStories.length ? sourceStories.map(sourceStoryCard).join('') : emptyStories}</div></section></section>`
    : `<section class="workspace-section panel compact-panel" aria-labelledby="ideas-title"><div class="section-head"><div><p class="eyebrow">B. Trending Opportunities</p><h2 id="ideas-title">Trending Opportunities</h2><p class="muted">Scan approved RSS/Atom feeds and turn retained source stories into grounded article ideas.</p></div><div class="mini-actions"><a class="primary" href="/app/content/articles?view=ideas">Open Trends</a>${scanControls}</div></div></section>`;
  const create = `<section class="editorial-prompt panel compact-prompt">
    <div>
      <p class="eyebrow">A. What should Certifyd write about?</p>
      <h2>What should Certifyd write about?</h2>
    </div>
    ${canCreate ? qwenPromptForm({ csrf, compact: true, advanced: showAdvanced }) : '<p class="notice">You can review content, but this role cannot generate new drafts.</p>'}
    ${showAdvanced ? '<a class="ghost" href="/app/content/articles">Hide advanced</a>' : '<a class="ghost" href="/app/content/articles?advanced=1">Advanced</a>'}
  </section>`;
  const workflow = `<section class="workspace-section panel compact-panel"><div class="section-head"><div><p class="eyebrow">C. Drafts / In Review</p><h2>Drafts / In Review</h2><p class="muted">Active drafts and founder-review items stay before the full library.</p></div><a class="ghost" href="/app/content/articles?view=review">Open review queue</a></div><div class="review-list">${draftsAndReview || '<p class="empty">No drafts or review items found.</p>'}</div></section>`;
  const filters = `<section class="panel"><div class="section-head"><div><p class="eyebrow">D. Article Library</p><h2>Article Library</h2></div></div><div class="tabs">${tabs.map(([key, label]) => `<a class="tab ${key === view ? 'active' : ''}" href="/app/content/articles?view=${escapeHtml(key)}">${escapeHtml(label)}</a>`).join('')}</div><form class="search-row" method="get" action="/app/content/articles"><input type="hidden" name="view" value="${escapeHtml(view)}"><label>Search<input name="q" value="${escapeHtml(search)}" placeholder="Title, slug, topic, source or author"></label><button class="ghost" type="submit">Search</button></form></section>`;
  return layout({ title: 'Blog Engine', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body: `<p class="eyebrow">Blog Engine</p><h1>Article workspace</h1>${create}${trendsPanel}${workflow}${filters}<section class="article-list">${articleCards || '<p class="empty panel">No articles match this view.</p>'}</section>` });
}

async function renderTrendSources(ctx, opportunityId) {
  const detail = await readTrendSourceDetail(ctx.config, opportunityId);
  const opportunity = detail.opportunity || {};
  const sources = Array.isArray(detail.sources) ? detail.sources : [];
  const sourceRows = sources.map((source) => `<article class="review-item"><div><div class="meta-row"><span class="pill warn">${escapeHtml(source.publisher || source.sourceId || 'Source')}</span>${source.publishedAt ? `<span class="pill">${escapeHtml(formatDashboardDate(source.publishedAt))}</span>` : ''}</div><h3>${escapeHtml(source.sourceTitle || source.title || 'Untitled source item')}</h3><p>${escapeHtml(source.summary || source.description || '')}</p><p class="muted"><strong>Original URL:</strong> ${source.sourceUrl ? `<a href="${escapeHtml(source.sourceUrl)}" rel="noreferrer" target="_blank">${escapeHtml(source.sourceUrl)}</a>` : 'No original source URL supplied.'}</p><p class="muted">Feed: ${escapeHtml(source.feedUrl || source.sourceFeedUrl || '')}</p></div>${source.sourceUrl ? `<a class="ghost" href="${escapeHtml(source.sourceUrl)}" rel="noreferrer" target="_blank">Read original ↗</a>` : '<span class="muted">No original source</span>'}</article>`).join('');
  const body = `<p class="eyebrow">Trend sources</p><h1>${escapeHtml(opportunity.title || 'Opportunity')}</h1><p>${escapeHtml(opportunity.summary || opportunity.whyTrending || '')}</p><div class="grid">${card('Opportunity', `<p><strong>Category:</strong> ${escapeHtml(opportunity.category || 'Unknown')}</p><p><strong>Brain coverage:</strong> ${escapeHtml(opportunity.brainCoverage || 'Unknown')}</p><p><strong>Source items:</strong> ${sources.length}</p>`)}${card('Relevant Brain records', Array.isArray(opportunity.brainRecords) && opportunity.brainRecords.length ? `<ul class="source-list">${opportunity.brainRecords.map((record) => `<li><strong>${escapeHtml(record.title || record.id)}</strong><br><code>${escapeHtml(record.path || record.id)}</code></li>`).join('')}</ul>` : '<p>No approved Brain records were matched. Generation should qualify claims or require review.</p>')}</div><section class="panel"><h2>Source evidence</h2>${sourceRows || '<p>No source records found for this opportunity.</p>'}</section>`;
  return layout({ title: 'Trend sources', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

async function renderArticle(ctx, runId, csrf) {
  validateRunId(runId);
  const run = await ctx.runRepo.readRun(runId);
  const summary = run.summary || {};
  const claims = Array.isArray(run.claimLedger?.claims) ? run.claimLedger.claims : [];
  const brainEvidence = approvedBrainEvidence(run);
  const externalSources = articleExternalSources(run);
  const externalCount = externalSources.length;
  const distributionAssets = Array.isArray(run.distribution?.assets) ? run.distribution.assets : [];
  const versions = Array.isArray(run.versions) ? run.versions : [];
  const body = `<section class="article-workspace-head"><p class="eyebrow">Article Workspace</p><h1>${escapeHtml(summary.title || 'Untitled article')}</h1>${runSummaryHtml(summary)}</section><section id="cover-image" class="workspace-section">${card('Cover Image', coverImageControls(run, csrf, ctx.permissions, ctx.config))}</section>${brainContextWarning(brainEvidence)}${actionButtons(summary, csrf, ctx.permissions, ctx.config)}<div class="workspace-tabs"><a href="#write">Write</a><a href="#preview">Preview</a><a href="#sources">Sources</a><a href="#distribution">Distribution</a><a href="#history">History</a></div><section id="write" class="workspace-section">${card('Write', articleEditor(run, csrf, ctx.permissions))}</section><section id="preview" class="workspace-section">${card('Preview', articlePreviewHtml(run))}</section><section id="sources" class="workspace-section"><div class="grid">${card('Source coverage', `<p>Claims: ${claims.length}</p><p>Unresolved blockers: ${escapeHtml(summary.unresolvedIssueCount ?? 0)}</p><p>Approved Brain records: ${brainEvidence.length}</p><p>External original articles: ${externalCount}</p>`)}${card('Generation diagnostics', generationDiagnosticsHtml(run.research?.generationDiagnostics))}${card('Original articles used', externalSourceList(externalSources))}${card('Approved Brain context', brainContextList(brainEvidence))}${card('Claims', claimTable(claims))}</div></section><section id="distribution" class="workspace-section">${card('Distribution', distributionList(distributionAssets, run.distribution?.plan))}</section><section id="history" class="workspace-section">${card('History', versions.map((item) => `<p>${escapeHtml(item.version)}</p>`).join('') || '<p>No versions found.</p>')}</section>`;
  return layout({ title: summary.title || 'Article', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

function articleExternalSources(run = {}) {
  const provenanceSources = Array.isArray(run.research?.trendProvenance?.sourceUrls) ? run.research.trendProvenance.sourceUrls : [];
  const evidenceSources = Array.isArray(run.research?.selectedEvidence)
    ? run.research.selectedEvidence.filter((source) => source.articleUrl || source.sourceUrl)
    : [];
  const seen = new Set();
  return [...provenanceSources, ...evidenceSources].map((source) => ({
    title: source.sourceTitle || source.title || 'Original source',
    publisher: source.publisher || 'Source',
    publishedAt: source.publishedAt || '',
    url: source.sourceUrl || source.articleUrl || '',
  })).filter((source) => {
    if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function externalSourceList(sources = []) {
  if (!sources.length) return '<p>No original article URLs were attached.</p>';
  return `<ul class="source-list">${sources.map((source) => `<li><strong>${escapeHtml(source.publisher)}</strong>${source.publishedAt ? ` · ${escapeHtml(String(source.publishedAt).slice(0, 10))}` : ''}<br><a href="${escapeHtml(source.url)}" rel="noreferrer" target="_blank">${escapeHtml(source.title)} ↗</a><br><code>${escapeHtml(source.url)}</code></li>`).join('')}</ul>`;
}

function generationDiagnosticsHtml(diagnostics = {}) {
  if (!diagnostics || !Object.keys(diagnostics).length) return '<p>No generation diagnostics were recorded for this run.</p>';
  const selected = Array.isArray(diagnostics.brainRecordsSelected) ? diagnostics.brainRecordsSelected : [];
  const sent = Array.isArray(diagnostics.brainRecordsSentToModel) ? diagnostics.brainRecordsSentToModel : [];
  const claims = Array.isArray(diagnostics.relevantApprovedClaims) ? diagnostics.relevantApprovedClaims : [];
  const external = Array.isArray(diagnostics.externalArticleSourcesUsed) ? diagnostics.externalArticleSourcesUsed : [];
  const sizing = diagnostics.contextSize || {};
  const exact = diagnostics.exactBrainContextSentToModel || {};
  return [
    `<p><strong>Brain sources used:</strong> ${escapeHtml(selected.length)}</p>`,
    `<p><strong>Brain records retrieved:</strong> ${escapeHtml(diagnostics.brainSourcesScanned ?? diagnostics.brainRecordsRetrieved?.length ?? 0)}</p>`,
    `<p><strong>Brain records sent to model:</strong> ${escapeHtml(sent.length)}</p>`,
    `<p><strong>Context size:</strong> ${escapeHtml(sizing.totalPromptChars || 0)} prompt chars · ${escapeHtml(sizing.finalContextChars || 0)} context chars · ${sizing.truncated ? '<span class="pill warn">truncated</span>' : '<span class="pill good">not truncated</span>'}</p>`,
    selected.length ? `<details><summary class="ghost">Brain records selected</summary><ul class="source-list">${selected.map((record) => `<li><strong>${escapeHtml(record.title || record.id)}</strong><br><code>${escapeHtml(record.id || '')}</code><br><span class="muted">${escapeHtml(record.selectionReason || '')}</span></li>`).join('')}</ul></details>` : '',
    sent.length ? `<details><summary class="ghost">Brain records actually sent</summary><ul class="source-list">${sent.map((record) => `<li><strong>${escapeHtml(record.title || record.id)}</strong><br><code>${escapeHtml(record.id || '')}</code><br><span class="muted">${escapeHtml(record.path || '')}</span></li>`).join('')}</ul></details>` : '',
    claims.length ? `<details><summary class="ghost">Relevant approved claims</summary><ul class="source-list">${claims.map((claim) => `<li><strong>${escapeHtml(claim.title || claim.id)}</strong><br><code>${escapeHtml(claim.id || '')}</code><br>${escapeHtml(claim.excerpt || '')}</li>`).join('')}</ul></details>` : '',
    external.length ? `<details><summary class="ghost">External article sources used</summary><ul class="source-list">${external.map((source) => `<li><strong>${escapeHtml(source.publisher || 'Source')}</strong>${source.publishedAt ? ` · ${escapeHtml(source.publishedAt)}` : ''}<br>${escapeHtml(source.title || '')}${source.articleUrl ? `<br><a href="${escapeHtml(source.articleUrl)}" rel="noreferrer" target="_blank">${escapeHtml(source.articleUrl)}</a>` : ''}</li>`).join('')}</ul></details>` : '',
    exact.approvedKnowledge?.length ? `<details><summary class="ghost">Exact Brain context sent to Qwen</summary><ul class="source-list">${exact.approvedKnowledge.map((item) => `<li><strong>${escapeHtml(item.theme || 'Approved knowledge')}</strong><br><code>${escapeHtml(item.id || '')}</code><br>${escapeHtml(item.excerpt || '')}</li>`).join('')}</ul></details>` : '',
  ].filter(Boolean).join('');
}

async function renderFounderReview(ctx, runId, csrf) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const summary = run.summary || {};
  const claims = Array.isArray(run.claimLedger?.claims) ? run.claimLedger.claims : [];
  const brainEvidence = approvedBrainEvidence(run);
  const body = `<p class="eyebrow">Founder Review</p><h1>${escapeHtml(summary.title || 'Untitled article')}</h1><p class="notice">Approval requires founder permission, exact displayed version, zero blocking claims, approved Brain context and explicit confirmation. This approves version ${escapeHtml(summary.version || 'v1')} for Certifyd Blog publishing preparation.</p>${runSummaryHtml(summary)}${brainContextWarning(brainEvidence)}${card('Final Checklist', `<ul><li>Version: ${escapeHtml(summary.version || 'v1')}</li><li>Blocking claims: ${escapeHtml(summary.unresolvedIssueCount ?? 0)}</li><li>Approved Brain records: ${brainEvidence.length}</li><li>Canonical URL: ${escapeHtml(summary.canonicalUrl || 'Not set')}</li><li>Publishability: ${escapeHtml(humanizeLabel(summary.publishability || 'UNKNOWN'))}</li></ul>`)}${card('Approved Brain context', brainContextList(brainEvidence))}${card('Blocked or Qualified Claims', claimTable(claims.filter((claim) => claim.status !== 'APPROVED')))}${card('Article Preview', articlePreviewHtml(run))}${actionButtons(summary, csrf, ctx.permissions, ctx.config)}`;
  return layout({ title: 'Founder Review', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body });
}

function articleListCard(run, csrf, permissions, config = {}) {
  const runId = escapeHtml(run.runId);
  const title = escapeHtml(run.title || 'Untitled draft');
  const updated = escapeHtml(formatDashboardDate(run.lastUpdated || run.updatedAt || run.createdAt));
  const issueCount = Number(run.unresolvedIssueCount || 0);
  const canonical = run.canonicalUrl
    ? `<a href="${escapeHtml(run.canonicalUrl)}" class="article-card-url">${escapeHtml(run.canonicalUrl)}</a>`
    : '<span class="muted">No canonical URL yet</span>';
  const distribution = distributionSummary(run);
  return `<article class="article-card">
    <div class="article-card-main">
      <div class="article-card-kicker"><span>${escapeHtml(run.contentType || 'Article')}</span><span>${updated}</span><span>${escapeHtml(run.modelMode || run.modelProvider || 'Unknown provider')}</span></div>
      <h2><a href="/app/content/articles/${runId}">${title}</a></h2>
      <p class="muted article-card-slug">${escapeHtml(run.slug || run.runId || '')}</p>
      <div class="article-card-meta">
        ${statusPill(run.status)}
        ${statusPill(run.publishability)}
        <span class="pill ${issueCount > 0 ? 'bad' : 'good'}">${issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'Sources ready'}</span>
      </div>
      <div class="article-card-detail"><strong>Canonical</strong>${canonical}</div>
      <div class="article-card-detail"><strong>Distribution</strong><span>${escapeHtml(distribution)}</span></div>
    </div>
    <div class="article-card-actions">${articleRowActions(run, csrf, permissions, config)}</div>
  </article>`;
}

function distributionSummary(run) {
  const status = String(run.status || '').toUpperCase();
  const publishability = String(run.publishability || '').toUpperCase();
  if (status === 'PUBLISHED') return 'Live on Certifyd Blog.';
  if (publishability === 'READY_TO_PUBLISH') return 'Ready to publish to Certifyd Blog.';
  if (status === 'FOUNDER_APPROVED') return 'Approved; prepare package next.';
  if (status === 'ARCHIVED') return 'Archived; hidden from active publishing flow.';
  return 'Canonical first. Distribution generated after approval.';
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
  const changed = String(url.searchParams.get('changed') || '');
  const files = await ctx.brainRepo.listFiles();
  const canWriteBrain = ctx.permissions.includes('brain.write');
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
  const tabs = [['knowledge', 'Knowledge'], ['suggestions', 'Suggestions'], ['stale', 'Stale'], ['conflicts', 'Conflicts']];
  const tabHtml = `<div class="tabs">${tabs.map(([key, label]) => `<a class="tab ${key === view ? 'active' : ''}" href="/app/content/brain?view=${escapeHtml(key)}">${escapeHtml(label)}</a>`).join('')}</div>`;
  let content = '';
  if (view === 'suggestions') {
    const suggestions = await listPendingKnowledgeSuggestions(ctx.config);
    content = `<section class="panel"><div class="section-head"><div><p class="eyebrow">Knowledge Suggestions</p><h2>Founder-reviewed Brain updates.</h2></div></div><p>Qwen can suggest Brain changes, but approved knowledge is never updated automatically.</p><div class="review-list">${suggestions.length ? suggestions.map((suggestion) => knowledgeSuggestionRow(suggestion, canWriteBrain, csrf)).join('') : '<p class="empty">No pending Brain suggestions.</p>'}</div></section>`;
  } else if (view === 'stale') {
    content = `<section class="panel"><p class="empty">No stale Brain records are queued in this pass.</p></section>`;
  } else if (view === 'conflicts') {
    content = `<section class="panel"><p class="empty">No Brain conflicts are queued in this pass.</p></section>`;
  } else {
    const rows = files.map((file) => `<tr class="${file.id === changed ? 'highlight-row' : ''}"><td>${escapeHtml(file.name)}${file.id === changed ? ' <span class="pill good">Updated</span>' : ''}</td><td>${escapeHtml(humanizeLabel(file.classification))}</td><td>${escapeHtml(file.lastUpdated)}</td><td>${escapeHtml(file.evidenceUsageCount)}</td><td>${escapeHtml(humanizeLabel(file.staleStatus))}</td></tr>`).join('');
    const notice = changed ? `<p class="notice">Brain record updated: <code>${escapeHtml(changed)}</code>. Future Qwen generations can use this approved knowledge.</p>` : '';
    content = `${notice}<section class="panel"><form class="search-row"><label>Filter Brain records<input placeholder="Search by file, status or topic" disabled></label><button class="ghost" disabled>Search</button></form></section><section class="panel"><table class="table"><thead><tr><th>File</th><th>Classification</th><th>Updated</th><th>Usage</th><th>Review state</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No Brain records found.</td></tr>'}</tbody></table></section>`;
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
    ? ctx.config.githubPublishing.mode === 'direct'
      ? `GitHub publishing writes directly to ${ctx.config.githubPublishing.baseBranch}. Approved packages update the live site source without creating review branches.${ctx.config.githubPublishing.mirrors?.length ? ' Preview mirrors are updated after the primary write.' : ''}`
      : 'GitHub App publishing is enabled. Approved packages can create draft pull requests only; merging remains a separate human review step.'
    : 'GitHub App publishing is disabled. No live site publication occurs. Highest status is READY_TO_PUBLISH.';
  return layout({ title: 'Publishing', user: ctx.user, permissions: ctx.permissions, active: 'Blog Engine', body: `<p class="eyebrow">Publishing</p><h1>Blog package preparation</h1><p class="notice">${escapeHtml(notice)}</p>${runs.map((run) => card(run.title, runSummaryHtml(run) + actionButtons(run, csrf, ctx.permissions, ctx.config))).join('')}` });
}

async function renderDistribution(ctx, url) {
  const runs = await ctx.runRepo.listRuns();
  const overview = await ctx.actions.distributionOverview();
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
  const selectedRunId = String(url.searchParams.get('runId') || '');
  const canManage = ctx.permissions.includes('content.distribution.manage');
  const details = new Map();
  for (const run of runs) details.set(run.runId, await ctx.runRepo.readRun(run.runId).catch(() => null));
  const eligibleRuns = runs.filter((run) => ['FOUNDER_APPROVED', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED'].includes(String(run.status || '').toUpperCase()));
  const destinations = overview.destinations;
  const destinationRows = destinations.map((destination) => destinationChip(destination, csrf, canManage)).join('');
  const defaultForm = canManage ? `<form class="panel compact-panel" method="post" action="/app/content/actions/distribution/defaults"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><h2>Default destinations</h2><p class="muted">Defaults are not auto-published until the founder clicks Distribute for an article.</p><div class="destination-choice-grid">${destinations.filter((item) => item.id !== 'certifyd').map((item) => destinationCheckbox(item, overview.defaults?.destinations || [])).join('')}</div><button class="ghost" type="submit">Save default destinations</button></form>` : '';
  const articleRows = eligibleRuns.map((run) => distributionArticleRow(run, details.get(run.runId), destinations, overview.defaults?.destinations || [], csrf, canManage, selectedRunId === run.runId)).join('');
  return layout({
    title: 'Distribute',
    user: ctx.user,
    permissions: ctx.permissions,
    active: 'Distribution',
    body: `<p class="eyebrow">Distribute</p><h1>Publish once, distribute everywhere.</h1><p class="notice">Certifyd Blog remains canonical. Connected destinations only publish when a founder selects them or saves them as defaults and confirms distribution.</p><section class="panel compact-panel"><div class="section-head"><div><h2>Destinations</h2><p class="muted">Credentials stay server-side. No API keys or tokens are displayed.</p></div></div><div class="destination-chip-grid">${destinationRows}</div></section>${defaultForm}<section class="panel compact-panel"><div class="section-head"><div><h2>Articles</h2><p class="muted">Approved, publishing and published articles can be distributed.</p></div></div><div class="distribution-article-list">${articleRows || '<p class="empty panel">No approved or published articles are ready for distribution.</p>'}</div></section>`,
  });
}

function renderAnalytics(ctx) {
  const body = `<p class="eyebrow">Analytics</p><h1>Future analytics</h1><div class="grid">${['Search Console','Google Analytics','LinkedIn analytics','X analytics','Newsletter analytics'].map((name) => card(name, '<strong>Not connected</strong><p>Adapter contract exists; no live numbers are fabricated.</p>')).join('')}</div>`;
  return layout({ title: 'Analytics', user: ctx.user, permissions: ctx.permissions, active: 'Analytics', body });
}

async function renderSettings(ctx) {
  const trendSources = buildSourceRegistry(ctx.config);
  const distribution = await ctx.actions.distributionOverview();
  const csrf = createCsrfToken(ctx.config.sessionSecret, ctx.user.sid);
  const safe = { dashboardEnabled: ctx.config.enabled, authMode: ctx.config.authMode, publicAdminUrl: ctx.config.publicAdminUrl, database: ctx.config.databasePath === ':memory:' ? 'memory' : 'sqlite configured', userCount: ctx.userRepo.listUsers().length, localAi: { enabled: ctx.config.ollama.enabled, model: ctx.config.ollama.model, baseUrl: ctx.config.ollama.baseUrl ? 'configured' : 'not configured' }, trendResearch: ctx.config.trendResearchProvider || ctx.config.trendResearch?.provider || 'manual only', trendSourceCount: trendSources.filter((source) => source.enabled !== false).length, trendSources: trendSources.map((source) => ({ id: source.id, publisher: source.publisher, categories: source.categories || [], feedUrl: source.feedUrl, enabled: source.enabled !== false, reliability: source.reliability || '' })), trendScan: { maxItemsPerSource: ctx.config.trendResearch?.maxItemsPerSource, maxItemAgeDays: ctx.config.trendResearch?.maxItemAgeDays, timeoutMs: ctx.config.trendResearch?.timeoutMs, maxConcurrentFetches: ctx.config.trendResearch?.maxConcurrentFetches, dailyScanEnabled: ctx.config.trendResearch?.dailyScanEnabled, scanHour: ctx.config.trendResearch?.scanHour, manualCommand: 'npm run trends:scan' }, externalResearch: ctx.config.externalResearchProvider || 'not configured', brain: 'content-agent/knowledge', githubPublishing: publishingStatusLabel(ctx.config.githubPublishing), githubRepositoryConfigured: Boolean(ctx.config.githubPublishing.owner && ctx.config.githubPublishing.repo), githubMirrors: Array.isArray(ctx.config.githubPublishing.mirrors) ? ctx.config.githubPublishing.mirrors.map((mirror) => `${mirror.owner}/${mirror.repo}`).join(', ') : '', coverImages: ctx.config.coverImages?.provider === 'pexels' && ctx.config.coverImages?.pexelsApiKey ? 'Pexels configured' : 'local rule-based fallback', distributionAccounts: 'none connected', cloudflareAccessConfigured: Boolean(ctx.config.cloudflareAccess.teamDomain && ctx.config.cloudflareAccess.audience), environment: ctx.config.environmentName };
  const distributionAccounts = `<section class="panel"><h2>Distribution Accounts</h2><p>Use environment configuration until OAuth is implemented. Secrets are stored server-side only and never rendered.</p><div class="destination-chip-grid">${distribution.destinations.map((destination) => destinationChip(destination, csrf, true)).join('')}</div></section>`;
  return layout({ title: 'Settings', user: ctx.user, permissions: ctx.permissions, active: 'Settings', body: `<p class="eyebrow">Settings</p><h1>Configuration</h1><p>Secrets, tokens and raw session data are never displayed.</p><div class="grid">${['Local AI','Trend research','External research','Brain','GitHub publishing','Cover images','Distribution accounts','Access','Advanced diagnostics'].map((name) => card(name, `<p>${escapeHtml(settingsSummary(name, safe))}</p>`)).join('')}</div>${distributionAccounts}<section class="panel"><h2>Trend sources</h2><p>Trend scanning uses approved RSS/Atom sources. Search and social providers are placeholders until official integrations are configured.</p><div class="review-list">${safe.trendSources.map((source) => `<article class="review-item compact-row"><div><h3>${escapeHtml(source.publisher)}</h3><p>${escapeHtml((source.categories || []).join(', '))} · ${escapeHtml(source.feedUrl)}</p><p class="muted">${escapeHtml(source.reliability)}</p></div><span class="pill ${source.enabled ? 'good' : 'bad'}">${source.enabled ? 'Approved' : 'Disabled'}</span></article>`).join('') || '<p>No approved trend feeds configured.</p>'}</div></section><section id="advanced-diagnostics" class="panel"><h2>Advanced diagnostics</h2><pre>${escapeHtml(JSON.stringify(safe, null, 2))}</pre></section>` });
}

function articleMatchesView(run, view) {
  const status = String(run.status || '');
  const publishability = String(run.publishability || '');
  if (view === 'ideas') return false;
  if (view === 'drafts') return isDraftLikeStatus(status) || (!status && !run.canonicalUrl);
  if (view === 'review') return status === 'PENDING_FOUNDER_REVIEW';
  if (view === 'approved') return ['FOUNDER_APPROVED', 'READY_TO_PUBLISH'].includes(status);
  if (view === 'published') return isPublishedStatus(run);
  if (view === 'archived') return status === 'ARCHIVED';
  if (view === 'attention') return publishability.includes('BLOCKED') || Number(run.unresolvedIssueCount || 0) > 0;
  return true;
}

function isDraftLikeStatus(status) {
  return ['DRAFT', 'GENERATED', 'PENDING_FOUNDER_REVIEW'].includes(String(status || '').toUpperCase());
}

function isPublishedStatus(run) {
  const status = String(run?.status || '').toUpperCase();
  const publishability = String(run?.publishability || '').toUpperCase();
  return status === 'PUBLISHED' || (status === 'PUBLISHING' && publishability === 'PUBLISHING_DEPLOYMENT');
}

function actionResultLinks(result) {
  const runId = result?.runId ? String(result.runId) : '';
  if (!runId) return '';
  const encodedRunId = encodeURIComponent(runId);
  return `<div class="actions"><a class="primary" href="/app/content/articles/${encodedRunId}">Open generated draft</a><a class="ghost" href="/app/content/articles?view=drafts">View Drafts</a><a class="ghost" href="/app/content/articles?view=review">Review Queue</a></div>`;
}

function settingsSummary(name, safe) {
  const summaries = {
    'Local AI': safe.localAi.enabled ? `Qwen configured (${safe.localAi.model}).` : 'Qwen is unavailable until Ollama is configured.',
    'Trend research': ['seeded','fixture'].includes(safe.trendResearch) ? 'Seeded examples only. Use RSS or composite for source-backed scans.' : `${safe.trendResearch} configured with ${safe.trendSourceCount} approved source${safe.trendSourceCount === 1 ? '' : 's'}.`,
    'External research': safe.externalResearch === 'fixture' ? 'No live external research provider is connected.' : `${safe.externalResearch} configured.`,
    Brain: 'Approved Certifyd knowledge powers grounded drafts.',
    'GitHub publishing': safe.githubPublishing === 'disabled' ? 'Publishing is disabled.' : `${safe.githubPublishing} is configured.${safe.githubMirrors ? ` Mirror: ${safe.githubMirrors}.` : ''}`,
    'Cover images': safe.coverImages,
    'Distribution accounts': 'Connection state is shown below; credentials remain server-side.',
    Access: `${safe.authMode}; Cloudflare Access ${safe.cloudflareAccessConfigured ? 'configured' : 'not configured'}.`,
    'Advanced diagnostics': 'Safe, redacted configuration only.',
  };
  return summaries[name] || 'Not configured.';
}

function publishingStatusLabel(githubPublishing = {}) {
  if (!githubPublishing.enabled) return 'disabled';
  return githubPublishing.mode === 'direct' ? `direct to ${githubPublishing.baseBranch || 'base branch'}` : 'draft PRs enabled';
}

function runSummaryHtml(run) {
  return `<div class="article-meta-grid"><div><span>Status</span><strong>${statusPill(run.status)} ${statusPill(run.publishability)}</strong></div><div><span>Writing provider</span><strong>${escapeHtml(humanizeLabel(run.modelMode || run.modelProvider || 'Unknown'))}</strong></div><div><span>Issues</span><strong>${escapeHtml(run.unresolvedIssueCount ?? 0)}</strong></div><div><span>Version</span><strong>${escapeHtml(run.version || 'v1')}</strong></div></div><p class="canonical-line">Canonical: ${escapeHtml(run.canonicalUrl || 'Not set')}</p><p class="muted run-id-line">${escapeHtml(run.runId || '')}</p>`;
}

function articleRowActions(run, csrf, permissions, config = {}) {
  const runId = escapeHtml(run.runId);
  const links = [
    `<a class="ghost" href="/app/content/articles/${runId}">Open</a>`,
    `<a class="ghost" href="/app/content/articles/${runId}/preview">Preview</a>`,
  ];
  if (permissions.includes('content.article.review')) links.push(`<a class="ghost" href="/app/content/review/${runId}">Review</a>`);
  const status = String(run.status || '');
  if (permissions.includes('content.article.archive') && status !== 'ARCHIVED') {
    links.push(form('/app/content/actions/article/archive', 'Archive', { runId: run.runId, _csrf: csrf }));
  }
  return `<div class="actions compact-actions">${links.join('')}</div>`;
}

function actionButtons(run, csrf, permissions, config = {}) {
  const runId = run.runId;
  const version = run.version || 'v1';
  const status = String(run.status || '');
  const publishability = String(run.publishability || '');
  const hasCertifydBlogUrl = /^https:\/\/certifyd\.me\/blog\/[a-z0-9-]+\/$/.test(String(run.canonicalUrl || ''));
  const review = [];
  const publish = [];
  const live = [];
  const manage = [];
  if (permissions.includes('content.article.review')) {
    if (!['PENDING_FOUNDER_REVIEW', 'FOUNDER_APPROVED', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED'].includes(status)) review.push(form('/app/content/actions/review/start', 'Open Review', { runId, _csrf: csrf }));
    if (status === 'PENDING_FOUNDER_REVIEW') {
      review.push(form('/app/content/actions/review/revise', 'Request Revision', { runId, _csrf: csrf }));
      review.push(form('/app/content/actions/review/reject', 'Reject', { runId, note: 'Rejected from dashboard.', _csrf: csrf }, 'ghost danger'));
    }
  }
  if (permissions.includes('content.article.approve') && status === 'PENDING_FOUNDER_REVIEW') review.push(form('/app/content/actions/review/approve', 'Approve', { runId, version, confirm: 'true', _csrf: csrf }, 'primary'));
  if (permissions.includes('content.article.publish.prepare')) {
    if (status === 'FOUNDER_APPROVED') publish.push(form('/app/content/actions/publishing/prepare', 'Prepare Package', { runId, _csrf: csrf }));
    if (publishability === 'READY_TO_PUBLISH') {
      publish.push(form('/app/content/actions/publishing/validate', 'Validate', { runId, _csrf: csrf }));
      publish.push(form('/app/content/actions/publishing/pr', 'Publish to Certifyd', { runId, version, _csrf: csrf }, 'primary'));
      if (!config.githubPublishing?.enabled) publish.push('<span class="muted">GitHub publishing is disabled in Settings.</span>');
    }
    if (config.githubPublishing?.mode === 'direct' && ['PUBLISHING', 'PUBLISHED'].includes(status)) {
      publish.push(form('/app/content/actions/publishing/republish', 'Republish to Certifyd', { runId, version, _csrf: csrf }, 'primary'));
    }
    if (status === 'PUBLISHING') publish.push(form('/app/content/actions/publishing/verify-live', 'Verify Live', { runId, _csrf: csrf }, 'primary'));
    if (status === 'UNPUBLISHING') publish.push(form('/app/content/actions/publishing/verify-unpublished', 'Verify Removed', { runId, _csrf: csrf }, 'primary'));
    if (['FOUNDER_APPROVED', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED'].includes(status)) publish.push(`<a class="ghost" href="/app/content/distribution?runId=${encodeURIComponent(runId)}">Distribute</a>`);
    if (hasCertifydBlogUrl && !['ARCHIVED', 'UNPUBLISHING'].includes(status) && publishability !== 'REMOVED_FROM_LIVE_SITE') {
      live.push(`<a class="primary" href="${escapeHtml(run.canonicalUrl)}">View Live</a>`);
      live.push(`<form class="confirm-action" method="post" action="/app/content/actions/publishing/unpublish"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label for="confirm-unpublish-${escapeHtml(runId)}">Type unpublish</label><input id="confirm-unpublish-${escapeHtml(runId)}" name="confirmUnpublish" placeholder="unpublish" autocomplete="off"><button class="ghost danger" type="submit">Unpublish</button></form>`);
    }
  }
  manage.push(...compactLifecycleForms(run, csrf, permissions, config));
  const groups = [
    actionGroup('Review', review),
    actionGroup('Publish', publish),
    actionGroup('Live Site', live),
    actionGroup('Manage', manage),
  ].filter(Boolean).join('');
  return groups ? `<section class="action-panel">${groups}</section>` : '';
}

function compactLifecycleForms(run, csrf, permissions) {
  const forms = [];
  const runId = run.runId;
  const status = String(run.status || '');
  if (permissions.includes('content.article.archive') && status !== 'ARCHIVED') {
    forms.push(form('/app/content/actions/article/archive', 'Archive', { runId, _csrf: csrf }));
  }
  if (permissions.includes('content.article.delete') && !['PUBLISHED', 'PUBLISHING', 'ARCHIVED'].includes(status)) {
    forms.push(`<form class="confirm-action" method="post" action="/app/content/actions/article/delete-draft"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label for="confirm-delete-${escapeHtml(runId)}">Type delete</label><input id="confirm-delete-${escapeHtml(runId)}" name="confirmDelete" placeholder="delete" autocomplete="off"><button class="ghost danger" type="submit">Delete Draft</button></form>`);
  }
  return forms.join('');
}

function actionGroup(title, items) {
  const cleanItems = items.filter(Boolean);
  if (!cleanItems.length) return '';
  return `<div class="action-group"><h3>${escapeHtml(title)}</h3><div class="action-row">${cleanItems.join('')}</div></div>`;
}

function form(action, label, fields, className = 'ghost') {
  return `<form method="post" action="${action}">${Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('')}<button class="${className}" type="submit">${escapeHtml(label)}</button></form>`;
}

function claimTable(claims) {
  if (!claims.length) return '<p>No claims found.</p>';
  return `<table class="table"><thead><tr><th>Claim</th><th>Status</th><th>Classification</th><th>Note</th></tr></thead><tbody>${claims.map((claim) => `<tr><td>${escapeHtml(claim.text || claim.claim || '')}</td><td>${statusPill(claim.status)}</td><td>${escapeHtml(claim.classification || '')}</td><td>${escapeHtml(claim.reviewerNote || claim.requiredQualification || claim.blockingReason || '')}</td></tr>`).join('')}</tbody></table>`;
}

function brainContextWarning(records) {
  if (records.length) return '';
  return '<div class="notice danger"><strong>Approved Brain context required.</strong><p>This draft cannot be approved or published until it is regenerated or revised with relevant approved Brain records.</p></div>';
}

function brainContextList(records) {
  if (!records.length) {
    return '<p class="notice danger">No approved Brain records were attached to this draft.</p>';
  }
  return `<ol class="source-list">${records.map((record) => `<li><strong>${escapeHtml(record.title || record.id || 'Brain record')}</strong><p><code>${escapeHtml(record.path || record.id || '')}</code></p>${record.excerpt ? `<p class="muted">${escapeHtml(String(record.excerpt).slice(0, 260))}</p>` : ''}</li>`).join('')}</ol>`;
}

function distributionList(assets, plan = {}) {
  const primary = plan?.primaryTarget
    ? `<div class="notice"><strong>${escapeHtml(plan.primaryTarget.channel || 'Certifyd Blog')}</strong><p>${escapeHtml(plan.primaryTarget.url || '')}</p><p>Repository path: ${escapeHtml(plan.primaryTarget.repositoryPath || '')}</p></div>`
    : '<div class="notice"><strong>Certifyd Blog</strong><p>Prepare publishing to create the canonical blog package for <code>https://certifyd.me/blog/[slug]/</code>.</p></div>';
  if (!assets?.length) return `${primary}<p>No distribution assets found.</p>`;
  return `${primary}${assets.map((asset) => `<details><summary>${escapeHtml(asset.channel)} · ${escapeHtml(asset.status || 'DRAFT')}</summary><pre>${escapeHtml(asset.body)}</pre></details>`).join('')}`;
}

function destinationChip(destination, csrf, canManage) {
  const css = destination.status === 'connected' ? 'good' : destination.status === 'manual_export' ? 'warn' : destination.status === 'connection_error' ? 'bad' : '';
  const controls = canManage
    ? `<form method="post" action="/app/content/actions/distribution/test"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="destinationId" value="${escapeHtml(destination.id)}"><button class="ghost small-button" type="submit">Test connection</button></form><button class="ghost small-button" type="button" disabled>${destination.status === 'connected' ? 'Disconnect' : 'Connect'}</button>`
    : '';
  return `<article class="destination-chip"><div><strong>${escapeHtml(destination.displayName)}</strong><p>${statusPill(destination.label)} <span class="muted">${escapeHtml(destination.message || '')}</span></p></div><div class="mini-actions">${controls}</div></article>`;
}

function distributionArticleRow(run, detail, destinations, defaults, csrf, canManage, open) {
  const state = detail?.distribution?.destinations?.destinations || {};
  const publishedCount = Object.values(state).filter((item) => item?.status === 'published').length;
  const choices = destinations.map((destination) => destinationCheckbox(destination, destination.id === 'certifyd' ? ['certifyd'] : defaults, state[destination.id])).join('');
  const statusRows = destinations.map((destination) => destinationStatusRow(destination, state[destination.id])).join('');
  const disabled = canManage ? '' : 'disabled';
  const actions = canManage ? `<div class="actions"><button class="primary" type="submit">Publish to selected destinations now</button><button class="ghost" type="submit" formaction="/app/content/actions/distribution/retry">Retry failed destinations</button></div>` : '<p class="notice">This role can view distribution, but cannot publish destinations.</p>';
  return `<article class="distribution-row"><div><h3>${escapeHtml(run.title || 'Untitled article')}</h3><p>${statusPill(run.status)} <span class="muted">${escapeHtml(String(publishedCount))} destination${publishedCount === 1 ? '' : 's'} published · ${escapeHtml(run.canonicalUrl || 'No canonical URL')}</span></p></div><details ${open ? 'open' : ''}><summary class="primary">Distribute</summary><form method="post" action="/app/content/actions/distribution/publish"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="runId" value="${escapeHtml(run.runId)}"><input type="hidden" name="version" value="${escapeHtml(run.version || 'v1')}"><h4>Distribute article</h4><p class="muted">Certifyd Blog is canonical. Social destinations require founder approval here before posting.</p><div class="destination-choice-grid">${choices}</div>${actions}</form><div class="distribution-status-list">${statusRows}</div></details></article>`;
}

function destinationCheckbox(destination, selected = [], state = {}) {
  const checked = selected.includes(destination.id) ? 'checked' : '';
  const autoDisconnected = destination.automatic && !destination.manual && destination.status !== 'connected';
  const disabled = destination.id === 'certifyd' ? '' : autoDisconnected ? 'disabled' : '';
  const hint = state?.lastError ? state.lastError : destination.status === 'not_connected' ? 'Not connected' : destination.status === 'manual_export' ? 'Manual export' : destination.label;
  return `<label class="destination-choice ${disabled ? 'muted' : ''}"><input type="checkbox" name="destinations" value="${escapeHtml(destination.id)}" ${checked} ${disabled}> <span><strong>${escapeHtml(destination.displayName)}</strong><small>${escapeHtml(hint || '')}</small></span></label>`;
}

function destinationStatusRow(destination, state = {}) {
  const status = state?.status || 'not_selected';
  const url = state?.externalUrl ? ` · <a href="${escapeHtml(state.externalUrl)}" rel="noreferrer" target="_blank">Open</a>` : '';
  const error = state?.lastError ? ` · ${escapeHtml(state.lastError)}` : '';
  return `<p class="distribution-status-row"><strong>${escapeHtml(destination.displayName)}</strong>: ${statusPill(status)}${url}${error}</p>`;
}

function coverImageControls(run, csrf, permissions, config = {}) {
  const canEdit = permissions.includes('content.article.edit');
  const runId = run.summary?.runId || run.runId || '';
  const coverImage = run.blogPackage?.coverImage || run.manifest?.coverImage || '';
  const provider = run.blogPackage?.coverImageProvider || '';
  const credit = run.blogPackage?.coverImageCredit || '';
  const creditUrl = run.blogPackage?.coverImageCreditUrl || '';
  const query = run.blogPackage?.coverImageQuery || '';
  const autoLabel = config.coverImages?.provider === 'pexels' && config.coverImages?.pexelsApiKey
    ? (provider === 'pexels' ? 'Find Different Pexels Cover' : 'Use Pexels Auto Cover')
    : 'Use Auto Cover';
  const details = [
    provider ? `Provider: ${escapeHtml(provider)}` : '',
    query ? `Query: ${escapeHtml(query)}` : '',
    credit ? `Credit: ${creditUrl ? `<a href="${escapeHtml(creditUrl)}">${escapeHtml(credit)}</a>` : escapeHtml(credit)}` : '',
  ].filter(Boolean).map((line) => `<p class="muted">${line}</p>`).join('');
  const preview = coverImage
    ? `<div class="article-hero-image"><img src="${escapeHtml(coverImage)}" alt="" loading="lazy" decoding="async"></div><p class="muted">${escapeHtml(coverImage)}</p>${details}`
    : '<p class="muted">No custom cover selected. Publishing will choose one automatically.</p>';
  if (!canEdit) return preview;
  return `${preview}<div class="cover-actions"><form class="upload-row" method="post" action="/app/content/actions/publishing/cover-upload" enctype="multipart/form-data"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><label>Upload image<input name="coverUpload" type="file" accept="image/jpeg,image/png,image/webp" required></label><button class="primary" type="submit">Upload Cover</button></form><form method="post" action="/app/content/actions/publishing/cover"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="mode" value="auto"><button class="ghost" type="submit">${escapeHtml(autoLabel)}</button></form><details class="advanced-cover"><summary>Advanced: use existing image path</summary><form class="search-row" method="post" action="/app/content/actions/publishing/cover"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="mode" value="manual"><label>Existing /images path<input name="coverImage" value="${escapeHtml(coverImage)}" placeholder="/images/blog/example.jpg"></label><button class="ghost" type="submit">Set Path</button></form></details></div>`;
}

function articleEditor(run, csrf, permissions) {
  const markdown = run.articleMarkdown || run.draftMarkdown || '';
  if (!permissions.includes('content.article.edit')) {
    return `<p class="muted">This role can view but not edit article Markdown.</p><pre>${escapeHtml(markdown)}</pre>`;
  }
  const runId = run.summary?.runId || run.runId || '';
  return `<form class="article-editor-form" method="post" action="/app/content/actions/article/save"><input type="hidden" name="runId" value="${escapeHtml(runId)}"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><p class="muted">Edit the canonical draft Markdown. Saving updates the preview, publishing package source, and republish source.</p><textarea name="articleMarkdown" rows="20" spellcheck="true">${escapeHtml(markdown)}</textarea><div class="actions"><button class="primary" type="submit">Save Article</button></div></form>`;
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
  const body = Buffer.concat(chunks);
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.toLowerCase().startsWith('multipart/form-data')) return parseMultipartForm(body, contentType);
  return formAdapter(new URLSearchParams(body.toString('utf8')), new Map());
}

function formAdapter(fields, files) {
  return {
    get(name) {
      return fields.get(name);
    },
    getAll(name) {
      return fields.getAll(name);
    },
    getFile(name) {
      return files.get(name) || null;
    },
  };
}

function parseMultipartForm(body, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2] || '';
  if (!boundary) throw Object.assign(new Error('Invalid multipart form boundary.'), { statusCode: 400 });
  const fields = new URLSearchParams();
  const files = new Map();
  const delimiter = Buffer.from(`--${boundary}`);
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    position += delimiter.length;
    if (body.slice(position, position + 2).toString() === '--') break;
    if (body.slice(position, position + 2).toString() === '\r\n') position += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), position);
    if (headerEnd === -1) break;
    const headerText = body.slice(position, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next === -1) break;
    let partBody = body.slice(headerEnd + 4, next);
    if (partBody.slice(-2).toString() === '\r\n') partBody = partBody.slice(0, -2);
    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || '';
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
    const partContentType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
    if (name && filename) {
      files.set(name, {
        filename,
        contentType: partContentType,
        buffer: partBody,
      });
    } else if (name) {
      fields.set(name, partBody.toString('utf8'));
    }
    position = next;
  }
  return formAdapter(fields, files);
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
  const message = status < 500 || status === 503 || error.expose ? error.message : 'Internal server error';
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}
