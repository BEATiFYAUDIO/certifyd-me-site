import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateRunId, validateVersion } from './security.js';
import { ContentRunRepository } from './repository.js';
import { createPublisher } from './publisher.js';
import { buildGroundedContext, createGenerationProvider, normalizeProviderName, persistGeneratedArticleRun } from './generation-provider.js';

const execFileAsync = promisify(execFile);
const RESULT_LIMIT = 12000;

export class AuditLogRepository {
  constructor(config) {
    this.file = path.join(config.agentRoot, 'review', 'dashboard-audit.log.jsonl');
  }

  async append(record) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const safeRecord = {
      action: record.action,
      actorUserId: record.actorUserId || '',
      actorDisplayName: record.actorDisplayName || '',
      actorRole: record.actorRole || '',
      runId: record.runId || '',
      version: record.version || '',
      timestamp: new Date().toISOString(),
      result: record.result || 'UNKNOWN',
      note: record.note || '',
      requestId: record.requestId || cryptoRandomId(),
    };
    await fs.appendFile(this.file, `${JSON.stringify(safeRecord)}\n`, 'utf8');
  }
}

export class ContentDashboardActions {
  constructor(config) {
    this.config = config;
    this.runs = new ContentRunRepository(config);
    this.audit = new AuditLogRepository(config);
    this.publisher = createPublisher(config, this.runs);
  }

  async generateDraft({ actor, form, signal }) {
    const providerName = normalizeProviderName(form.get('provider') || 'deterministic');
    const input = {
      actorUserId: actor.id,
      actorEmail: actor.email,
      topic: cleanString(form.get('topic') || form.get('workingTitle'), 160),
      audience: cleanString(form.get('audience') || form.get('targetAudience'), 160),
      objective: cleanString(form.get('objective') || form.get('businessObjective'), 360),
      writingStyle: cleanString(form.get('writingStyle'), 240),
      sourceRestrictions: cleanString(form.get('sourceRestrictions'), 800),
      contentType: cleanString(form.get('contentType') || 'article', 80),
      channel: cleanString(form.get('channel') || 'Blog', 80),
    };
    if (!input.topic || !input.audience || !input.objective) {
      throw Object.assign(new Error('Topic, audience and objective are required.'), { statusCode: 400 });
    }
    const provider = createGenerationProvider(this.config, { provider: providerName });
    const groundedContext = await buildGroundedContext(this.config, input);
    try {
      const article = await provider.generateArticle(input, groundedContext, signal);
      const result = await persistGeneratedArticleRun(this.config, article, input, groundedContext, provider);
      await this.audit.append({ action: 'article_generation', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId: result.runId, result: 'SUCCESS', note: `${provider.providerName}:${provider.modelName}` });
      return result;
    } catch (error) {
      await this.audit.append({ action: 'article_generation', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, result: 'FAILED', note: `${provider.providerName}:${safeError(error)}` });
      throw error;
    }
  }

  async generateDeterministic({ actor, inputPath = 'engine/fixtures/core-article-request.json' }) {
    this.assertSafeRelativeInput(inputPath);
    return this.runEngine(actor, 'article_generation_legacy', ['content:generate:model', '--', '--input', inputPath, '--deterministic-fallback']);
  }

  async generationHealth({ provider = 'ollama' } = {}) {
    const providerName = normalizeProviderName(provider);
    const generator = createGenerationProvider(this.config, { provider: providerName });
    try {
      return await generator.healthCheck();
    } catch {
      return {
        enabled: providerName === 'deterministic' || Boolean(this.config.ollama?.enabled),
        reachable: false,
        model: generator.modelName || providerName,
        modelInstalled: false,
      };
    }
  }

  async startReview({ actor, runId }) {
    validateRunId(runId);
    const result = await this.updateRunState({
      actor,
      action: 'review_start',
      runId,
      status: 'PENDING_FOUNDER_REVIEW',
      publishability: 'NEEDS_FOUNDER_REVIEW',
      note: 'Ready for founder review.',
    });
    return result;
  }

