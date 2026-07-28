import fs from 'node:fs/promises';
import path from 'node:path';
import { validateRunId, validateVersion, safeJsonParse } from './security.js';
import { normalizeArticleTitle } from './article-utils.js';
import { brainRecordId, brainReviewState } from './brain-utils.js';

const READ_LIMIT_BYTES = 1024 * 1024;

export class ContentRunRepository {
  constructor(config) {
    this.config = config;
    this.outputDir = config.outputDir;
  }

  runPath(runId) {
    return path.join(this.outputDir, validateRunId(runId));
  }

  async listRuns() {
    const entries = await fs.readdir(this.outputDir, { withFileTypes: true }).catch(() => []);
    const runs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { runs.push(await this.readRunSummary(entry.name)); } catch {}
    }
    return runs.sort((a, b) => String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')));
  }

  async readRunSummary(runId) {
    const base = this.runPath(runId);
    const manifest = await this.readJson(base, 'publication-manifest.json', {});
    const intake = await this.readJson(base, 'intake.json', {});
    const article = await this.readJson(base, 'final/article.json', {});
    const review = await this.readJson(base, 'reviews/founder-review.json', {});
    const claimLedger = await this.readJson(base, 'claim-ledgers/v2.json', null) || await this.readJson(base, 'claim-ledgers/v1.json', null) || await this.readJson(base, 'claim-ledger.json', {});
    const lifecycle = await this.readJson(base, 'lifecycle.json', {});
    const modelRequests = await this.readModelRequests(base);
    const modelProvider = modelRequests[0]?.provider || 'deterministic';
    const deterministicFallback = modelProvider === 'deterministic' || modelRequests[0]?.deterministicFallbackUsed;
    const claims = Array.isArray(claimLedger.claims) ? claimLedger.claims : [];
    const blockingClaims = claims.filter((claim) => ['BLOCKED', 'PROHIBITED', 'UNRESOLVED'].includes(claim.status));
    return {
      runId,
      title: normalizeArticleTitle(article.title || intake.workingTitle || manifest.title, 'Untitled'),
      slug: article.slug || manifest.slug || '',
      version: article.version || review.articleVersion || 'v1',
      status: manifest.currentStatus || review.reviewStatus || 'UNKNOWN',
      publishability: manifest.publishability || 'UNKNOWN',
      canonicalUrl: manifest.canonicalUrl || article.canonicalUrl || '',
      audience: intake.targetAudience || '',
      topic: intake.primaryTopic || '',
      contentType: intake.contentType || '',
      modelProvider,
      modelMode: deterministicFallback ? 'Deterministic fallback' : 'Live model',
      unresolvedIssueCount: blockingClaims.length,
      claimCount: claims.length,
      reviewStatus: review.reviewStatus || 'PENDING_FOUNDER_REVIEW',
      lastUpdated: lifecycle.updatedAt || review.timestamp || manifest.updatedAt || '',
    };
  }

  async readRun(runId) {
    const base = this.runPath(runId);
    const summary = await this.readRunSummary(runId);
    return {
      summary,
      intake: await this.readJson(base, 'intake.json', {}),
      manifest: await this.readJson(base, 'publication-manifest.json', {}),
      articleMarkdown: await this.readText(base, 'final/article.md', '') || await this.readText(base, 'final-article.md', ''),
      draftMarkdown: await this.readText(base, 'draft.md', ''),
      research: await this.readJson(base, 'research-record.json', {}),
      externalResearch: await this.readJson(base, 'external-research.json', {}),
      topicOpportunity: await this.readJson(base, 'topic-opportunity.json', {}),
      claimLedger: await this.readJson(base, 'claim-ledgers/v2.json', null) || await this.readJson(base, 'claim-ledgers/v1.json', null) || await this.readJson(base, 'claim-ledger.json', {}),
      seo: await this.readJson(base, 'seo/seo-package.json', null) || await this.readJson(base, 'seo-package.json', {}),
      distribution: await this.readDistribution(base),
      lifecycle: await this.readJson(base, 'lifecycle.json', {}),
      reviews: await this.readReviews(base),
      versions: await this.readVersions(base),
      blogPackage: await this.readJson(base, 'blog/blog-post.json', {}),
      modelRequests: await this.readModelRequests(base),
    };
  }

