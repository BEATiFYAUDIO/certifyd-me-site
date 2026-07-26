import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDashboardConfig, permissionsForRole } from './config.js';
import { ContentRunRepository, ContentBrainRepository } from './repository.js';
import { ContentDashboardActions, AuditLogRepository } from './actions.js';
import { createCsrfToken, escapeHtml, parseCookies, safeReturnPath, validateRunId, verifyCsrf, verifySession, signSession } from './security.js';
import { card, layout, loginPage, renderMarkdown, statusPill } from './render.js';
import { verifyCloudflareAccessRequest } from './cloudflare-access.js';
import { DashboardUserRepository } from './users.js';

const STATIC_TYPES = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.xml','application/xml; charset=utf-8'],['.txt','text/plain; charset=utf-8'],['.mp4','video/mp4']]);

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
  const form = await readForm(req);
  if (!verifyCsrf(ctx.config.sessionSecret, ctx.user.sid, String(form.get('_csrf') || ''))) return sendStatus(res, 403, 'CSRF validation failed');
  const action = url.pathname;
  const needs = (permission) => {
    if (!ctx.permissions.includes(permission)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  };
  let result;
  if (action.endsWith('/generate')) { needs('content.article.create'); validateIntake(form); result = await ctx.actions.generateDeterministic({ actor: ctx.user }); }
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
  if (pathName === '/app/content' || pathName === '/app/content/') { allow('content.dashboard.view'); return sendHtml(res, await renderOverview(ctx, csrf)); }
  if (pathName === '/app/content/articles') { allow('content.article.view'); return sendHtml(res, await renderArticles(ctx)); }
  if (pathName === '/app/content/brain') { allow('brain.read'); return sendHtml(res, await renderBrain(ctx)); }
  if (pathName === '/app/content/topics') { allow('content.article.view'); return sendHtml(res, await renderTopics(ctx)); }
  if (pathName === '/app/content/publishing') { allow('content.publishing.view'); return sendHtml(res, await renderPublishing(ctx, csrf)); }
  if (pathName === '/app/content/distribution') { allow('content.distribution.view'); return sendHtml(res, await renderDistribution(ctx)); }
  if (pathName === '/app/content/analytics') { allow('content.analytics.view'); return sendHtml(res, renderAnalytics(ctx)); }
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
  const pending = runs.filter((run) => run.status === 'PENDING_FOUNDER_REVIEW').length;
  const blocked = runs.filter((run) => run.publishability?.includes('BLOCKED')).length;
  const latest = runs[0];
  const publishingMode = ctx.config.githubPublishing.enabled ? 'GitHub draft PR adapter' : 'Local package only';
  const body = `<section class="hero"><p class="eyebrow">Internal operations</p><h1>Certifyd Content Dashboard</h1><p>Private dashboard for article generation, founder review, publishing preparation, distribution assets, Brain visibility and future analytics.</p></section><div class="grid">${card('Awaiting Founder Review', `<strong>${pending}</strong><p>Articles awaiting review.</p>`)}${card('Blocked Packages', `<strong>${blocked}</strong><p>Packages blocked before publishing preparation.</p>`)}${card('Model Provider', `<strong>${escapeHtml(ctx.config.modelProvider)}</strong><p>${ctx.config.modelConfigured ? 'Configured' : 'Live model not configured. Deterministic fallback is labelled explicitly.'}</p>`)}${card('Publishing Adapter', `<strong>${escapeHtml(publishingMode)}</strong><p>${ctx.config.githubPublishing.enabled ? 'Approved packages can be proposed through draft pull requests.' : 'No live GitHub publishing adapter is enabled.'}</p>`)}</div>${latest ? card('Latest Engine Run', runSummaryHtml(latest) + actionButtons(latest.runId, latest.version, csrf, ctx.permissions, ctx.config)) : card('Latest Engine Run', '<p>No runs found.</p>')}`;
  return layout({ title: 'Overview', user: ctx.user, permissions: ctx.permissions, active: 'Overview', body });
}