  async approve({ actor, runId, version, confirm }) {
    validateRunId(runId);
    validateVersion(version);
    if (confirm !== 'true') throw Object.assign(new Error('Approval requires explicit confirmation.'), { statusCode: 400 });
    const run = await this.runs.readRun(runId);
    if (run.summary.version !== version) throw Object.assign(new Error('Approval requires the exact displayed version.'), { statusCode: 409 });
    if (run.summary.unresolvedIssueCount > 0) throw Object.assign(new Error('Blocking claims must be resolved before approval.'), { statusCode: 409 });
    const now = new Date().toISOString();
    const base = this.runs.runPath(runId);
    const manifest = await this.readRunJson(base, 'publication-manifest.json', {});
    const review = {
      reviewStatus: 'FOUNDER_APPROVED',
      articleVersion: version,
      reviewer: actor.email,
      reviewedBy: actor.email,
      timestamp: now,
      decision: 'approved',
    };
    await this.writeRunJson(base, 'reviews/founder-review.json', review);
    await this.writeRunJson(base, 'publication-manifest.json', {
      ...manifest,
      title: manifest.title || run.summary.title,
      slug: manifest.slug || run.summary.slug || safeSlug(run.summary.title || runId),
      currentStatus: 'FOUNDER_APPROVED',
      publishability: 'APPROVED_READY',
      approvedBy: actor.email,
      approvedAt: now,
      updatedAt: now,
      canonicalUrl: manifest.canonicalUrl || blogUrl(manifest.slug || run.summary.slug || safeSlug(run.summary.title || runId)),
    });
    await this.touchLifecycle(base, {
      type: 'FOUNDER_APPROVED',
      actor: actor.email,
      version,
      at: now,
    });
    await this.audit.append({ action: 'approval', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, version, result: 'SUCCESS' });
    return { ok: true, output: `Approved ${run.summary.title || runId} for Certifyd Blog preparation.` };
  }

  async reject({ actor, runId, note = '' }) {
    validateRunId(runId);
    const cleanNote = cleanString(note, 600);
    const base = this.runs.runPath(runId);
    await this.writeRunJson(base, 'reviews/founder-review.json', {
      reviewStatus: 'REJECTED',
      reviewer: actor.email,
      reviewedBy: actor.email,
      timestamp: new Date().toISOString(),
      decision: 'rejected',
      note: cleanNote,
    });
    const result = await this.updateRunState({
      actor,
      action: 'rejection',
      runId,
      status: 'REJECTED',
      publishability: 'BLOCKED_REJECTED',
      note: cleanNote || 'Rejected from dashboard.',
    });
    return result;
  }

  async requestRevision({ actor, runId }) {
    validateRunId(runId);
    const base = this.runs.runPath(runId);
    const run = await this.runs.readRun(runId);
    const version = run.summary.version || 'v1';
    await this.writeRunJson(base, `reviews/revision-requests/${version}.json`, {
      reviewStatus: 'REVISION_REQUESTED',
      articleVersion: version,
      reviewer: actor.email,
      timestamp: new Date().toISOString(),
      note: 'Revision requested from dashboard.',
    });
    return this.updateRunState({
      actor,
      action: 'revision_request',
      runId,
      version,
      status: 'REVISION_REQUESTED',
      publishability: 'BLOCKED_REVISION_REQUESTED',
      note: 'Revision requested.',
    });
  }

