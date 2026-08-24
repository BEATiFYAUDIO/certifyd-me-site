import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_BLOG_COVER_IMAGE, cleanArticlePromptText, isSafeImagePath, normalizeArticleTitle, selectArticleCoverImage, titleFromPrompt } from './article-utils.js';
import { brainRecordId, brainReviewState } from './brain-utils.js';
import { readTrendState } from './trends.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:1.5b';
const SAFE_SOURCE_LIMIT = 16;
const MAX_INTERACTIVE_OUTPUT_TOKENS = 900;
const MAX_ARTICLE_GENERATION_TOKENS = 520;
const DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS = 5000;
const SECRET_PATTERN = /(?:api[_-]?key|secret|token|password|private[_-]?key|session|credential|jwt|bearer|cloudflare|github_app_private_key)/i;
const activeUsers = new Set();
let activeGlobalGenerations = 0;

const BRAIN_SELECTION_THEMES = [
  { id: 'positioning', label: 'Certifyd positioning', patterns: [/constitution|ecosystem|founder-decisions|approved-public-claims|investment-thesis/i, /\bpositioning|creator-owned|network|business model\b/i] },
  { id: 'capabilities', label: 'Capabilities', patterns: [/products\/core|capabilities\/publishing|capabilities\/profiles|capabilities\/catalog|capabilities\/release-records|capabilities\/discovery/i, /\bprofile|publishing|catalog|release|discovery|capability|core\b/i] },
  { id: 'ownership', label: 'Creator ownership/control', patterns: [/creator-ownership|founder-decisions|constitution|ecosystem/i, /\bownership|control|creator-owned|direct relationship|audience\b/i] },
  { id: 'rights', label: 'Permissions and rights', patterns: [/capabilities\/access|capabilities\/provenance|capabilities\/consistency-review|approved-public-claims/i, /\bright|permission|license|clearance|attribution|proof|provenance\b/i] },
  { id: 'commerce', label: 'Commerce and payments', patterns: [/capabilities\/commerce|capabilities\/payments|capabilities\/payouts|capabilities\/receipts|products\/core|revenue-model|transaction/i, /\bcommerce|payment|receipt|payout|transaction|wallet|sell|direct-to-fan\b/i] },
  { id: 'dependency', label: 'Network and platform dependency', patterns: [/capabilities\/network-distribution|capabilities\/partner-integrations|ecosystem|investment-thesis/i, /\bplatform|dependency|distribution|network|partner|routing|interoperability\b/i] },
  { id: 'provenance', label: 'Provenance and receipts', patterns: [/capabilities\/provenance|capabilities\/receipts|capabilities\/release-records|approved-public-claims/i, /\bprovenance|receipt|record|timestamp|verification|audit\b/i] },
];

export class GenerationConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerationConfigurationError';
    this.statusCode = 503;
  }
}

export class GenerationValidationError extends Error {
  constructor(message, warnings = []) {
    super(message);
    this.name = 'GenerationValidationError';
    this.statusCode = 422;
    this.warnings = warnings;
  }
}

export class GenerationRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerationRateLimitError';
    this.statusCode = 429;
  }
}

class ResponseReadTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResponseReadTimeoutError';
    this.statusCode = 408;
  }
}

export const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'suggestedSlug', 'excerpt', 'bodyMarkdown'],
  properties: {
    title: { type: 'string' },
    suggestedSlug: { type: 'string' },
    excerpt: { type: 'string' },
    author: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    seoTitle: { type: 'string' },
    seoDescription: { type: 'string' },
    coverImage: { type: 'string' },
    bodyMarkdown: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'sourceIds', 'confidence'],
        properties: {
          text: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['supported', 'needs-review'] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

export function createGenerationProvider(config, options = {}) {
  const provider = normalizeProviderName(options.provider || config.modelProvider || 'deterministic');
  if (provider === 'ollama') return new OllamaQwenGenerationProvider(config, options);
  return new DeterministicGenerationProvider(config, options);
}

export function normalizeProviderName(value) {
  const provider = String(value || 'deterministic').trim().toLowerCase();
  if (['ollama', 'qwen', 'qwen3', 'local-ai', 'local'].includes(provider)) return 'ollama';
  return 'deterministic';
}

export function resetGenerationState() {
  activeUsers.clear();
  activeGlobalGenerations = 0;
}

export class DeterministicGenerationProvider {
  constructor(config) {
    this.config = config;
    this.id = 'deterministic';
    this.displayName = 'Deterministic';
    this.providerName = 'deterministic';
    this.modelName = 'template-generated';
    this.supportsLiveGeneration = false;
    this.lastRequest = { durationMs: 0, tokenUsage: null };
  }

  async isAvailable() {
    return true;
  }

  async healthCheck() {
    return { enabled: true, reachable: true, model: this.modelName, modelInstalled: true };
  }

  async generateArticle(input, groundedContext) {
    assertGroundedContextReady(groundedContext);
    const sourceIds = groundedContext.sourceRecords.slice(0, 4).map((source) => source.id);
    const title = titleFromPrompt(input.topic || input.workingTitle, 'Certifyd Draft');
    const suggestedSlug = slugify(title);
    const body = [
      `# ${title}`,
      '',
      `This draft is for ${input.audience || input.targetAudience || 'Certifyd readers'}.`,
      '',
      `Objective: ${input.objective || input.businessObjective || 'Create a grounded Certifyd article.'}`,
      '',
      '## Grounded context',
      '',
      groundedContext.approvedClaims.slice(0, 5).map((claim) => `- ${claim}`).join('\n') || '- No approved claims were available in the selected Brain context.',
      '',
      '## Draft direction',
      '',
      'Use approved Certifyd Brain records to explain the topic plainly. Distinguish live capabilities from planned capabilities, avoid legal or financial guarantees, and keep factual claims tied to source material.',
    ].join('\n');

    return validateGeneratedArticle({
      title,
      suggestedSlug,
      excerpt: `A draft Certifyd article about ${title}.`,
      author: 'Certifyd',
      tags: ['Certifyd', 'creator ownership'],
      seoTitle: `${title} | Certifyd`,
      seoDescription: `A draft Certifyd article about ${title}.`,
      bodyMarkdown: body,
      claims: sourceIds.length ? [{ text: `Certifyd article draft about ${title}.`, sourceIds, confidence: 'needs-review' }] : [],
      warnings: ['Template-generated draft requiring editorial review.'],
    }, groundedContext);
  }
}

export class OllamaQwenGenerationProvider {
  constructor(config, options = {}) {
    this.config = config;
    this.id = 'ollama';
    this.displayName = 'Local AI — Qwen 3';
    this.providerName = 'ollama';
    this.modelName = options.modelName || config.ollama.model;
    this.supportsLiveGeneration = true;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.lastRequest = { durationMs: 0, tokenUsage: null };
  }

  async isAvailable() {
    const health = await this.healthCheck().catch(() => ({ enabled: false, reachable: false, modelInstalled: false }));
    return Boolean(health.enabled && health.reachable && health.modelInstalled);
  }

  async healthCheck(signal) {
    if (!this.config.ollama.enabled) {
      return { enabled: false, reachable: false, model: this.modelName, modelInstalled: false };
    }
    const baseUrl = assertAllowedOllamaBaseUrl(this.config.ollama.baseUrl);
    const response = await fetchWithTimeout(this.fetchImpl, `${baseUrl}/api/tags`, { method: 'GET', signal }, healthTimeoutMs(this.config));
    if (!response.ok) {
      throw new GenerationConfigurationError(`Ollama health check failed with HTTP ${response.status}.`);
    }
    const body = await readJsonWithTimeout(response, healthTimeoutMs(this.config), 'Ollama health check');
    const models = Array.isArray(body.models) ? body.models.map((model) => String(model.name || '')) : [];
    const modelInstalled = models.includes(this.modelName);
    return { enabled: true, reachable: true, model: this.modelName, modelInstalled };
  }

  async generateArticle(input, groundedContext, abortSignal) {
    assertGroundedContextReady(groundedContext);
    if (!this.config.ollama.enabled) {
      throw new GenerationConfigurationError('Local AI is disabled. Set OLLAMA_ENABLED=true to use Qwen generation.');
    }
    const baseUrl = assertAllowedOllamaBaseUrl(this.config.ollama.baseUrl);
    const userKey = input.actorUserId || input.actorEmail || 'local-user';
    enterGenerationSlot(this.config, userKey);
    const started = Date.now();
    try {
      const health = await this.healthCheck(abortSignal);
      if (!health.modelInstalled) {
        throw new GenerationConfigurationError(`Ollama is reachable, but ${this.modelName} is not installed. Run: ollama pull ${this.modelName}`);
      }
      const systemInstruction = buildSystemInstruction();
      const userPrompt = buildUserPrompt(input, groundedContext);
      recordGenerationPromptDiagnostics(input, groundedContext, systemInstruction, userPrompt);
      const response = await fetchWithTimeout(this.fetchImpl, `${baseUrl}/api/chat`, {
        method: 'POST',
        signal: abortSignal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          stream: false,
          think: this.config.ollama.think,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ],
          options: {
            temperature: this.config.ollama.temperature,
            num_predict: Math.min(this.config.ollama.maxOutputTokens, MAX_ARTICLE_GENERATION_TOKENS),
            num_ctx: this.config.ollama.maxContextChars,
          },
        }),
      }, this.config.ollama.timeoutMs);
      if (!response.ok) {
        throw new GenerationConfigurationError(await ollamaErrorMessage(response, this.modelName));
      }
      const body = await readJsonWithTimeout(response, this.config.ollama.timeoutMs, 'Qwen generation');
      const content = String(body?.message?.content || '').trim();
      if (!content) throw new GenerationValidationError('Qwen returned no structured article content.');
      this.lastRequest = {
        durationMs: Date.now() - started,
        tokenUsage: normalizeOllamaUsage(body),
      };
      return validateGeneratedArticle(articleFromQwenDraft(content, input, groundedContext), groundedContext);
    } catch (error) {
      if (error?.name === 'AbortError' || error instanceof ResponseReadTimeoutError || /aborted due to timeout|timed out|timeout/i.test(error?.message || '')) {
        throw Object.assign(new Error('Qwen generation timed out while waiting for the local model response. Try again or reduce the requested draft size.'), { statusCode: 408 });
      }
      if (error instanceof GenerationConfigurationError || error instanceof GenerationValidationError || error instanceof GenerationRateLimitError) throw error;
      throw Object.assign(new Error(sanitizeLogMessage(error?.message || 'Qwen generation failed.')), { statusCode: 502 });
    } finally {
      leaveGenerationSlot(userKey);
    }
  }
}