async function renderArticles(ctx) {
  const runs = await ctx.runRepo.listRuns();
  const rows = runs.map((run) => `<tr><td><a href="/app/content/articles/${escapeHtml(run.runId)}"><strong>${escapeHtml(run.title)}</strong></a><br><span class="muted">${escapeHtml(run.runId)}</span></td><td>${escapeHtml(run.version)}</td><td>${statusPill(run.status)}</td><td>${statusPill(run.publishability)}</td><td>${escapeHtml(run.audience)}</td><td>${escapeHtml(run.topic)}</td><td>${escapeHtml(run.modelMode)}</td><td>${escapeHtml(run.unresolvedIssueCount)}</td></tr>`).join('');
  const filters = card('Filters', '<p>Status, topic, audience, model provider, unresolved issues and publishability filters are UI-ready. Current local implementation lists all runs without fabricated filter counts.</p>');
  const create = ctx.permissions.includes('content.article.create') ? card('Create Article', `<p>Create flow is restricted to validated intake. This local pass generates from the approved Core fixture only.</p><form class="intake" method="post" action="/app/content/actions/generate"><input type="hidden" name="_csrf" value="CSRF_PLACEHOLDER"><label>Working title<input name="workingTitle" required maxlength="160" value="What Certifyd Core Is"></label><label>Core question<input name="coreQuestion" required maxlength="240" value="What is Certifyd Core?"></label><label>Target audience<input name="targetAudience" required maxlength="120" value="Creators, partners and investors"></label><label>Business objective<input name="businessObjective" required maxlength="240" value="Explain Certifyd Core without overstating current capabilities."></label><label>Content type<select name="contentType"><option>article</option><option>brief</option><option>explainer</option></select></label><label>Primary topic<input name="primaryTopic" required maxlength="120" value="Certifyd Core"></label><label>Desired channels<input name="desiredChannels" maxlength="160" value="Blog, LinkedIn, X, newsletter"></label><label>Model mode<select name="modelMode"><option>deterministic</option></select></label><label>Source restrictions<textarea name="sourceRestrictions" maxlength="500">Use Certifyd Brain and approved public claims only.</textarea></label><label>Notes<textarea name="notes" maxlength="1000">Local dashboard Phase 3 validation pass.</textarea></label><button class="primary">Create Deterministic Draft</button></form>`).replace('CSRF_PLACEHOLDER', createCsrfToken(ctx.config.sessionSecret, ctx.user.sid)) : '';
  return layout({ title: 'Articles', user: ctx.user, permissions: ctx.permissions, active: 'Articles', body: `<p class="eyebrow">Articles</p><h1>Content runs</h1>${filters}${create}<section class="panel"><table class="table"><thead><tr><th>Title</th><th>Version</th><th>Status</th><th>Publishability</th><th>Audience</th><th>Topic</th><th>Model</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table></section>` });
}

async function renderArticle(ctx, runId, csrf) {
  validateRunId(runId);
  const run = await ctx.runRepo.readRun(runId);
  const claims = Array.isArray(run.claimLedger.claims) ? run.claimLedger.claims : [];
  const body = `<p class="eyebrow">Article Workspace</p><h1>${escapeHtml(run.summary.title)}</h1>${runSummaryHtml(run.summary)}${actionButtons(runId, run.summary.version, csrf, ctx.permissions, ctx.config)}<div class="grid">${card('Overview', `<p>Canonical: ${escapeHtml(run.summary.canonicalUrl)}</p><p>Claims: ${claims.length}</p><p>Unresolved blockers: ${run.summary.unresolvedIssueCount}</p>`)}${card('Research', `<p>Brain evidence and external research are separated. External research may inform audience/search context only.</p><pre>${escapeHtml(JSON.stringify({ brain: run.research.evidence?.length || 0, external: run.externalResearch.items?.length || 0 }, null, 2))}</pre>`)}${card('SEO', `<pre>${escapeHtml(JSON.stringify(run.seo, null, 2))}</pre>`)}${card('Versions', run.versions.map((item) => `<p>${escapeHtml(item.version)}</p>`).join('') || '<p>No versions found.</p>')}</div>${card('Article Preview', `<article class="article">${renderMarkdown(run.articleMarkdown)}</article>`)}${card('Claims', claimTable(claims))}${card('Distribution', distributionList(run.distribution.assets))}${card('Manifest', `<pre>${escapeHtml(JSON.stringify(run.manifest, null, 2))}</pre>`)}`;
  return layout({ title: run.summary.title, user: ctx.user, permissions: ctx.permissions, active: 'Articles', body });
}

