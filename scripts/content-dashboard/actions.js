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
    return this.runEngine(actor, 'review_start', ['content:review:start', '--', '--run', `engine/outputs/${runId}`], runId);
  }

  async approve({ actor, runId, version, confirm }) {
    validateRunId(runId);
    validateVersion(version);
    if (confirm !== 'true') throw Object.assign(new Error('Approval requires explicit confirmation.'), { statusCode: 400 });
    const run = await this.runs.readRun(runId);
    if (run.summary.version !== version) throw Object.assign(new Error('Approval requires the exact displayed version.'), { statusCode: 409 });
    if (run.summary.unresolvedIssueCount > 0) throw Object.assign(new Error('Blocking claims must be resolved before approval.'), { statusCode: 409 });
    return this.runEngine(actor, 'approval', ['content:review:approve', '--', '--run', `engine/outputs/${runId}`, '--reviewer', actor.email, '--confirm'], runId, version);
  }

  async reject({ actor, runId, note = '' }) {
    validateRunId(runId);
    return this.runEngine(actor, 'rejection', ['content:review:reject', '--', '--run', `engine/outputs/${runId}`, '--reviewer', actor.email, '--note', note.slice(0, 600)], runId);
  }

  async requestRevision({ actor, runId }) {
    validateRunId(runId);
    return this.runEngine(actor, 'revision_request', ['content:review:revise', '--', '--run', `engine/outputs/${runId}`, '--review-file', 'review/revision-request.json'], runId);
  }

  async preparePublishing({ actor, runId }) {
    validateRunId(runId);
    return this.runEngine(actor, 'publishing_preparation', ['content:publish:prepare', '--', '--run', `engine/outputs/${runId}`], runId);
  }

  async validatePublishing({ actor, runId }) {
    validateRunId(runId);
    return this.runEngine(actor, 'publishing_validation', ['content:publish:validate', '--', '--run', `engine/outputs/${runId}`], runId);
  }

  async createPublishingPullRequest({ actor, runId }) {
    validateRunId(runId);
    try {
      const result = await this.publisher.createPullRequest({ actor, runId });
      await this.audit.append({ action: 'publishing_pull_request', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, result: 'SUCCESS' });
      return result;
    } catch (error) {
      await this.audit.append({ action: 'publishing_pull_request', actorUserId: actor.id, actorDisplayName: actor.email, actorRole: actor.role, runId, result: 'FAILED', note: error.message });
      throw error;
    }
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