export async function buildGroundedContext(config, input) {
  const brainRoot = path.resolve(config.agentRoot || path.join(config.siteRoot, 'content-agent'), 'knowledge');
  const sourceRecords = [];
  const externalSourceFacts = await loadAttachedExternalSourceSummaries(config, input);
  const requestedSourceIds = parseIdList(input.trendSourceItemIds, 40);
  const sourceBackedGeneration = requestedSourceIds.length > 0 || Boolean(cleanId(input.trendOpportunityId));
  if (sourceBackedGeneration) {
    const loadedSourceIds = new Set(externalSourceFacts.map((source) => cleanId(source.id)));
    const missingSourceIds = requestedSourceIds.filter((id) => !loadedSourceIds.has(cleanId(id)));
    if (missingSourceIds.length) {
      throw new GenerationConfigurationError(`Cannot generate source-backed article — selected source evidence is unavailable: ${missingSourceIds.join(', ')}`);
    }
    if (!hasUsableExternalSourceFacts(externalSourceFacts)) {
      throw new GenerationConfigurationError('Cannot generate source-backed article — original source evidence is unavailable.');
    }
  }
  await walkMarkdown(brainRoot, async (file) => {
    const relative = path.relative(brainRoot, file);
    const text = await fs.readFile(file, 'utf8');
    if (!isSafeBrainText(relative, text)) return;
    const metadata = extractBrainRecordMetadata(text);
    sourceRecords.push({
      id: sourceId(relative),
      path: `content-agent/knowledge/${relative}`,
      title: titleFromMarkdown(relative, text),
      excerpt: cleanText(text).slice(0, 1800),
      reviewState: brainReviewState(relative, text),
      currentStatus: metadata.currentStatus,
      confidence: metadata.confidence,
      supportedClaims: metadata.supportedClaims,
      qualifiedClaims: metadata.qualifiedClaims,
      prohibitedClaims: metadata.prohibitedClaims,
      safeWording: metadata.safeWording,
    });
  });
  const selected = selectRelevantSources(sourceRecords, input, externalSourceFacts).slice(0, SAFE_SOURCE_LIMIT);
  const context = {
    audience: input.audience || input.targetAudience || '',
    contentObjective: input.objective || input.businessObjective || '',
    articleType: input.contentType || 'article',
    sourceRestrictions: input.sourceRestrictions || '',
    publicationStatus: 'draft',
    approvedClaims: selected.filter((source) => /approved|facts|capabilities|products|business-model|revenue|transaction/i.test(source.path)).map((source) => `${source.id}: ${source.excerpt.slice(0, 420)}`),
    productFacts: selected.filter((source) => /products|capabilities|ecosystem|constitution|core|fan|awards|network/i.test(source.path)).map((source) => `${source.id}: ${source.excerpt.slice(0, 420)}`),
    terminology: selected.filter((source) => /vocabulary|brand|mission|vision|philosophy/i.test(source.path)).map((source) => `${source.id}: ${source.excerpt.slice(0, 320)}`),
    featureStatus: selected.filter((source) => /capabilities|approved-public-claims|technical-verification|facts/i.test(source.path)).map((source) => `${source.id}: ${source.excerpt.slice(0, 320)}`),
    prohibitedClaims: selected.filter((source) => /approved-public-claims|consistency-review|founder-decisions/i.test(source.path)).map((source) => `${source.id}: ${source.excerpt.slice(0, 420)}`),
    deprecatedTerminology: selected.filter((source) => /deprecated|consistency-review|approved-public-claims/i.test(source.path)).map((source) => `${source.id}: ${source.excerpt.slice(0, 260)}`),
    approvedKnowledge: selected.map((source) => ({
      id: source.id,
      title: source.title,
      path: source.path,
      theme: source.primarySelectionTheme || source.selectionThemes?.[0] || 'Approved Certifyd knowledge',
      excerpt: source.excerpt,
      selectionReason: source.selectionReason,
      currentStatus: source.currentStatus,
      confidence: source.confidence,
      supportedClaims: source.supportedClaims || [],
      qualifiedClaims: source.qualifiedClaims || [],
      prohibitedClaims: source.prohibitedClaims || [],
      safeWording: source.safeWording || [],
    })),
    externalSourceFacts,
    relatedArticles: await readRelatedArticles(config.siteRoot),
    sourceRecords: selected,
    generationDiagnostics: {
      brainSourcesScanned: sourceRecords.length,
      brainRecordsRetrieved: sourceRecords.map((source) => ({
        id: source.id,
        title: source.title,
        path: source.path,
        reviewState: source.reviewState,
        currentStatus: source.currentStatus,
        confidence: source.confidence,
      })),
      brainRecordsSelected: selected.map((source) => ({
        id: source.id,
        title: source.title,
        path: source.path,
        reviewState: source.reviewState,
        currentStatus: source.currentStatus,
        confidence: source.confidence,
        selectionScore: source.selectionScore,
        primarySelectionTheme: source.primarySelectionTheme || '',
        selectionThemes: source.selectionThemes || [],
        selectionReason: source.selectionReason || '',
      })),
      relevantApprovedClaims: selected.filter((source) => /approved|facts|capabilities|products|business-model|revenue|transaction/i.test(source.path)).map((source) => ({
        id: source.id,
        title: source.title,
        excerpt: source.excerpt.slice(0, 420),
      })),
      externalArticleSourcesUsed: externalSourceFacts.map((source) => ({
        id: source.id,
        title: source.title,
        publisher: source.publisher,
        publishedAt: source.publishedAt,
        articleUrl: source.articleUrl,
      })),
      selectedSourceCount: requestedSourceIds.length || externalSourceFacts.length,
      externalSourcesLoaded: externalSourceFacts.length,
      externalSourceIdsLoaded: externalSourceFacts.map((source) => source.id),
      externalSourceTitlesLoaded: externalSourceFacts.map((source) => source.title),
      requestedSourceItemIds: requestedSourceIds,
      requestedBrainRecordIds: parseBrainIdList(input.trendBrainRecordIds, 40),
    },
  };
  return trimGroundedContext(context, config.ollama.maxContextChars);
}

export function validateGeneratedArticle(value, groundedContext) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GenerationValidationError('Generated article must be an object.');
  if ('status' in value || 'published' in value || 'approved' in value || 'publicationDate' in value || 'githubBranch' in value || 'mergeState' in value) {
    throw new GenerationValidationError('Generated article cannot set publication, approval, GitHub or merge state.');
  }
  const required = ['title', 'suggestedSlug', 'excerpt', 'bodyMarkdown'];
  for (const key of required) {
    if (!(key in value)) throw new GenerationValidationError(`Generated article missing ${key}.`);
  }
  if (value.author && value.author !== 'Certifyd') throw new GenerationValidationError('Generated article author must be Certifyd.');
  const title = cleanArticlePromptText(value.title, 'Untitled article');
  const slug = slugify(value.suggestedSlug || title);
  if (!slug) throw new GenerationValidationError('Generated slug is invalid.');
  if (value.tags && !Array.isArray(value.tags)) throw new GenerationValidationError('Generated tags are malformed.');
  if (value.claims && !Array.isArray(value.claims)) throw new GenerationValidationError('Generated claims are malformed.');
  if (value.warnings && !Array.isArray(value.warnings)) throw new GenerationValidationError('Generated warnings are malformed.');
  for (const textField of ['title', 'excerpt', 'bodyMarkdown']) {
    if (typeof value[textField] !== 'string' || !value[textField].trim()) throw new GenerationValidationError(`Generated ${textField} is empty.`);
  }
  if (value.seoTitle && typeof value.seoTitle !== 'string') throw new GenerationValidationError('Generated seoTitle is malformed.');
  if (value.seoDescription && typeof value.seoDescription !== 'string') throw new GenerationValidationError('Generated seoDescription is malformed.');
  if (value.coverImage && typeof value.coverImage !== 'string') throw new GenerationValidationError('Generated coverImage is malformed.');
  if (value.bodyMarkdown.length > 18000) throw new GenerationValidationError('Generated article is too long.');
  if (detectInternalContextLeak(value.bodyMarkdown).length) {
    throw new GenerationValidationError('Generation failed validation — internal context leaked into article.');
  }
  const sourceIds = new Set(groundedContext.sourceRecords.map((source) => source.id));
  const warnings = [...(value.warnings || []).map(String).map((warning) => warning.trim()).filter(Boolean)];
  const normalizedClaims = [];
  for (const claim of value.claims || []) {
    if (!claim || typeof claim.text !== 'string' || !Array.isArray(claim.sourceIds) || !['supported', 'needs-review'].includes(claim.confidence)) {
      throw new GenerationValidationError('Each generated claim must include text, sourceIds and confidence.');
    }
    const ids = claim.sourceIds.map(String).map((id) => id.trim()).filter(Boolean);
    const missing = ids.filter((id) => !sourceIds.has(id));
    const validIds = ids.filter((id) => sourceIds.has(id));
    if (missing.length) {
      throw new GenerationValidationError(`Generated claim referenced unknown Brain source IDs: ${missing.join(', ')}`);
    }
    if (!validIds.length) {
      throw new GenerationValidationError(`Generated claim has no approved Brain evidence: ${claim.text.slice(0, 160)}`);
    }
    normalizedClaims.push({ text: claim.text.trim(), sourceIds: validIds, confidence: validIds.length && !missing.length ? claim.confidence : 'needs-review' });
  }
  const prohibitedHits = detectProhibitedLanguage(value.bodyMarkdown, groundedContext.prohibitedClaims);
  warnings.push(...prohibitedHits);
  if (/\b(published|approved for publishing|ready to publish|guaranteed|permanent record|legal guarantee|royalty management)\b/i.test(value.bodyMarkdown)) {
    warnings.push('Draft contains language that may require founder, technical, or legal review.');
  }
  if (/\b(live|currently|already)\b/i.test(value.bodyMarkdown) && /\b(planned|roadmap|future|not yet|under development)\b/i.test(JSON.stringify(groundedContext.featureStatus))) {
    warnings.push('Review live/planned feature language before approval.');
  }
  const externalAdoptionHits = detectUnsupportedExternalAdoptionClaims(value.bodyMarkdown, groundedContext);
  if (externalAdoptionHits.length) {
    throw new GenerationValidationError('Generated draft made unsupported external Certifyd adoption claims.', externalAdoptionHits);
  }
  const tags = (value.tags || ['Certifyd']).map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  return {
    title: clampText(title, 160),
    slug,
    excerpt: clampText(value.excerpt, 260),
    author: 'Certifyd',
    tags,
    seoTitle: clampText(value.seoTitle ? normalizeArticleTitle(value.seoTitle) : `${title} | Certifyd`, 70),
    seoDescription: clampText(value.seoDescription || value.excerpt, 165),
    coverImage: normalizeBlogCoverImage(value.coverImage, { title, tags, excerpt: value.excerpt, body: value.bodyMarkdown }),
    bodyMarkdown: cleanArticleBodyMarkdown(value.bodyMarkdown, title),
    claims: normalizedClaims,
    warnings: [...new Set(warnings)].slice(0, 30),
    status: 'draft',
  };
}