async function renderFounderReview(ctx, runId, csrf) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const claims = Array.isArray(run.claimLedger.claims) ? run.claimLedger.claims : [];
  const body = `<p class="eyebrow">Founder Review</p><h1>${escapeHtml(run.summary.title)}</h1><p class="notice">Approval requires founder permission, exact displayed version, zero blocking claims and explicit confirmation. This approves version ${escapeHtml(run.summary.version)} for Certifyd Blog publishing preparation.</p>${runSummaryHtml(run.summary)}${card('Final Checklist', `<ul><li>Version: ${escapeHtml(run.summary.version)}</li><li>Blocking claims: ${run.summary.unresolvedIssueCount}</li><li>Canonical URL: ${escapeHtml(run.summary.canonicalUrl)}</li><li>Publishability: ${escapeHtml(run.summary.publishability)}</li></ul>`)}${card('Blocked or Qualified Claims', claimTable(claims.filter((claim) => claim.status !== 'APPROVED')))}${card('Article Preview', `<article class="article">${renderMarkdown(run.articleMarkdown)}</article>`)}${actionButtons(runId, run.summary.version, csrf, ctx.permissions, ctx.config)}`;
  return layout({ title: 'Founder Review', user: ctx.user, permissions: ctx.permissions, active: 'Review Queue', body });
}

async function renderPreview(ctx, runId) {
  const run = await ctx.runRepo.readRun(validateRunId(runId));
  const pkg = run.blogPackage;
  const body = `<p class="eyebrow">Internal preview — not published</p><h1>${escapeHtml(pkg.title || run.summary.title)}</h1><p>${escapeHtml(pkg.description || '')}</p><div class="panel"><p><strong>Author:</strong> ${escapeHtml(pkg.author || 'Certifyd')}</p><p><strong>Canonical:</strong> ${escapeHtml(run.summary.canonicalUrl)}</p><p><strong>Structured metadata:</strong> ${pkg.structuredData ? 'Available' : 'Missing'}</p></div><article class="panel article">${renderMarkdown(run.articleMarkdown)}</article>`;
  return layout({ title: 'Preview', user: ctx.user, permissions: ctx.permissions, active: 'Articles', body });
}

async function renderBrain(ctx) {
  const files = await ctx.brainRepo.listFiles();
  const rows = files.map((file) => `<tr><td>${escapeHtml(file.name)}</td><td>${escapeHtml(file.classification)}</td><td>${escapeHtml(file.lastUpdated)}</td><td>${escapeHtml(file.evidenceUsageCount)}</td><td>${escapeHtml(file.staleStatus)}</td></tr>`).join('');
  return layout({ title: 'Brain', user: ctx.user, permissions: ctx.permissions, active: 'Brain', body: `<p class="eyebrow">Brain</p><h1>Knowledge visibility</h1><p>Read-first interface. Raw Brain editing is intentionally not enabled in this pass.</p><section class="panel"><table class="table"><thead><tr><th>File</th><th>Classification</th><th>Updated</th><th>Usage</th><th>Stale</th></tr></thead><tbody>${rows}</tbody></table></section>` });
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
  return layout({ title: 'Publishing', user: ctx.user, permissions: ctx.permissions, active: 'Publishing', body: `<p class="eyebrow">Publishing</p><h1>Blog package preparation</h1><p class="notice">${escapeHtml(notice)}</p>${runs.map((run) => card(run.title, runSummaryHtml(run) + actionButtons(run.runId, run.version, csrf, ctx.permissions, ctx.config))).join('')}` });
}

async function renderDistribution(ctx) {
  const runs = await ctx.runRepo.listRuns();
  const blocks = [];
  for (const run of runs) {
    const detail = await ctx.runRepo.readRun(run.runId);
    blocks.push(card(run.title, distributionList(detail.distribution.assets)));
  }
  return layout({ title: 'Distribution', user: ctx.user, permissions: ctx.permissions, active: 'Distribution', body: `<p class="eyebrow">Distribution</p><h1>Distribution assets</h1><p>No social APIs are connected. Assets remain draft unless imported from trusted historical state.</p>${blocks.join('')}` });
}