  async preparePublishing({ actor, runId }) {
    validateRunId(runId);
    const run = await this.runs.readRun(runId);
    if (!['FOUNDER_APPROVED', 'READY_TO_PUBLISH'].includes(run.summary.status)) {
      throw Object.assign(new Error('Founder approval is required before publishing preparation.'), { statusCode: 409 });
    }
    const base = this.runs.runPath(runId);
    const slug = safeSlug(run.blogPackage?.slug || run.summary.slug || run.summary.title || runId);
    const title = run.blogPackage?.title || run.summary.title || 'Untitled article';
    const articleMarkdown = stripFrontmatter(run.articleMarkdown || run.draftMarkdown || '');
    const canonicalUrl = blogUrl(slug);
    const blogPackage = {
      ...run.blogPackage,
      title,
      slug,
      author: run.blogPackage?.author || 'Certifyd',
      description: run.blogPackage?.description || run.blogPackage?.excerpt || '',
      canonicalUrl,
      repositoryPath: `content/blog/${slug}.md`,
      body: articleMarkdown,
      status: 'published',
      preparedAt: new Date().toISOString(),
    };
    await this.writeRunJson(base, 'blog/blog-post.json', blogPackage);
    await this.writeRunText(base, 'blog/blog-post.md', articleMarkdown);
    await this.writeRunJson(base, 'distribution/distribution-plan.json', {
      primaryTarget: {
        channel: 'Certifyd Blog',
        url: canonicalUrl,
        repositoryPath: blogPackage.repositoryPath,
        status: 'READY_TO_PUBLISH',
      },
      targets: [
        {
          channel: 'Certifyd Blog',
          url: canonicalUrl,
          repositoryPath: blogPackage.repositoryPath,
          status: 'READY_TO_PUBLISH',
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    await this.writeRunText(base, 'distribution/certifyd-blog.md', [
      '# Certifyd Blog',
      '',
      'Status: Ready to publish as a draft pull request.',
      `URL: ${canonicalUrl}`,
      `Repository path: ${blogPackage.repositoryPath}`,
      '',
      'Publishing remains draft-only until the GitHub pull request is reviewed and merged.',
    ].join('\n'));
    await this.updateRunState({
      actor,
      action: 'publishing_preparation',
      runId,
      status: 'READY_TO_PUBLISH',
      publishability: 'READY_TO_PUBLISH',
      canonicalUrl,
      note: 'Prepared for Certifyd Blog.',
    });
    return { ok: true, output: `Prepared for Certifyd Blog.\nURL: ${canonicalUrl}\nRepository path: ${blogPackage.repositoryPath}` };
  }

  async validatePublishing({ actor, runId }) {
    validateRunId(runId);
    const run = await this.runs.readRun(runId);
    const errors = [];
    const slug = safeSlug(run.blogPackage?.slug || run.summary.slug || run.summary.title || runId);
    if (run.summary.publishability !== 'READY_TO_PUBLISH') errors.push('Run is not marked READY_TO_PUBLISH.');
    if (!run.blogPackage?.repositoryPath && !run.blogPackage?.body) errors.push('Blog package has not been prepared.');
    if (!stripFrontmatter(run.articleMarkdown || run.draftMarkdown || run.blogPackage?.body || '')) errors.push('Article body is empty.');
    if (!slug) errors.push('Article slug is missing.');
    await this.audit.append({ action: 'publishing_validation', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, result: errors.length ? 'FAILED' : 'SUCCESS', note: errors.join(' ') });
    if (errors.length) throw Object.assign(new Error(errors.join(' ')), { statusCode: 409 });
    return { ok: true, output: `Publishing package is ready for Certifyd Blog: ${blogUrl(slug)}` };
  }

  async publishToCertifyd({ actor, runId, version }) {
    validateRunId(runId);
    validateVersion(version);
    try {
      const run = await this.runs.readRun(runId);
      if (run.summary.version !== version) {
        throw Object.assign(new Error('Publishing requires the exact displayed version.'), { statusCode: 409 });
      }
      await this.validatePublishing({ actor, runId });
      const result = await this.publisher.createPullRequest({ actor, runId });
      const base = this.runs.runPath(runId);
      const now = new Date().toISOString();
      const manifest = await this.readRunJson(base, 'publication-manifest.json', {});
      const publishing = {
        status: 'PUBLISHING_REVIEW',
        pullRequestUrl: result.pullRequestUrl || '',
        branchName: result.branchName || '',
        repositoryPath: result.repositoryPath || manifest.repositoryPath || '',
        canonicalUrl: result.canonicalUrl || manifest.canonicalUrl || '',
        startedBy: actor.email,
        startedAt: now,
      };
      await this.writeRunJson(base, 'publishing/github-pr.json', publishing);
      await this.writeRunJson(base, 'publication-manifest.json', {
        ...manifest,
        currentStatus: 'PUBLISHING',
        publishability: 'PUBLISHING_REVIEW',
        publishing,
        canonicalUrl: publishing.canonicalUrl || manifest.canonicalUrl || '',
        updatedAt: now,
      });
      await this.touchLifecycle(base, {
        type: 'PUBLISHING',
        actor: actor.email,
        version,
        note: result.pullRequestUrl ? `Draft PR created: ${result.pullRequestUrl}` : 'Publishing started.',
        at: now,
      });
      await this.audit.append({ action: 'publishing_pull_request', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, version, result: 'SUCCESS' });
      return result;
    } catch (error) {
      await this.audit.append({ action: 'publishing_pull_request', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, version, result: 'FAILED', note: error.message });
      throw error;
    }
  }

  async verifyLivePublication({ actor, runId }) {
    validateRunId(runId);
    const run = await this.runs.readRun(runId);
    const canonicalUrl = run.summary.canonicalUrl || run.blogPackage?.canonicalUrl;
    if (!canonicalUrl || !/^https:\/\/certifyd\.me\/blog\/[a-z0-9-]+\/$/.test(canonicalUrl)) {
      throw Object.assign(new Error('A valid Certifyd Blog canonical URL is required before live verification.'), { statusCode: 409 });
    }
    const response = await fetch(canonicalUrl, { method: 'GET', redirect: 'follow' });
    if (!response.ok) {
      throw Object.assign(new Error(`Live URL is not available yet: HTTP ${response.status}`), { statusCode: 409 });
    }
    const html = await response.text();
    const title = run.summary.title || run.blogPackage?.title || '';
    if (title && !html.toLowerCase().includes(title.toLowerCase().slice(0, 40))) {
      throw Object.assign(new Error('Live URL responded, but the expected article title was not found.'), { statusCode: 409 });
    }
    const base = this.runs.runPath(runId);
    const manifest = await this.readRunJson(base, 'publication-manifest.json', {});
    const now = new Date().toISOString();
    await this.writeRunJson(base, 'publication-manifest.json', {
      ...manifest,
      currentStatus: 'PUBLISHED',
      publishability: 'LIVE',
      canonicalUrl,
      publishedAt: manifest.publishedAt || now,
      liveVerifiedAt: now,
      updatedAt: now,
    });
    await this.touchLifecycle(base, {
      type: 'PUBLISHED',
      actor: actor.email,
      note: `Live URL verified: ${canonicalUrl}`,
      at: now,
    });
    await this.audit.append({ action: 'publishing_live_verify', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, result: 'SUCCESS', note: canonicalUrl });
    return { ok: true, output: `Live article verified: ${canonicalUrl}` };
  }

  async archiveArticle({ actor, runId }) {
    validateRunId(runId);
    const run = await this.runs.readRun(runId);
    const base = this.runs.runPath(runId);
    const now = new Date().toISOString();
    await this.writeRunJson(base, 'archive/archive.json', {
      archivedBy: actor.email,
      archivedAt: now,
      previousStatus: run.summary.status,
      previousPublishability: run.summary.publishability,
    });
    await this.updateRunState({
      actor,
      action: 'article_archive',
      runId,
      status: 'ARCHIVED',
      publishability: 'ARCHIVED',
      note: 'Article archived.',
    });
    return { ok: true, output: `Archived ${run.summary.title || runId}.` };
  }

  async deleteDraft({ actor, runId, confirmDelete = '' }) {
    validateRunId(runId);
    if (String(confirmDelete || '').trim().toLowerCase() !== 'delete') {
      throw Object.assign(new Error('Type delete to confirm draft deletion.'), { statusCode: 400 });
    }
    const run = await this.runs.readRun(runId);
    if (['PUBLISHED', 'PUBLISHING'].includes(run.summary.status)) {
      throw Object.assign(new Error('Published or publishing articles cannot be deleted as drafts. Archive them instead.'), { statusCode: 409 });
    }
    const source = this.runs.runPath(runId);
    const trashRoot = path.join(this.config.agentRoot, 'dashboard', 'trash');
    const target = path.join(trashRoot, `${runId}-${Date.now()}`);
    if (!target.startsWith(trashRoot)) throw new Error('Unsafe trash path.');
    await fs.mkdir(trashRoot, { recursive: true });
    await fs.rename(source, target);
    await this.audit.append({ action: 'draft_delete', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, result: 'SUCCESS', note: `Moved to ${path.basename(target)}` });
    return { ok: true, output: `Deleted draft ${run.summary.title || runId}. The run was moved to dashboard trash.` };
  }

  async runEngine(actor, action, npmArgs, runId = '', version = '') {
    try {
      const { stdout, stderr } = await execFileAsync('npm', ['--prefix', this.config.agentRoot, 'run', ...npmArgs], {
        cwd: this.config.agentRoot,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      await this.audit.append({ action, actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, version, result: 'SUCCESS' });
      return { ok: true, output: `${stdout}${stderr}`.slice(-RESULT_LIMIT) };
    } catch (error) {
      await this.audit.append({ action, actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, version, result: 'FAILED', note: error.message });
      throw Object.assign(new Error('Content Engine action failed.'), { statusCode: 500, details: String(error.stdout || error.stderr || error.message).slice(-RESULT_LIMIT) });
    }
  }

  assertSafeRelativeInput(inputPath) {
    if (!/^engine\/fixtures\/[a-zA-Z0-9._-]+\.json$/.test(inputPath)) {
      throw Object.assign(new Error('Invalid intake fixture path.'), { statusCode: 400 });
    }
  }

  async updateRunState({ actor, action, runId, version = '', status, publishability, canonicalUrl = '', note = '' }) {
    const base = this.runs.runPath(runId);
    const manifest = await this.readRunJson(base, 'publication-manifest.json', {});
    await this.writeRunJson(base, 'publication-manifest.json', {
      ...manifest,
      currentStatus: status || manifest.currentStatus || 'UNKNOWN',
      publishability: publishability || manifest.publishability || 'UNKNOWN',
      canonicalUrl: canonicalUrl || manifest.canonicalUrl || '',
      updatedAt: new Date().toISOString(),
    });
    await this.touchLifecycle(base, {
      type: status || action,
      actor: actor.email,
      note,
      at: new Date().toISOString(),
    });
    await this.audit.append({ action, actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, version, result: 'SUCCESS', note });
    return { ok: true, output: note || `${status || action} recorded.` };
  }

  async touchLifecycle(base, event) {
    const lifecycle = await this.readRunJson(base, 'lifecycle.json', {});
    const events = Array.isArray(lifecycle.events) ? lifecycle.events : [];
    await this.writeRunJson(base, 'lifecycle.json', {
      ...lifecycle,
      updatedAt: event.at || new Date().toISOString(),
      events: [...events, event].slice(-100),
    });
  }

  async readRunJson(base, relative, fallback) {
    const text = await this.readRunText(base, relative, '');
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  async readRunText(base, relative, fallback = '') {
    const file = path.join(base, relative);
    if (!file.startsWith(base)) throw new Error('Unsafe run path.');
    return fs.readFile(file, 'utf8').catch(() => fallback);
  }

  async writeRunJson(base, relative, data) {
    await this.writeRunText(base, relative, `${JSON.stringify(data, null, 2)}\n`);
  }

  async writeRunText(base, relative, value) {
    const file = path.join(base, relative);
    if (!file.startsWith(base)) throw new Error('Unsafe run path.');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value, 'utf8');
  }
}

function cryptoRandomId() {
  return `req-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function cleanString(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, maxLength);
}

function safeError(error) {
  return String(error?.message || error || 'Generation failed.').replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 600);
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'untitled';
}

function blogUrl(slug) {
  return `https://certifyd.me/blog/${safeSlug(slug)}/`;
}

function stripFrontmatter(markdown) {
  return String(markdown || '').replace(/^\uFEFF?---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]?/, '').trimStart();
}