export async function persistGeneratedArticleRun(config, article, input, groundedContext, provider) {
  const timestamp = new Date().toISOString();
  const warnings = [...new Set([...(article.warnings || []), ...lowRelevanceSourceWarnings(groundedContext)])].slice(0, 30);
  const runId = createRunId(article.slug);
  const dir = path.join(config.outputDir, runId);
  await fs.mkdir(path.join(dir, 'final'), { recursive: true });
  await fs.mkdir(path.join(dir, 'drafts'), { recursive: true });
  await fs.mkdir(path.join(dir, 'claim-ledgers'), { recursive: true });
  await fs.mkdir(path.join(dir, 'reviews'), { recursive: true });
  await fs.mkdir(path.join(dir, 'model-requests'), { recursive: true });
  await fs.mkdir(path.join(dir, 'blog'), { recursive: true });
  await fs.mkdir(path.join(dir, 'seo'), { recursive: true });

  const frontMatter = [
    '---',
    `title: ${JSON.stringify(article.title)}`,
    `slug: ${JSON.stringify(article.slug)}`,
    `date: ${JSON.stringify(timestamp.slice(0, 10))}`,
    `updated: ${JSON.stringify(timestamp.slice(0, 10))}`,
    `author: ${JSON.stringify(article.author)}`,
    `excerpt: ${JSON.stringify(article.excerpt)}`,
    `coverImage: ${JSON.stringify(article.coverImage || DEFAULT_BLOG_COVER_IMAGE)}`,
    `tags: ${JSON.stringify(article.tags)}`,
    'status: "draft"',
    `seoTitle: ${JSON.stringify(article.seoTitle)}`,
    `seoDescription: ${JSON.stringify(article.seoDescription)}`,
    '---',
    '',
  ].join('\n');
  const articleMarkdown = `${frontMatter}${article.bodyMarkdown}\n\n> Draft generated for founder review. Not approved for publishing.\n`;
  const claimLedger = {
    claims: article.claims.map((claim, index) => ({
      claimId: `claim-${index + 1}`,
      text: claim.text,
      sourceIds: claim.sourceIds,
      confidence: claim.confidence,
      status: claim.sourceIds.length && claim.confidence === 'supported' ? 'APPROVED_WITH_SOURCE' : 'NEEDS_REVIEW',
      reviewerNote: 'Generated draft claim. Founder review required before publishing.',
    })),
    warnings,
  };
  const unresolvedIssueCount = claimLedger.claims.filter((claim) => claim.status !== 'APPROVED_WITH_SOURCE').length + warnings.length;
  const trendProvenance = buildTrendProvenance(input, timestamp, provider, groundedContext);
  const summary = {
    runId,
    title: article.title,
    slug: article.slug,
    version: 'v1',
    status: 'PENDING_FOUNDER_REVIEW',
    publishability: 'BLOCKED_PENDING_APPROVAL',
    canonicalUrl: `https://certifyd.me/blog/${article.slug}/`,
    audience: input.audience || input.targetAudience || '',
    topic: titleFromPrompt(input.topic || input.workingTitle, ''),
    contentType: input.contentType || 'article',
    modelProvider: provider.providerName,
    modelMode: provider.supportsLiveGeneration ? 'Local AI' : 'Deterministic fallback',
    trendProvenance,
    unresolvedIssueCount,
    lastUpdated: timestamp,
  };
  await fs.writeFile(path.join(dir, 'intake.json'), JSON.stringify(redactInput(input), null, 2));
  await fs.writeFile(path.join(dir, 'draft.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'drafts', 'v1.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'final-article.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'final', 'article.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'final', 'article.json'), JSON.stringify({ ...article, warnings, version: 'v1', status: 'draft', canonicalUrl: summary.canonicalUrl, trendProvenance }, null, 2));
  await fs.writeFile(path.join(dir, 'claim-ledger.json'), JSON.stringify(claimLedger, null, 2));
  await fs.writeFile(path.join(dir, 'claim-ledgers', 'v1.json'), JSON.stringify(claimLedger, null, 2));
  await fs.writeFile(path.join(dir, 'research-record.json'), JSON.stringify({ selectedEvidence: groundedContext.sourceRecords, claimsThatMustNotBeMade: groundedContext.prohibitedClaims, externalSourceFacts: groundedContext.externalSourceFacts, generationDiagnostics: groundedContext.generationDiagnostics || {}, trendProvenance }, null, 2));
  await fs.writeFile(path.join(dir, 'seo-package.json'), JSON.stringify({ seoTitle: article.seoTitle, metaDescription: article.seoDescription, suggestedSlug: article.slug }, null, 2));
  await fs.writeFile(path.join(dir, 'seo', 'seo-package.json'), JSON.stringify({ seoTitle: article.seoTitle, metaDescription: article.seoDescription, suggestedSlug: article.slug }, null, 2));
  await fs.writeFile(path.join(dir, 'publication-manifest.json'), JSON.stringify({ ...summary, currentStatus: 'PENDING_FOUNDER_REVIEW', publishability: 'BLOCKED_PENDING_APPROVAL', updatedAt: timestamp }, null, 2));
  await fs.writeFile(path.join(dir, 'lifecycle.json'), JSON.stringify({ createdAt: timestamp, updatedAt: timestamp, status: 'PENDING_FOUNDER_REVIEW' }, null, 2));
  await fs.writeFile(path.join(dir, 'reviews', 'founder-review.json'), JSON.stringify({ reviewStatus: 'PENDING_FOUNDER_REVIEW', articleVersion: 'v1', timestamp }, null, 2));
  await fs.writeFile(path.join(dir, 'blog', 'blog-post.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'blog', 'blog-post.json'), JSON.stringify({ ...article, warnings, status: 'draft' }, null, 2));
  await fs.writeFile(path.join(dir, 'model-requests', 'article-generation.json'), JSON.stringify({
    provider: provider.providerName,
    model: provider.modelName,
    stage: 'article-generation',
    promptTemplateVersion: 'dashboard-ollama-qwen-v2',
    inputHashes: { input: hashJson(redactInput(input)), groundedContext: hashJson(groundedContext) },
    knowledgeEvidenceIds: groundedContext.sourceRecords.map((source) => source.id),
    trendProvenance,
    timestamp,
    timeoutMs: config.ollama.timeoutMs,
    responseStatus: 'SUCCESS',
    tokenUsage: provider.lastRequest?.tokenUsage || undefined,
    durationMs: provider.lastRequest?.durationMs || undefined,
    deterministicFallbackUsed: !provider.supportsLiveGeneration,
  }, null, 2));
  return {
    runId,
    output: [
      `Generated ${provider.supportsLiveGeneration ? 'Qwen local-AI' : 'template-generated'} draft: ${article.title}`,
      `Run: ${runId}`,
      'Status: draft / pending founder review',
      `Expected public URL after approval: ${summary.canonicalUrl}`,
    ].join('\n'),
  };
}

export function getDefaultOllamaConfig(env = process.env) {
  return {
    enabled: env.OLLAMA_ENABLED === 'true',
    baseUrl: env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
    model: env.OLLAMA_CONTENT_MODEL || DEFAULT_OLLAMA_MODEL,
    timeoutMs: positiveNumber(env.OLLAMA_REQUEST_TIMEOUT_MS, 120000),
    healthTimeoutMs: positiveNumber(env.OLLAMA_HEALTH_TIMEOUT_MS, Math.min(positiveNumber(env.OLLAMA_REQUEST_TIMEOUT_MS, 120000), DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS)),
    maxOutputTokens: boundedNumber(env.OLLAMA_MAX_OUTPUT_TOKENS, 700, 192, MAX_INTERACTIVE_OUTPUT_TOKENS),
    temperature: boundedNumber(env.OLLAMA_TEMPERATURE, 0.35, 0, 1),
    maxContextChars: boundedNumber(env.OLLAMA_CONTEXT_LIMIT, 4096, 2000, 8000),
    think: env.OLLAMA_THINK === 'true',
    maxConcurrentGenerations: positiveNumber(env.OLLAMA_MAX_CONCURRENT_GENERATIONS, 1),
  };
}

function buildSystemInstruction() {
  return [
    'Write a concise Certifyd blog draft in Markdown only.',
    'Use only the supplied Certifyd context for company facts.',
    'The external story is the factual foundation of the article. Include only as much Certifyd analysis as is necessary to explain the underlying industry problem and why it is relevant to Certifyd.',
    'Use external source summaries only for facts about the news subject; do not invent facts beyond those summaries.',
    'Do not invent customers, partnerships, revenue, adoption, launch dates, technical capabilities or legal claims.',
    'Never say the external company, article subject, rights holder, investor, label, distributor or platform uses, leverages, integrates with, partners with, is powered by, or benefits from Certifyd unless that exact relationship appears in the supplied context.',
    'CERTIFYD CONNECTION RULE: never state or imply that a source-story company uses, integrates with, partners with, relies on, or will use Certifyd unless SOURCE FACTS explicitly establish that relationship.',
    'Certifyd knowledge may only explain why the development matters to Certifyd, how it relates conceptually to approved capabilities or positioning, and what broader industry problem or direction it illustrates.',
    'Never invent payment, royalty, licensing or technical mechanics not present in SOURCE FACTS.',
    'For news about companies outside Certifyd, explain only why the news is relevant to Certifyd readers. Do not turn relevance into a relationship or adoption claim.',
    'CURRENT or LIVE Brain claims may be described as existing capabilities. BETA claims must be called beta/testing. PLANNED claims must use future or roadmap language. UNCLEAR or LOW CONFIDENCE claims must not become definitive product claims.',
    'If the prompt mentions bots, bot farming, fake engagement, fake streams or fraud, frame Certifyd as an alternative to fake attention metrics and direct the draft toward real customer activity, direct commerce, attribution and review-safe anti-fraud commentary.',
    'Never describe Certifyd as a tool for creating, running, controlling, automating or scaling bots.',
    'Clearly distinguish live, beta and planned features.',
    'Use “network” rather than “platform” when describing Certifyd unless a source explicitly requires another term.',
    'Keep it short: one H1 title, 3 to 5 short sections, no JSON, no YAML, no code fences.',
    'Never use internal prompt labels, context labels, Brain template headings or source-scope headings as article headings.',
    'Do not mention this generation process or source IDs.',
  ].join('\n');
}

function buildUserPrompt(input, groundedContext) {
  const context = compactGroundedContextForModel(groundedContext);
  const guardrails = buildTopicGuardrails(input).map((item) => `- ${item}`).join('\n');
  const claims = context.approvedClaims.map((item) => `- ${item}`).join('\n') || '- No approved claims selected.';
  const productFacts = context.productFacts.map((item) => `- ${item}`).join('\n') || '- No product facts selected.';
  const approvedKnowledge = context.approvedKnowledge.map(formatBrainKnowledgeForPrompt).join('\n') || '- No additional approved Certifyd knowledge selected.';
  const externalSources = context.externalSourceFacts.map((item) => `- [${item.id || 'source'}] ${item.publisher}${item.publishedAt ? ` (${item.publishedAt})` : ''}: ${item.title}. ${item.summary}${item.articleUrl ? ` Source: ${item.articleUrl}` : ''}`).join('\n') || '- No external source summaries attached.';
  const prohibited = context.prohibitedClaims.map((item) => `- ${item}`).join('\n') || '- Avoid unsupported claims.';
  return [
    `Topic: ${input.topic || input.workingTitle || 'Certifyd article'}`,
    `Audience: ${input.audience || input.targetAudience || 'Certifyd readers'}`,
    `Objective: ${input.objective || input.businessObjective || 'Create a grounded Certifyd article.'}`,
    `Angle: ${input.angle || 'Explain the business relevance clearly.'}`,
    '',
    'WRITING INSTRUCTIONS',
    guardrails,
    '',
    'SOURCE FACTS',
    'Facts about the source story. Claims about external companies must come from this section.',
    externalSources,
    '',
    'CERTIFYD FACTS',
    'Claims about Certifyd. Respect status and confidence qualifiers.',
    claims,
    approvedKnowledge,
    productFacts,
    '',
    'Do not claim:',
    prohibited,
    '',
    'EDITORIAL ANGLE',
    '- Start with the source facts as the news/business story.',
    '- Connect only the relevant Certifyd knowledge themes to the story.',
    '- For music licensing, AI inputs/outputs, derivative works, settlement, opt-in, compensation or creator choice stories, prefer permissions, creator control, provenance, rights/clearance, compensation/commerce and attribution.',
    '- Do not force every Certifyd knowledge theme into the article.',
    '- Frame Certifyd relevance as analysis, not as a claim that the news subject uses Certifyd.',
    '- Keep source facts and Certifyd commentary epistemically separate: SOURCE FACTS describe the companies/story; CERTIFYD FACTS describe Certifyd; CERTIFYD ANALYSIS explains conceptual relevance only.',
    '- Never write phrases like “integrating Certifyd,” “through Certifyd,” “using Certifyd,” “facilitated through Certifyd,” or “powered by Certifyd” about source-story companies unless SOURCE FACTS explicitly say that.',
    '- Do not claim what a company product aims to do unless SOURCE FACTS say it.',
    '- Let the article structure follow the actual story. Do not use boilerplate headings like Business Relevance, Core Knowledge Themes, or Certifyd Relevance.',
    '- Avoid generic AI-blog filler such as “in a significant move,” “rapidly evolving landscape,” “plays a crucial role,” “robust capabilities,” “catalyst for innovation,” or “creators and investors alike.”',
    '',
    'OUTPUT RULES',
    '- Return article Markdown only: title, intro, useful sections and conclusion if warranted.',
    '- Do not output these labels as article headings: SOURCE FACTS, CERTIFYD FACTS, CERTIFYD KNOWLEDGE, CERTIFYD ANALYSIS, EDITORIAL ANGLE, WRITING INSTRUCTIONS, Definition, Source Scope, Approved Certifyd Knowledge, Brain Context, Prompt Instructions, Business Relevance, Core Knowledge Themes, Certifyd Relevance.',
    '- Do not use generic blog filler or mention founder review in the article body.',
  ].join('\n');
}

function compactGroundedContextForModel(groundedContext) {
  const compactList = (values, limit, chars) => (values || []).slice(0, limit).map((value) => clampText(value, chars));
  const compactClaimList = (values, limit, chars) => (values || []).slice(0, limit).map((value) => clampText(value, chars));
  return {
    approvedClaims: compactList(groundedContext.approvedClaims, 3, 220),
    productFacts: compactList(groundedContext.productFacts, 3, 220),
    approvedKnowledge: (groundedContext.approvedKnowledge || []).slice(0, 6).map((source) => ({
      id: source.id,
      theme: source.theme,
      currentStatus: source.currentStatus || '',
      confidence: source.confidence || '',
      supportedClaims: compactClaimList(source.supportedClaims, 3, 180),
      qualifiedClaims: compactClaimList(source.qualifiedClaims, 3, 180),
      prohibitedClaims: compactClaimList(source.prohibitedClaims, 3, 180),
      safeWording: compactClaimList(source.safeWording, 2, 180),
      excerpt: clampText(source.excerpt, 320),
    })),
    terminology: compactList(groundedContext.terminology, 1, 180),
    prohibitedClaims: compactList(groundedContext.prohibitedClaims, 3, 220),
    externalSourceFacts: (groundedContext.externalSourceFacts || []).slice(0, 4).map((source) => ({
      id: source.id,
      publisher: clampText(source.publisher, 80),
      publishedAt: clampText(source.publishedAt, 16),
      title: clampText(source.title, 160),
      summary: clampText(source.summary, 420),
      articleUrl: clampText(source.articleUrl, 160),
      categories: Array.isArray(source.categories) ? source.categories.slice(0, 5) : [],
      certifydRelevanceScore: Number(source.certifydRelevanceScore || 0),
    })),
    sources: (groundedContext.sourceRecords || []).slice(0, 6).map((source) => ({
      id: source.id,
      title: source.title,
      path: source.path,
      currentStatus: source.currentStatus || '',
      confidence: source.confidence || '',
    })),
  };
}

function formatBrainKnowledgeForPrompt(item) {
  const lines = [
    `- [${item.id}] ${item.theme}${item.currentStatus ? ` — status: ${item.currentStatus}` : ''}${item.confidence ? `; confidence: ${item.confidence}` : ''}`,
  ];
  for (const claim of item.supportedClaims || []) lines.push(`  Supported: ${claim}`);
  for (const claim of item.qualifiedClaims || []) lines.push(`  Qualified: ${claim}`);
  for (const claim of item.safeWording || []) lines.push(`  Safe wording: ${claim}`);
  for (const claim of item.prohibitedClaims || []) lines.push(`  Prohibited: ${claim}`);
  if (!(item.supportedClaims || []).length && !(item.qualifiedClaims || []).length && !(item.safeWording || []).length) {
    lines.push(`  Context: ${item.excerpt}`);
  }
  return lines.join('\n');
}

function recordGenerationPromptDiagnostics(input, groundedContext, systemInstruction, userPrompt) {
  const compact = compactGroundedContextForModel(groundedContext);
  groundedContext.generationDiagnostics = {
    ...(groundedContext.generationDiagnostics || {}),
    promptTemplateVersion: 'dashboard-ollama-qwen-v2',
    finalPromptStructure: [
      'system instruction',
      'topic/audience/objective/angle',
      'guardrails',
      'approved Certifyd claims',
      'approved Certifyd knowledge by theme',
      'external source facts',
      'product facts',
      'do-not-claim list',
      'required distinction between source facts, approved Brain knowledge and editorial inference',
      'Markdown draft instruction',
    ],
    brainRecordsSentToModel: compact.sources,
    exactBrainContextSentToModel: {
      approvedClaims: compact.approvedClaims,
      approvedKnowledge: compact.approvedKnowledge,
      productFacts: compact.productFacts,
      terminology: compact.terminology,
      prohibitedClaims: compact.prohibitedClaims,
    },
    externalArticleSourcesSentToModel: compact.externalSourceFacts,
    externalSourcesSentToModelCount: compact.externalSourceFacts.length,
    externalSourceIdsSentToModel: compact.externalSourceFacts.map((source) => source.id).filter(Boolean),
    externalSourceTitlesSentToModel: compact.externalSourceFacts.map((source) => source.title).filter(Boolean),
    contextSize: {
      maxContextChars: groundedContext.contextSizing?.maxContextChars || 0,
      fullContextChars: groundedContext.contextSizing?.fullContextChars || 0,
      finalContextChars: JSON.stringify(groundedContext).length,
      systemPromptChars: systemInstruction.length,
      userPromptChars: userPrompt.length,
      totalPromptChars: systemInstruction.length + userPrompt.length,
      truncated: Boolean(groundedContext.contextSizing?.truncated),
      removedRecords: groundedContext.contextSizing?.removedRecords || [],
      removedContextItems: groundedContext.contextSizing?.removedContextItems || [],
    },
  };
}

function buildTopicGuardrails(input) {
  const text = `${input.topic || ''} ${input.objective || ''} ${input.sourceRestrictions || ''}`.toLowerCase();
  const guardrails = [
    'Make the business relevance clear before implementation details.',
    'Avoid unsupported claims and label uncertain ideas as review notes.',
    'It is acceptable to describe Certifyd’s general value for attribution, transparent transaction records, creator commerce and anti-fraud when supported by Brain context.',
    'Do not claim the news subject uses, leverages, partners with, integrates with, is powered by, or receives benefits from Certifyd.',
    'Use phrasing like “this is relevant to Certifyd because…” instead of implying a business relationship.',
  ];
  if (/\b(bot|bots|bot farming|fake engagement|fake stream|fake streams|fraud|click farm|stream farm|payola)\b/.test(text)) {
    guardrails.push(
      'This topic is about reducing the business value of fake engagement, not enabling automation.',
      'Do not say Certifyd creates, manages, controls, monitors or secures bot farms.',
      'Position Certifyd around real customer activity, direct creator commerce, attribution, receipts and review-safe trust signals.',
    );
  }
  return guardrails;
}

async function loadAttachedExternalSourceSummaries(config, input) {
  const requestedIds = new Set(parseIdList(input.trendSourceItemIds, 40));
  const requestedOpportunityId = cleanId(input.trendOpportunityId);
  if (!requestedIds.size && !requestedOpportunityId) return [];
  const state = await readTrendState(config).catch(() => null);
  if (!state) return [];
  if (!requestedIds.size && requestedOpportunityId) {
    const opportunity = [...(state.opportunities || []), ...(state.savedIdeas || [])].find((item) => item.id === requestedOpportunityId);
    for (const id of opportunity?.sourceItemIds || []) requestedIds.add(cleanId(id));
  }
  if (!requestedIds.size) return [];
  return (state.sourceItems || [])
    .filter((item) => requestedIds.has(cleanId(item.id)))
    .map((item) => ({
      id: cleanId(item.id),
      publisher: clampText(cleanText(item.publisher || item.sourceName || 'Source').replace(/\n+/g, ' '), 80),
      publishedAt: clampText(String(item.publishedAt || '').slice(0, 10), 16),
      title: clampText(cleanText(item.title || '').replace(/\n+/g, ' '), 160),
      summary: clampText(cleanText(item.summary || '').replace(/\n+/g, ' '), 520),
      articleUrl: safePublicUrl(item.articleUrl),
      certifydRelevanceScore: Number(item.certifydRelevanceScore || 0),
      categories: Array.isArray(item.categories) ? item.categories.slice(0, 5) : [],
    }))
    .filter((item) => item.title && item.summary);
}

function hasUsableExternalSourceFacts(externalSourceFacts = []) {
  return externalSourceFacts.some((source) => (
    safePublicUrl(source.articleUrl)
    && String(source.publisher || '').trim()
    && String(source.title || '').trim()
    && String(source.summary || '').trim()
  ));
}

function detectUnsupportedExternalAdoptionClaims(markdown, groundedContext = {}) {
  const text = String(markdown || '').replace(/\s+/g, ' ');
  const patterns = [
    /\bby\s+(?:using|leveraging|adopting|integrating)\s+Certifyd(?:’s|'s)?\s+(?:platform|network|ecosystem|capabilities|provenance|attribution|infrastructure)?[^.]{0,220}\b(?:Universal Music Group|UMG|Spotify|Deezer|Suno|BMG|Providence|Wasserman|THE•TEAM|company|label|platform|distributor)\b/gi,
    /\b(?:Universal Music Group|UMG|Spotify|Deezer|Suno|BMG|Providence|Wasserman|THE•TEAM|company|label|platform|distributor)\b[^.]{0,180}\b(?:uses?|using|leverages?|leveraging|adopts?|adopting|integrates?|integrating|partners?|partnering|relies? on|will use|powered by|benefits? from)\b[^.]{0,120}\bCertifyd\b/gi,
  ];
  if (!sourceFactsEstablishCertifydRelationship(groundedContext)) {
    patterns.push(
      /\b(?:integrating|using|adopting|leveraging)\s+Certifyd\b/gi,
      /\b(?:through|via|with|on)\s+Certifyd(?:’s|'s)?\s+(?:platform|network|ecosystem|infrastructure|capabilities|provenance|attribution|payment|payments|royalty|royalties)?\b/gi,
      /\bwith\s+Certifyd(?:’s|'s)?\s+(?:technology|platform|network|infrastructure|capabilities|payment|payments|royalty|royalties)[^.]{0,160}\b(?:Suno|BMG|Universal Music Group|UMG|Spotify|Deezer|company|label|platform|distributor)\b/gi,
      /\bCertifyd\s+enables\s+(?:Suno|BMG|Universal Music Group|UMG|Spotify|Deezer|company|label|platform|distributor)\b/gi,
      /\b(?:Suno|BMG|Universal Music Group|UMG|Spotify|Deezer|company|label|platform|distributor)\b[^.]{0,160}\b(?:licenses?|licensed|clears?|cleared|settles?|settled|processes?|processed|routes?|routed|receives?|received)\b[^.]{0,120}\b(?:through|via|with|on)\s+Certifyd\b/gi,
      /\bfacilitated\s+(?:by|through|via)\s+Certifyd\b/gi,
      /\bpowered\s+by\s+Certifyd\b/gi,
      /\bCertifyd\b[^.]{0,120}\b(?:facilitates?|routes?|pays?|distributes?|deposits?|licenses?|clears?)\b[^.]{0,120}\b(?:Suno|BMG|Universal Music Group|UMG|Spotify|Deezer|company|label|platform|distributor|royalt(?:y|ies)|payment|payments)\b/gi,
    );
  }
  const hits = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      hits.push(`Unsupported relationship/adoption claim: ${clampText(sentenceAround(text, match.index || 0), 220)}`);
    }
  }
  return [...new Set(hits)].slice(0, 8);
}

function sourceFactsEstablishCertifydRelationship(groundedContext = {}) {
  const sourceFacts = Array.isArray(groundedContext.externalSourceFacts) ? groundedContext.externalSourceFacts : [];
  const sourceText = sourceFacts.map((source) => `${source.title || ''} ${source.summary || ''}`).join(' ').replace(/\s+/g, ' ');
  if (!/\bCertifyd\b/i.test(sourceText)) return false;
  return /\b(?:uses?|using|leverages?|leveraging|adopts?|adopting|integrates?|integrating|partners?|partnering|relies? on|powered by|through|via|with)\b[^.]{0,160}\bCertifyd\b|\bCertifyd\b[^.]{0,160}\b(?:uses?|using|leverages?|leveraging|integrates?|integrating|partners?|partnering|powers?|facilitates?)\b/i.test(sourceText);
}

function sentenceAround(text, index) {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1);
  const next = text.indexOf('.', index);
  const end = next === -1 ? text.length : next + 1;
  return text.slice(start, end).trim();
}

function assertGroundedContextReady(groundedContext) {
  const sourceCount = groundedContext?.sourceRecords?.length || 0;
  const usefulCount = (groundedContext?.approvedClaims?.length || 0) + (groundedContext?.productFacts?.length || 0) + (groundedContext?.terminology?.length || 0);
  if (!sourceCount || !usefulCount) {
    throw new GenerationConfigurationError('The Certifyd Brain does not contain enough approved material for this article. Add approved facts before using generation.');
  }
}

function assertAllowedOllamaBaseUrl(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_OLLAMA_BASE_URL);
  } catch {
    throw new GenerationConfigurationError('OLLAMA_BASE_URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new GenerationConfigurationError('OLLAMA_BASE_URL must use http or https.');
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new GenerationConfigurationError('OLLAMA_BASE_URL must be an origin only, without credentials, paths or query strings.');
  }
  const host = url.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!privateHost) throw new GenerationConfigurationError('OLLAMA_BASE_URL must point to localhost or a private-network address.');
  return url.origin;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  if (typeof fetchImpl !== 'function') throw new GenerationConfigurationError('Fetch is unavailable in this Node runtime.');
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetchImpl(url, { ...options, signal });
}