  async readText(base, relative, fallback = '') {
    const file = path.join(base, relative);
    if (!file.startsWith(base)) throw new Error('Unsafe path.');
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > READ_LIMIT_BYTES) return fallback;
    return fs.readFile(file, 'utf8').catch(() => fallback);
  }

  async readJson(base, relative, fallback = null) {
    const text = await this.readText(base, relative, '');
    return text ? safeJsonParse(text, fallback) : fallback;
  }

  async readVersions(base) {
    const dir = path.join(base, 'drafts');
    const entries = await fs.readdir(dir).catch(() => []);
    return entries.filter((name) => /^v\d+\.md$/.test(name)).sort().map((name) => ({ version: name.replace('.md', ''), file: name }));
  }

  async readReviews(base) {
    const review = await this.readJson(base, 'reviews/founder-review.json', null);
    const revisionsDir = path.join(base, 'reviews/revision-requests');
    const revisions = [];
    for (const name of await fs.readdir(revisionsDir).catch(() => [])) {
      if (/^v\d+\.json$/.test(name)) revisions.push(await this.readJson(revisionsDir, name, {}));
    }
    return { founderReview: review, revisions };
  }

  async readDistribution(base) {
    const dir = path.join(base, 'distribution');
    const entries = await fs.readdir(dir).catch(() => []);
    const assets = [];
    for (const name of entries.filter((item) => item.endsWith('.md'))) {
      assets.push({ channel: name.replace('.md', ''), status: 'DRAFT', body: await this.readText(dir, name, '') });
    }
    return {
      plan: await this.readJson(base, 'distribution/distribution-plan.json', {}),
      destinations: await this.readJson(base, 'distribution/destinations.json', {}),
      assets,
    };
  }

  async readModelRequests(base) {
    const dir = path.join(base, 'model-requests');
    const entries = await fs.readdir(dir).catch(() => []);
    const requests = [];
    for (const name of entries.filter((item) => item.endsWith('.json'))) {
      const item = await this.readJson(dir, name, null);
      if (item) requests.push(item);
    }
    return requests;
  }
}

export class ContentBrainRepository {
  constructor(config) {
    this.root = path.resolve(config.agentRoot, 'knowledge');
    this.outputDir = config.outputDir;
  }

  async listFiles() {
    const files = [];
    const usage = await this.readUsageIndex();
    await this.walk(this.root, files, usage);
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async walk(dir, files, usage) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (!full.startsWith(this.root)) continue;
      if (entry.isDirectory()) await this.walk(full, files, usage);
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const stat = await fs.stat(full);
        const relative = path.relative(this.root, full).replace(/\\/g, '/');
        const id = brainRecordId(relative);
        const text = await fs.readFile(full, 'utf8').catch(() => '');
        const usageItem = usage.get(id) || { count: 0, articles: [] };
        files.push({
          id,
          name: relative,
          classification: classifyKnowledgePath(relative),
          lastUpdated: stat.mtime.toISOString(),
          evidenceUsageCount: usageItem.count,
          affectedArticles: usageItem.articles,
          staleStatus: brainReviewState(relative, text),
        });
      }
    }
  }

  async readUsageIndex() {
    const usage = new Map();
    const entries = await fs.readdir(this.outputDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const base = path.join(this.outputDir, entry.name);
      if (!base.startsWith(this.outputDir)) continue;
      const research = await readJson(path.join(base, 'research-record.json'), {});
      const manifest = await readJson(path.join(base, 'publication-manifest.json'), {});
      const articleTitle = manifest.title || entry.name;
      const records = Array.isArray(research.selectedEvidence) ? research.selectedEvidence : [];
      for (const record of records) {
        const id = normalizeBrainReference(record.id || record.path);
        if (!id) continue;
        const item = usage.get(id) || { count: 0, articles: [] };
        item.count += 1;
        if (!item.articles.includes(articleTitle)) item.articles.push(articleTitle);
        usage.set(id, item);
      }
      const ids = Array.isArray(research.trendProvenance?.brainRecordIds) ? research.trendProvenance.brainRecordIds : [];
      for (const rawId of ids) {
        const id = normalizeBrainReference(rawId);
        if (!id) continue;
        const item = usage.get(id) || { count: 0, articles: [] };
        if (!item.articles.includes(articleTitle)) item.articles.push(articleTitle);
        usage.set(id, item);
      }
    }
    return usage;
  }
}

async function readJson(file, fallback) {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  return text ? safeJsonParse(text, fallback) : fallback;
}

function normalizeBrainReference(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('brain:')) return raw.replace(/\\/g, '/').replace(/\.md$/, '');
  const match = raw.match(/content-agent\/knowledge\/(.+?)(?:\.md)?$/);
  return match ? brainRecordId(match[1]) : '';
}

function classifyKnowledgePath(relative) {
  if (relative.includes('founder')) return 'Founder Decisions';
  if (relative.includes('technical')) return 'Technical Audits';
  if (relative.includes('facts')) return 'Approved Claims';
  if (relative.includes('products')) return 'Product Documentation';
  if (relative.includes('capabilities')) return 'Capability Files';
  return 'Knowledge';
}