function renderAnalytics(ctx) {
  const body = `<p class="eyebrow">Analytics</p><h1>Future analytics</h1><div class="grid">${['Search Console','Google Analytics','LinkedIn analytics','X analytics','Newsletter analytics'].map((name) => card(name, '<strong>Not connected</strong><p>Adapter contract exists; no live numbers are fabricated.</p>')).join('')}</div>`;
  return layout({ title: 'Analytics', user: ctx.user, permissions: ctx.permissions, active: 'Analytics', body });
}

function renderSettings(ctx) {
  const safe = { dashboardEnabled: ctx.config.enabled, authMode: ctx.config.authMode, publicAdminUrl: ctx.config.publicAdminUrl, database: ctx.config.databasePath === ':memory:' ? 'memory' : 'sqlite configured', userCount: ctx.userRepo.listUsers().length, modelProvider: ctx.config.modelProvider, modelConfigured: ctx.config.modelConfigured, externalResearchProvider: ctx.config.externalResearchProvider, publishingAdapter: ctx.config.githubPublishing.enabled ? 'github draft pull requests' : 'disabled', githubRepositoryConfigured: Boolean(ctx.config.githubPublishing.owner && ctx.config.githubPublishing.repo), cloudflareAccessConfigured: Boolean(ctx.config.cloudflareAccess.teamDomain && ctx.config.cloudflareAccess.audience), storageAdapter: 'local filesystem', outputDirectory: 'content-agent/engine/outputs', environment: ctx.config.environmentName };
  return layout({ title: 'Settings', user: ctx.user, permissions: ctx.permissions, active: 'Settings', body: `<p class="eyebrow">Settings</p><h1>Safe configuration</h1><p>Secrets, tokens and raw session data are never displayed.</p><section class="panel"><pre>${escapeHtml(JSON.stringify(safe, null, 2))}</pre></section>` });
}

function runSummaryHtml(run) {
  return `<div class="grid"><div><h3>${escapeHtml(run.title)}</h3><p>${escapeHtml(run.runId)} · ${escapeHtml(run.version)}</p></div><div>${statusPill(run.status)} ${statusPill(run.publishability)}</div><div><strong>${escapeHtml(run.modelMode)}</strong><p>${escapeHtml(run.modelProvider)}</p></div><div><strong>${escapeHtml(run.unresolvedIssueCount)}</strong><p>Unresolved issue count</p></div></div><p>Canonical: ${escapeHtml(run.canonicalUrl)}</p>`;
}

function actionButtons(runId, version, csrf, permissions, config = {}) {
  const forms = [];
  if (permissions.includes('content.article.review')) forms.push(form('/app/content/actions/review/start', 'Start Review', { runId, _csrf: csrf }), form('/app/content/actions/review/revise', 'Request Revision', { runId, _csrf: csrf }), form('/app/content/actions/review/reject', 'Reject', { runId, note: 'Rejected from dashboard.', _csrf: csrf }));
  if (permissions.includes('content.article.approve')) forms.push(form('/app/content/actions/review/approve', 'Approve Exact Version', { runId, version, confirm: 'true', _csrf: csrf }, 'primary'));
  if (permissions.includes('content.article.publish.prepare')) {
    forms.push(form('/app/content/actions/publishing/prepare', 'Prepare Blog Package', { runId, _csrf: csrf }), form('/app/content/actions/publishing/validate', 'Validate Blog Package', { runId, _csrf: csrf }));
    if (config.githubPublishing?.enabled) forms.push(form('/app/content/actions/publishing/pr', 'Create Draft PR', { runId, _csrf: csrf }, 'primary'));
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
  const requiredFields = ['workingTitle', 'coreQuestion', 'targetAudience', 'businessObjective', 'contentType', 'primaryTopic', 'modelMode'];
  for (const field of requiredFields) {
    const value = String(form.get(field) || '').trim();
    if (!value) throw Object.assign(new Error(`Missing required intake field: ${field}`), { statusCode: 400 });
    if (value.length > 300) throw Object.assign(new Error(`Intake field is too long: ${field}`), { statusCode: 400 });
  }
  const contentType = String(form.get('contentType') || '');
  const modelMode = String(form.get('modelMode') || '');
  if (!['article', 'brief', 'explainer'].includes(contentType)) throw Object.assign(new Error('Invalid content type.'), { statusCode: 400 });
  if (modelMode !== 'deterministic') throw Object.assign(new Error('Live model generation is not connected in the dashboard yet.'), { statusCode: 400 });
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