function healthTimeoutMs(config) {
  return positiveNumber(config?.ollama?.healthTimeoutMs, Math.min(positiveNumber(config?.ollama?.timeoutMs, 120000), DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS));
}

async function readJsonWithTimeout(response, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (response?.body && typeof response.body.cancel === 'function') {
        response.body.cancel().catch(() => {});
      }
      reject(new ResponseReadTimeoutError(`${label} timed out while reading response JSON.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([response.json(), timeout]);
  } catch (error) {
    if (error instanceof ResponseReadTimeoutError) throw error;
    throw new GenerationValidationError(`${label} returned malformed JSON.`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function enterGenerationSlot(config, userKey) {
  const key = String(userKey || 'local-user').toLowerCase();
  if (activeUsers.has(key)) throw new GenerationRateLimitError('This user already has an active generation.');
  if (activeGlobalGenerations >= config.ollama.maxConcurrentGenerations) throw new GenerationRateLimitError('Local AI generation is busy. Try again when the current draft finishes.');
  activeUsers.add(key);
  activeGlobalGenerations += 1;
}

function leaveGenerationSlot(userKey) {
  const key = String(userKey || 'local-user').toLowerCase();
  activeUsers.delete(key);
  activeGlobalGenerations = Math.max(0, activeGlobalGenerations - 1);
}

async function ollamaErrorMessage(response, modelName) {
  const text = await response.text().catch(() => '');
  if (/not found|model/i.test(text)) return `Ollama model ${modelName} is not installed. Run: ollama pull ${modelName}`;
  return `Ollama generation failed with HTTP ${response.status}.`;
}

export function parseJsonContent(content) {
  const clean = extractJsonCandidate(content);
  try {
    return JSON.parse(clean);
  } catch {
    throw new GenerationValidationError('Qwen returned malformed JSON.');
  }
}

function parseGeneratedArticleContent(content, input, groundedContext) {
  try {
    return completeGeneratedArticleFields(parseJsonContent(content), input);
  } catch (error) {
    if (!(error instanceof GenerationValidationError)) throw error;
    if (detectInternalContextLeak(content).length) {
      throw new GenerationValidationError('Generation failed validation — internal context leaked into article.');
    }
    return coerceArticleFromMalformedOutput(content, input, groundedContext, error.message);
  }
}

function articleFromQwenDraft(content, input, groundedContext) {
  if (detectInternalContextLeak(content).length) {
    throw new GenerationValidationError('Generation failed validation — internal context leaked into article.');
  }
  if (looksLikeStructuredJson(content)) {
    try {
      return parseGeneratedArticleContent(content, input, groundedContext);
    } catch (error) {
      if (!(error instanceof GenerationValidationError)) throw error;
    }
  }
  const clean = cleanMarkdownDraftText(content);
  const title = titleFromPrompt(titleFromMalformedOutput(clean) || input.workingTitle || input.topic, 'Certifyd Draft');
  const bodyMarkdown = ensureMarkdownTitle(clean || `This draft needs founder review before it can be published.`, title);
  const excerpt = excerptFromBody(bodyMarkdown, title);
  return {
    title,
    suggestedSlug: slugify(title),
    excerpt,
    author: 'Certifyd',
    tags: tagsFromTopic(`${input.topic || ''} ${title}`),
    seoTitle: `${title} | Certifyd`,
    seoDescription: excerpt,
    coverImage: selectArticleCoverImage({ title, tags: tagsFromTopic(`${input.topic || ''} ${title}`), excerpt, body: bodyMarkdown }),
    bodyMarkdown,
    claims: [],
    warnings: [],
  };
}

function looksLikeStructuredJson(content) {
  const clean = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return clean.startsWith('{') || /^```json/i.test(clean) || /\bHere is the JSON\b/i.test(clean);
}

function completeGeneratedArticleFields(value, input) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const nested = value.article && typeof value.article === 'object' && !Array.isArray(value.article) ? value.article : null;
  const completed = nested ? { ...value, ...nested } : { ...value };
  completed.title = titleFromPrompt(completed.title || input.workingTitle || input.topic, 'Certifyd Draft');
  if (!completed.bodyMarkdown && typeof completed.article === 'string') completed.bodyMarkdown = completed.article;
  if (!completed.bodyMarkdown && typeof completed.draft === 'string') completed.bodyMarkdown = completed.draft;
  if (!completed.bodyMarkdown && typeof completed.markdown === 'string') completed.bodyMarkdown = completed.markdown;
  if (!completed.bodyMarkdown && typeof completed.body_markdown === 'string') completed.bodyMarkdown = completed.body_markdown;
  if (!completed.bodyMarkdown && typeof completed.contentMarkdown === 'string') completed.bodyMarkdown = completed.contentMarkdown;
  if (!completed.bodyMarkdown && typeof completed.body === 'string') completed.bodyMarkdown = completed.body;
  if (!completed.bodyMarkdown && typeof completed.content === 'string') completed.bodyMarkdown = completed.content;
  if (!Array.isArray(completed.warnings)) completed.warnings = [];
  if (!completed.bodyMarkdown) {
    completed.bodyMarkdown = [
      `# ${completed.title}`,
      '',
      completed.excerpt || `Draft requested: ${input.topic || completed.title}.`,
      '',
      'The local AI provider returned structured metadata but did not return a usable article body. This placeholder keeps the draft recoverable for founder review instead of failing generation.',
    ].join('\n');
    completed.warnings.push('Qwen returned structured JSON without a usable bodyMarkdown field. Founder revision is required.');
  }
  if (!completed.suggestedSlug && completed.title) completed.suggestedSlug = slugify(completed.title);
  if (!completed.excerpt && completed.bodyMarkdown) completed.excerpt = excerptFromBody(completed.bodyMarkdown, completed.title);
  if (!completed.author) completed.author = 'Certifyd';
  if (!Array.isArray(completed.tags)) completed.tags = tagsFromTopic(`${input.topic || ''} ${completed.title || ''}`);
  if (completed.seoTitle) completed.seoTitle = normalizeArticleTitle(completed.seoTitle);
  if (!completed.seoTitle && completed.title) completed.seoTitle = `${completed.title} | Certifyd`;
  if (!completed.seoDescription && completed.excerpt) completed.seoDescription = completed.excerpt;
  completed.coverImage = normalizeBlogCoverImage(completed.coverImage, {
    title: completed.title,
    tags: completed.tags,
    excerpt: completed.excerpt,
    body: completed.bodyMarkdown,
  });
  if (!Array.isArray(completed.claims)) completed.claims = [];
  return completed;
}

function coerceArticleFromMalformedOutput(content, input, groundedContext, reason) {
  const clean = cleanModelDraftText(content);
  const title = titleFromPrompt(titleFromMalformedOutput(clean) || input.workingTitle || input.topic, 'Certifyd Draft');
  const bodyMarkdown = bodyFromMalformedOutput(clean, title, input);
  const fallbackSourceIds = groundedContext.sourceRecords.slice(0, 3).map((source) => source.id);
  return {
    title,
    suggestedSlug: slugify(title),
    excerpt: excerptFromBody(bodyMarkdown, title),
    author: 'Certifyd',
    tags: tagsFromTopic(input.topic || title),
    seoTitle: `${title} | Certifyd`,
    seoDescription: excerptFromBody(bodyMarkdown, title),
    coverImage: selectArticleCoverImage({ title, tags: tagsFromTopic(input.topic || title), body: bodyMarkdown }),
    bodyMarkdown,
    claims: fallbackSourceIds.length ? [{
      text: `Draft generated from a malformed local AI response for founder review: ${title}`,
      sourceIds: fallbackSourceIds,
      confidence: 'needs-review',
    }] : [],
    warnings: [
      reason,
      'Qwen did not return valid JSON. The dashboard recovered the response into a review-only draft.',
      'Founder review is required before approval or publishing.',
    ],
  };
}

function cleanModelDraftText(content) {
  return String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json|markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s*[{[]/, '')
    .replace(/[}\]]\s*$/, '')
    .replace(/\r/g, '')
    .trim();
}

function cleanMarkdownDraftText(content) {
  return String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\r/g, '')
    .trim();
}

function titleFromMalformedOutput(text) {
  const markdownTitle = text.match(/^#\s+(.+)$/m)?.[1];
  if (markdownTitle) return markdownTitle.trim();
  const jsonishTitle = text.match(/["']?title["']?\s*:\s*["']([^"']+)["']/i)?.[1];
  if (jsonishTitle) return jsonishTitle.trim();
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine && firstLine.length < 120 ? firstLine.replace(/^title:\s*/i, '').trim() : '';
}

function bodyFromMalformedOutput(text, title, input) {
  const bodyMatch = text.match(/["']?bodyMarkdown["']?\s*:\s*["']([\s\S]+)$/i)?.[1];
  const candidate = bodyMatch || text;
  const withoutFrontmatterLike = candidate
    .replace(/["']?(title|suggestedSlug|slug|excerpt|author|tags|seoTitle|seoDescription|coverImage|claims|warnings)["']?\s*:\s*["'][^"']*["'],?/gi, '')
    .trim();
  if (withoutFrontmatterLike.length > 120) {
    return ensureMarkdownTitle(withoutFrontmatterLike.replace(/\\n/g, '\n'), title);
  }
  return [
    `# ${title}`,
    '',
    `This is a recovered draft about ${input.topic || title}.`,
    '',
    'The local AI provider returned malformed JSON, so the dashboard preserved the usable text and marked the draft for founder review.',
    '',
    'Use the Certifyd Brain evidence and editorial review before publishing.',
  ].join('\n');
}

function ensureMarkdownTitle(body, title) {
  const clean = cleanArticleBodyMarkdown(body, title);
  return /^#\s+/m.test(clean) ? clean : `# ${title}\n\n${clean}`;
}

function cleanArticleBodyMarkdown(body, title) {
  const fallbackTitle = cleanArticlePromptText(title, 'Certifyd Draft');
  let markdown = String(body || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\r/g, '')
    .trim();
  markdown = removeGenericBlogFiller(markdown);
  markdown = markdown.replace(/^#\s+(.+)$/m, (match, heading) => {
    const cleanHeading = cleanArticlePromptText(heading, '');
    return cleanHeading ? `# ${cleanHeading}` : match;
  });
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1] || '';
  if (firstHeading && cleanArticlePromptText(firstHeading, '') !== fallbackTitle && /write\s+(?:a\s+)?certifyd\s+article\s+about|use\s+this\s+angle/i.test(firstHeading)) {
    markdown = markdown.replace(/^#\s+.+\n*/, `# ${fallbackTitle}\n\n`);
  }
  return markdown.trim();
}

function removeGenericBlogFiller(markdown) {
  const blocked = [
    /creators like you/i,
    /partners and investors alike/i,
    /stay tuned/i,
    /join the conversation/i,
    /together we can/i,
    /draft generated for founder review/i,
    /not approved for publishing/i,
    /founder review is required/i,
    /template-generated draft/i,
  ];
  return String(markdown || '')
    .split('\n')
    .filter((line) => !blocked.some((pattern) => pattern.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function excerptFromBody(bodyMarkdown, title) {
  const clean = String(bodyMarkdown || '')
    .replace(/^#\s+.+$/m, '')
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clampText(clean || `A Certifyd draft about ${title}.`, 220);
}

function tagsFromTopic(topic) {
  const tags = ['Certifyd'];
  const text = String(topic || '').toLowerCase();
  if (/bot|fake|fraud|farming/.test(text)) tags.push('trust');
  if (/music|spotify|artist|streaming/.test(text)) tags.push('music');
  if (/ai|qwen|local/.test(text)) tags.push('AI');
  if (/ownership|creator/.test(text)) tags.push('creator ownership');
  return [...new Set(tags)].slice(0, 6);
}

function extractJsonCandidate(content) {
  const clean = String(content || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (clean.startsWith('{') && clean.endsWith('}')) return clean;
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return clean.slice(firstBrace, lastBrace + 1).trim();
  return clean;
}

function normalizeBlogCoverImage(value, context = {}) {
  const raw = String(value || '').trim();
  if (!raw) return selectArticleCoverImage(context);
  if (!isSafeImagePath(raw)) return selectArticleCoverImage(context);
  return raw;
}

function selectRelevantSources(sources, input, externalSourceFacts = []) {
  const sourceQuery = externalSourceFacts.map((source) => `${source.title || ''} ${source.summary || ''} ${(source.categories || []).join(' ')}`).join(' ');
  const query = `${input.topic || ''} ${input.objective || ''} ${input.angle || ''} ${input.sourceRestrictions || ''} ${sourceQuery}`.toLowerCase();
  const requestedIds = new Set(parseBrainIdList(input.trendBrainRecordIds, 40));
  const storyThemes = inferStoryThemes(query);
  const queryTerms = [...new Set(query.split(/[^a-z0-9]+/).filter((term) => term.length > 3 && !/^(brain|source|story|article|certifyd|about|with|from|that|this|their|will|should|would|relevant|approved|records)$/.test(term)))].slice(0, 24);
  const scored = sources.map((source) => {
    const haystack = `${source.path} ${source.title} ${source.excerpt}`.toLowerCase();
    const themes = matchedBrainThemes(source);
    let score = brainBaseScore(source);
    if (requestedIds.has(source.id)) score += 7;
    score += storyThemeScore(source, storyThemes);
    for (const term of queryTerms) {
      if (haystack.includes(term)) score += 1;
    }
    if (/investors|investment-thesis|revenue-model/i.test(source.path) && !storyThemes.has('finance')) score -= 5;
    if (/capabilities\/payments|capabilities\/payouts/i.test(source.path) && !storyThemes.has('commerce')) score -= 3;
    if (/founder-decisions|constitution|ecosystem/i.test(source.path) && storyThemes.size >= 2) score -= 1;
    return {
      source: {
        ...source,
        selectionScore: score,
        primarySelectionTheme: primaryBrainTheme(source, themes),
        selectionThemes: themes.map((theme) => theme.label),
        selectionReason: selectionReason(source, score, themes, requestedIds, storyThemes),
      },
      score,
      themes,
    };
  });
  const ranked = scored.sort((a, b) => b.score - a.score || a.source.path.localeCompare(b.source.path));
  const selected = [];
  const selectedIds = new Set();
  for (const item of ranked) addSelected(item.source);
  return selected;

  function addSelected(source) {
    if (selectedIds.has(source.id) || selected.length >= SAFE_SOURCE_LIMIT) return;
    selectedIds.add(source.id);
    selected.push(source);
  }
}

function brainBaseScore(source) {
  if (/capabilities|products|facts/i.test(source.path)) return 3;
  if (/approved-public-claims/i.test(source.path)) return 2;
  if (/founder-decisions|constitution|ecosystem/i.test(source.path)) return 1;
  return 0;
}

function inferStoryThemes(text) {
  const haystack = String(text || '').toLowerCase();
  const themes = new Set();
  if (/\b(ai|artificial intelligence|generative|model|training data|synthetic|suno|deepfake)\b/.test(haystack)) themes.add('ai');
  if (/\b(rights?|licens(?:e|ing)|copyright|permission|clearance|settlement|infringement|repertoire|royalt(?:y|ies)|opt[-\s]?in)\b/.test(haystack)) themes.add('rights');
  if (/\b(derivative|derivatives|remix|cover|sample|mash[-\s]?up|adaptation|inputs?|outputs?)\b/.test(haystack)) themes.add('derivatives');
  if (/\b(attribution|authorship|provenance|credit|credits|verified|verification|source context)\b/.test(haystack)) themes.add('provenance');
  if (/\b(payment|payments|commerce|compensation|payout|receipt|checkout|subscription|membership|direct[-\s]?to[-\s]?fan|customer)\b/.test(haystack)) themes.add('commerce');
  if (/\b(platform|spotify|youtube|tiktok|streaming|algorithm|distribution|distributor|discovery|blackbox|dependency)\b/.test(haystack)) themes.add('dependency');
  if (/\b(identity|profile|credential|authentication|domain|account verification)\b/.test(haystack)) themes.add('identity');
  if (/\b(counterfeit|fraud|fake|bot|impersonation|scam|unauthorized merch|unauthorized merchandise)\b/.test(haystack)) themes.add('fraud');
  if (/\b(investor|investment|valuation|funding|acquisition|earnings|revenue growth)\b/.test(haystack)) themes.add('finance');
  return themes;
}

function storyThemeScore(source, storyThemes) {
  const haystack = `${source.id} ${source.path} ${source.title} ${source.excerpt}`.toLowerCase();
  let score = 0;
  const match = (theme, value) => {
    if (storyThemes.has(theme)) score += value;
  };
  if (/capabilities\/access|capabilities\/consistency-review|\bright|permission|clearance|license|licensing/i.test(haystack)) match('rights', 8);
  if (/capabilities\/provenance|capabilities\/receipts|release-records|attribution|authorship|proof|verification/i.test(haystack)) match('provenance', 7);
  if (/publishing|release-records|derivative|remix|sample|version/i.test(haystack)) match('derivatives', 6);
  if (/ai|inputs?|outputs?|synthetic|model|machine/i.test(haystack)) match('ai', 5);
  if (/capabilities\/commerce|capabilities\/payments|capabilities\/payouts|commerce|payment|payout|receipt|compensation/i.test(haystack)) match('commerce', 5);
  if (/network-distribution|partner-integrations|platform|distribution|discovery|dependency|routing/i.test(haystack)) match('dependency', 5);
  if (/identity|profiles|credential|account verification|domain/i.test(haystack)) match('identity', 5);
  if (/fraud|fake|bot|counterfeit|impersonation|authenticity/i.test(haystack)) match('fraud', 5);
  if (/investors|investment-thesis|revenue-model|valuation|funding/i.test(haystack)) match('finance', 4);
  return score;
}

function primaryBrainTheme(source, themes) {
  const haystack = `${source.id} ${source.path} ${source.title}`.toLowerCase();
  const specific = [
    ['capabilities/access', 'Permissions and rights'],
    ['capabilities/provenance', 'Provenance and receipts'],
    ['capabilities/receipts', 'Provenance and receipts'],
    ['capabilities/commerce', 'Commerce and payments'],
    ['capabilities/payments', 'Commerce and payments'],
    ['capabilities/payouts', 'Commerce and payments'],
    ['capabilities/network-distribution', 'Network and platform dependency'],
    ['capabilities/partner-integrations', 'Network and platform dependency'],
    ['products/core', 'Capabilities'],
  ];
  for (const [needle, label] of specific) if (haystack.includes(needle)) return label;
  return themes[0]?.label || '';
}

function matchedBrainThemes(source) {
  const haystack = `${source.id} ${source.path} ${source.title} ${source.excerpt}`.toLowerCase();
  return BRAIN_SELECTION_THEMES.filter((theme) => theme.patterns.some((pattern) => pattern.test(haystack)));
}

function selectionReason(source, score, themes, requestedIds, storyThemes = new Set()) {
  const reasons = [];
  if (requestedIds.has(source.id)) reasons.push('requested by trend opportunity');
  if (storyThemes.size) reasons.push(`ranked against source-story themes: ${[...storyThemes].join(', ')}`);
  if (themes.length) reasons.push(`matches ${themes.map((theme) => theme.label).join(', ')}`);
  if (/approved-public-claims|facts|capabilities|products|vocabulary|founder-decisions|investors/.test(source.path)) reasons.push('approved/high-signal Brain path');
  return `${reasons.join('; ') || 'ranked by topic relevance'}; score ${score}`;
}

async function walkMarkdown(dir, onFile) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkMarkdown(full, onFile);
    else if (entry.isFile() && entry.name.endsWith('.md')) await onFile(full);
  }
}

function isSafeBrainText(relative, text) {
  if (SECRET_PATTERN.test(relative)) return false;
  if (SECRET_PATTERN.test(text) && /-----BEGIN|sk-|ghp_|cf-|api key|private key/i.test(text)) return false;
  return true;
}

function extractBrainRecordMetadata(text) {
  const clean = cleanText(text);
  return {
    currentStatus: extractInlineSectionValue(clean, 'Current Status') || inferStatusFromText(clean),
    confidence: extractInlineSectionValue(clean, 'Confidence') || inferConfidenceFromText(clean),
    supportedClaims: [
      ...extractListSection(clean, 'Supported Current Claims'),
      ...extractListSection(clean, 'Current Claims'),
    ].slice(0, 8),
    qualifiedClaims: [
      ...extractListSection(clean, 'Qualified Claims'),
      ...extractListSection(clean, 'Current Limitations'),
      ...extractListSection(clean, 'Limitations'),
    ].slice(0, 8),
    prohibitedClaims: [
      ...extractListSection(clean, 'Prohibited Claims'),
      ...extractListSection(clean, 'Additional Prohibited Claims'),
      ...extractListSection(clean, 'Unsafe Wording'),
    ].slice(0, 8),
    safeWording: [
      ...extractListSection(clean, 'Safe Current Wording'),
      ...extractListSection(clean, 'Safe Wording'),
    ].slice(0, 6),
  };
}

function extractInlineSectionValue(text, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*\\n+([^\\n#]+)`, 'im');
  const value = text.match(pattern)?.[1] || '';
  return value.replace(/[`*_]/g, '').trim().slice(0, 80);
}

function extractListSection(text, heading) {
  const section = extractMarkdownSection(text, heading);
  if (!section) return [];
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractMarkdownSection(text, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
  const match = pattern.exec(text);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function inferStatusFromText(text) {
  const match = text.match(/\b(LIVE|CURRENT|BETA|PLANNED|ROADMAP|UNCLEAR|IMPLEMENTATION-SPECIFIC)\b/i);
  return match ? match[1].toUpperCase() : '';
}

function inferConfidenceFromText(text) {
  const match = text.match(/\b(LOW|MEDIUM|HIGH)\s+confidence\b|\bconfidence\s*[:\-]?\s*(LOW|MEDIUM|HIGH)\b/i);
  return (match?.[1] || match?.[2] || '').toUpperCase();
}

function trimGroundedContext(context, maxChars) {
  context.contextSizing = {
    maxContextChars: maxChars,
    fullContextChars: JSON.stringify(context).length,
    truncated: false,
    removedRecords: [],
    removedContextItems: [],
  };
  let serialized = JSON.stringify(context);
  while (serialized.length > maxChars && context.sourceRecords.length > 8) {
    const removed = context.sourceRecords.pop();
    if (removed) context.contextSizing.removedRecords.push({ id: removed.id, title: removed.title, path: removed.path });
    for (const key of ['approvedClaims', 'productFacts', 'terminology', 'featureStatus', 'prohibitedClaims', 'deprecatedTerminology', 'externalSourceFacts']) {
      if (context[key]?.length) {
        context[key].pop();
        context.contextSizing.removedContextItems.push(key);
      }
    }
    if (context.approvedKnowledge?.length) {
      context.approvedKnowledge.pop();
      context.contextSizing.removedContextItems.push('approvedKnowledge');
    }
    context.contextSizing.truncated = true;
    serialized = JSON.stringify(context);
  }
  if (serialized.length > maxChars) {
    compactOversizedContext(context);
    context.contextSizing.truncated = true;
    serialized = JSON.stringify(context);
  }
  context.contextSizing.finalContextChars = serialized.length;
  return context;
}

function compactOversizedContext(context) {
  const compactSource = (source) => ({
    ...source,
    excerpt: clampText(source.excerpt, 520),
  });
  context.sourceRecords = (context.sourceRecords || []).map(compactSource);
  context.approvedKnowledge = (context.approvedKnowledge || []).map((source) => ({
    ...source,
    excerpt: clampText(source.excerpt, 520),
  }));
  for (const key of ['approvedClaims', 'productFacts', 'terminology', 'featureStatus', 'prohibitedClaims', 'deprecatedTerminology']) {
    context[key] = (context[key] || []).slice(0, 6).map((item) => clampText(item, 260));
  }
  context.externalSourceFacts = (context.externalSourceFacts || []).slice(0, 4).map((source) => ({
    ...source,
    summary: clampText(source.summary, 320),
  }));
}

async function readRelatedArticles(siteRoot) {
  const dir = path.join(siteRoot, 'content', 'blog');
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter((file) => file.endsWith('.md')).map((file) => file.replace(/\.md$/, '')).slice(0, 12);
}

function detectProhibitedLanguage(bodyMarkdown) {
  const warnings = [];
  const risky = [
    'permanent records',
    'permanent record',
    'complete creator ownership',
    'ownership of audience relationships',
    'ownership of creative rights',
    'royalty management',
    'legal guarantee',
    'guaranteed payouts',
  ];
  for (const term of risky) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(bodyMarkdown)) warnings.push(`Review risky or prohibited claim language: ${term}`);
  }
  return warnings;
}

function detectInternalContextLeak(bodyMarkdown) {
  const text = String(bodyMarkdown || '');
  const internalHeadings = [
    'Definition',
    'Source Scope',
    'Approved Certifyd Knowledge',
    'Brain Context',
    'Prompt Instructions',
    'Business Relevance',
    'Core Knowledge Themes',
    'Certifyd Relevance',
    'SOURCE FACTS',
    'CERTIFYD KNOWLEDGE',
    'EDITORIAL ANGLE',
    'WRITING INSTRUCTIONS',
  ];
  const hits = [];
  for (const heading of internalHeadings) {
    const headingPattern = new RegExp(`^\\s{0,3}#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, 'gim');
    const barePattern = new RegExp(`^\\s*${escapeRegExp(heading)}\\s*$`, 'gim');
    if (headingPattern.test(text) || barePattern.test(text)) hits.push(heading);
  }
  const repeatedTemplateSections = text.match(/^\s{0,3}#{1,6}\s+(Definition|Source Scope|Approved Certifyd Knowledge)\s*$/gim) || [];
  if (repeatedTemplateSections.length >= 2) hits.push('repeated internal template sections');
  return [...new Set(hits)];
}

function normalizeOllamaUsage(body) {
  return {
    promptTokens: body.prompt_eval_count,
    completionTokens: body.eval_count,
    totalTokens: Number(body.prompt_eval_count || 0) + Number(body.eval_count || 0),
  };
}

function titleFromMarkdown(relative, text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || relative.replace(/\.md$/, '');
}

function cleanText(text) {
  return String(text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function sourceId(relative) {
  return brainRecordId(relative);
}

function slugify(value) {
  return String(value || 'certifyd-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'certifyd-draft';
}

function createRunId(slug) {
  const suffix = Date.now().toString(36);
  const maxLength = 81;
  const maxSlugLength = Math.max(1, maxLength - suffix.length - 1);
  const base = slugify(slug).slice(0, maxSlugLength).replace(/-+$/g, '') || 'certifyd-draft';
  return `${base}-${suffix}`;
}

function clampText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function redactInput(input) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !SECRET_PATTERN.test(key)));
}

function buildTrendProvenance(input, timestamp, provider, groundedContext = {}) {
  const sourceRecords = Array.isArray(groundedContext.externalSourceFacts) ? groundedContext.externalSourceFacts : [];
  return {
    opportunityId: cleanId(input.trendOpportunityId),
    sourceItemIds: parseIdList(input.trendSourceItemIds, 40),
    sourceUrls: sourceRecords.map((source) => ({
      id: cleanId(source.id),
      sourceTitle: clampText(source.title, 180),
      publisher: clampText(source.publisher, 100),
      publishedAt: clampText(source.publishedAt, 32),
      sourceUrl: safePublicUrl(source.articleUrl),
    })).filter((source) => source.sourceUrl),
    brainRecordIds: parseBrainIdList(input.trendBrainRecordIds, 40),
    generatedAt: timestamp,
    modelProvider: provider.providerName,
    model: provider.modelName,
  };
}

function lowRelevanceSourceWarnings(groundedContext = {}) {
  const sources = Array.isArray(groundedContext.externalSourceFacts) ? groundedContext.externalSourceFacts : [];
  return sources
    .filter((source) => Number(source.certifydRelevanceScore || 0) > 0 && Number(source.certifydRelevanceScore || 0) < 8)
    .map((source) => `Low Certifyd relevance source: ${source.title || source.id}. Founder review should verify the editorial angle.`)
    .slice(0, 4);
}

function parseIdList(value, limit) {
  return String(value || '')
    .split(',')
    .map((item) => cleanId(item))
    .filter(Boolean)
    .slice(0, limit);
}

function parseBrainIdList(value, limit) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim().replace(/\\/g, '/').replace(/\.md$/, '').replace(/[^a-zA-Z0-9:/_-]/g, '').slice(0, 180))
    .filter((item) => item.startsWith('brain:'))
    .slice(0, limit);
}

function cleanId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:._\/-]/g, '')
    .slice(0, 180);
}

function sanitizeLogMessage(message) {
  return String(message).replace(/(?:sk-|ghp_|cf-)[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 600);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
