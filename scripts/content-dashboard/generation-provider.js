import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:1.5b';
const DEFAULT_BLOG_COVER_IMAGE = '/images/certifyd-main-image-independent-scene-20260613.png';
const SAFE_SOURCE_LIMIT = 12;
const MAX_INTERACTIVE_OUTPUT_TOKENS = 900;
const SECRET_PATTERN = /(?:api[_-]?key|secret|token|password|private[_-]?key|session|credential|jwt|bearer|cloudflare|github_app_private_key)/i;
const activeUsers = new Set();
let activeGlobalGenerations = 0;

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
    const title = input.topic || input.workingTitle || 'Certifyd Draft';
    const suggestedSlug = slugify(title);
    const body = [
      `# ${title}`,
      '',
      '> Template-generated draft. Founder review is required before publishing.',
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
    const response = await fetchWithTimeout(this.fetchImpl, `${baseUrl}/api/tags`, { method: 'GET', signal }, this.config.ollama.timeoutMs);
    if (!response.ok) {
      throw new GenerationConfigurationError(`Ollama health check failed with HTTP ${response.status}.`);
    }
    const body = await response.json().catch(() => ({}));
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
      const response = await fetchWithTimeout(this.fetchImpl, `${baseUrl}/api/chat`, {
        method: 'POST',
        signal: abortSignal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          stream: false,
          think: this.config.ollama.think,
          messages: [
            { role: 'system', content: buildSystemInstruction() },
            { role: 'user', content: buildUserPrompt(input, groundedContext) },
          ],
          format: ARTICLE_SCHEMA,
          options: {
            temperature: this.config.ollama.temperature,
            num_predict: this.config.ollama.maxOutputTokens,
          },
        }),
      }, this.config.ollama.timeoutMs);
      if (!response.ok) {
        throw new GenerationConfigurationError(await ollamaErrorMessage(response, this.modelName));
      }
      const body = await response.json().catch(() => ({}));
      const content = String(body?.message?.content || '').trim();
      if (!content) throw new GenerationValidationError('Qwen returned no structured article content.');
      this.lastRequest = {
        durationMs: Date.now() - started,
        tokenUsage: normalizeOllamaUsage(body),
      };
      return validateGeneratedArticle(parseJsonContent(content), groundedContext);
    } catch (error) {
      if (error?.name === 'AbortError' || /aborted due to timeout|timed out|timeout/i.test(error?.message || '')) {
        throw Object.assign(new Error('Qwen generation timed out. Try a shorter prompt or reduce the requested draft size.'), { statusCode: 408 });
      }
      if (error instanceof GenerationConfigurationError || error instanceof GenerationValidationError || error instanceof GenerationRateLimitError) throw error;
      throw Object.assign(new Error(sanitizeLogMessage(error?.message || 'Qwen generation failed.')), { statusCode: 502 });
    } finally {
      leaveGenerationSlot(userKey);
    }
  }
}

export async function buildGroundedContext(config, input) {
  const brainRoot = path.resolve(config.siteRoot, 'content-agent', 'knowledge');
  const sourceRecords = [];
  await walkMarkdown(brainRoot, async (file) => {
    const relative = path.relative(brainRoot, file);
    const text = await fs.readFile(file, 'utf8');
    if (!isSafeBrainText(relative, text)) return;
    sourceRecords.push({
      id: sourceId(relative),
      path: `content-agent/knowledge/${relative}`,
      title: titleFromMarkdown(relative, text),
      excerpt: cleanText(text).slice(0, 1800),
    });
  });
  const selected = selectRelevantSources(sourceRecords, input).slice(0, SAFE_SOURCE_LIMIT);
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
    relatedArticles: await readRelatedArticles(config.siteRoot),
    sourceRecords: selected,
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
  const slug = slugify(value.suggestedSlug);
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
  const sourceIds = new Set(groundedContext.sourceRecords.map((source) => source.id));
  const warnings = [...(value.warnings || []).map(String).map((warning) => warning.trim()).filter(Boolean)];
  const normalizedClaims = [];
  for (const claim of value.claims || []) {
    if (!claim || typeof claim.text !== 'string' || !Array.isArray(claim.sourceIds) || !['supported', 'needs-review'].includes(claim.confidence)) {
      throw new GenerationValidationError('Each generated claim must include text, sourceIds and confidence.');
    }
    const ids = claim.sourceIds.map(String).map((id) => id.trim()).filter(Boolean);
    const missing = ids.filter((id) => !sourceIds.has(id));
    if (missing.length) throw new GenerationValidationError(`Generated claim references unknown Brain source IDs: ${missing.join(', ')}`);
    if (!ids.length) warnings.push(`Unsupported claim needs review: ${claim.text.slice(0, 160)}`);
    normalizedClaims.push({ text: claim.text.trim(), sourceIds: ids, confidence: ids.length ? claim.confidence : 'needs-review' });
  }
  const prohibitedHits = detectProhibitedLanguage(value.bodyMarkdown, groundedContext.prohibitedClaims);
  warnings.push(...prohibitedHits);
  if (/\b(published|approved for publishing|ready to publish|guaranteed|permanent record|legal guarantee|royalty management)\b/i.test(value.bodyMarkdown)) {
    warnings.push('Draft contains language that may require founder, technical, or legal review.');
  }
  if (/\b(live|currently|already)\b/i.test(value.bodyMarkdown) && /\b(planned|roadmap|future|not yet|under development)\b/i.test(JSON.stringify(groundedContext.featureStatus))) {
    warnings.push('Review live/planned feature language before approval.');
  }
  return {
    title: clampText(value.title, 160),
    slug,
    excerpt: clampText(value.excerpt, 260),
    author: 'Certifyd',
    tags: (value.tags || ['Certifyd']).map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
    seoTitle: clampText(value.seoTitle || `${value.title} | Certifyd`, 70),
    seoDescription: clampText(value.seoDescription || value.excerpt, 165),
    coverImage: normalizeBlogCoverImage(value.coverImage),
    bodyMarkdown: value.bodyMarkdown.trim(),
    claims: normalizedClaims,
    warnings: [...new Set(warnings)].slice(0, 30),
    status: 'draft',
  };
}

export async function persistGeneratedArticleRun(config, article, input, groundedContext, provider) {
  const timestamp = new Date().toISOString();
  const runId = `${article.slug}-${Date.now().toString(36)}`;
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
    warnings: article.warnings,
  };
  const unresolvedIssueCount = claimLedger.claims.filter((claim) => claim.status !== 'APPROVED_WITH_SOURCE').length + article.warnings.length;
  const summary = {
    runId,
    title: article.title,
    slug: article.slug,
    version: 'v1',
    status: 'PENDING_FOUNDER_REVIEW',
    publishability: 'BLOCKED_PENDING_APPROVAL',
    canonicalUrl: `https://certifyd.me/blog/${article.slug}/`,
    audience: input.audience || input.targetAudience || '',
    topic: input.topic || input.workingTitle || '',
    contentType: input.contentType || 'article',
    modelProvider: provider.providerName,
    modelMode: provider.supportsLiveGeneration ? 'Local AI' : 'Deterministic fallback',
    unresolvedIssueCount,
    lastUpdated: timestamp,
  };
  await fs.writeFile(path.join(dir, 'intake.json'), JSON.stringify(redactInput(input), null, 2));
  await fs.writeFile(path.join(dir, 'draft.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'drafts', 'v1.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'final-article.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'final', 'article.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'final', 'article.json'), JSON.stringify({ ...article, version: 'v1', status: 'draft', canonicalUrl: summary.canonicalUrl }, null, 2));
  await fs.writeFile(path.join(dir, 'claim-ledger.json'), JSON.stringify(claimLedger, null, 2));
  await fs.writeFile(path.join(dir, 'claim-ledgers', 'v1.json'), JSON.stringify(claimLedger, null, 2));
  await fs.writeFile(path.join(dir, 'research-record.json'), JSON.stringify({ selectedEvidence: groundedContext.sourceRecords, claimsThatMustNotBeMade: groundedContext.prohibitedClaims }, null, 2));
  await fs.writeFile(path.join(dir, 'seo-package.json'), JSON.stringify({ seoTitle: article.seoTitle, metaDescription: article.seoDescription, suggestedSlug: article.slug }, null, 2));
  await fs.writeFile(path.join(dir, 'seo', 'seo-package.json'), JSON.stringify({ seoTitle: article.seoTitle, metaDescription: article.seoDescription, suggestedSlug: article.slug }, null, 2));
  await fs.writeFile(path.join(dir, 'publication-manifest.json'), JSON.stringify({ ...summary, currentStatus: 'PENDING_FOUNDER_REVIEW', publishability: 'BLOCKED_PENDING_APPROVAL', updatedAt: timestamp }, null, 2));
  await fs.writeFile(path.join(dir, 'lifecycle.json'), JSON.stringify({ createdAt: timestamp, updatedAt: timestamp, status: 'PENDING_FOUNDER_REVIEW' }, null, 2));
  await fs.writeFile(path.join(dir, 'reviews', 'founder-review.json'), JSON.stringify({ reviewStatus: 'PENDING_FOUNDER_REVIEW', articleVersion: 'v1', timestamp }, null, 2));
  await fs.writeFile(path.join(dir, 'blog', 'blog-post.md'), articleMarkdown);
  await fs.writeFile(path.join(dir, 'blog', 'blog-post.json'), JSON.stringify({ ...article, status: 'draft' }, null, 2));
  await fs.writeFile(path.join(dir, 'model-requests', 'article-generation.json'), JSON.stringify({
    provider: provider.providerName,
    model: provider.modelName,
    stage: 'article-generation',
    promptTemplateVersion: 'dashboard-ollama-qwen-v1',
    inputHashes: { input: hashJson(redactInput(input)), groundedContext: hashJson(groundedContext) },
    knowledgeEvidenceIds: groundedContext.sourceRecords.map((source) => source.id),
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
    maxOutputTokens: boundedNumber(env.OLLAMA_MAX_OUTPUT_TOKENS, 700, 192, MAX_INTERACTIVE_OUTPUT_TOKENS),
    temperature: boundedNumber(env.OLLAMA_TEMPERATURE, 0.35, 0, 1),
    maxContextChars: boundedNumber(env.OLLAMA_CONTEXT_LIMIT, 4096, 2000, 8000),
    think: env.OLLAMA_THINK === 'true',
    maxConcurrentGenerations: positiveNumber(env.OLLAMA_MAX_CONCURRENT_GENERATIONS, 1),
  };
}

function buildSystemInstruction() {
  return [
    'You are the Certifyd editorial drafting provider running inside an internal dashboard.',
    'Write as the Certifyd editorial team.',
    'Use only the supplied Certifyd Brain evidence for factual company claims.',
    'Do not rely on model memory for Certifyd facts.',
    'Do not invent customers, partnerships, revenue, adoption, launch dates, technical capabilities or legal claims.',
    'Clearly distinguish live, beta and planned features.',
    'Use “network” rather than “platform” when describing Certifyd unless a source explicitly requires another term.',
    'Write naturally, without generic AI filler, repeated conclusions or excessive headings.',
    'Keep drafts concise. Prefer a short outline or compact article body over a long article.',
    'Do not mention this generation process.',
    'Return only JSON matching the supplied schema. Required keys are title, suggestedSlug, excerpt and bodyMarkdown.',
    'Use claims and source IDs only when you are certain they match the supplied Brain evidence.',
    'Put uncertain material in warnings rather than stating it as fact.',
  ].join('\n');
}

function buildUserPrompt(input, groundedContext) {
  return JSON.stringify({
    requestedArticle: {
      topic: input.topic || input.workingTitle,
      audience: input.audience || input.targetAudience,
      objective: input.objective || input.businessObjective,
      writingStyle: input.writingStyle || 'Plain, factual, investor-safe Certifyd editorial.',
      sourceRestrictions: input.sourceRestrictions || 'Use approved Certifyd Brain records only.',
      contentType: input.contentType || 'article',
      channel: input.channel || 'Blog',
    },
    schema: ARTICLE_SCHEMA,
    groundedContext,
  });
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

function normalizeBlogCoverImage(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BLOG_COVER_IMAGE;
  if (!raw.startsWith('/images/')) return DEFAULT_BLOG_COVER_IMAGE;
  if (raw.includes('\\') || raw.includes('..') || /%2f|%5c/i.test(raw)) return DEFAULT_BLOG_COVER_IMAGE;
  return raw;
}

function selectRelevantSources(sources, input) {
  const query = `${input.topic || ''} ${input.objective || ''} ${input.sourceRestrictions || ''}`.toLowerCase();
  const scored = sources.map((source) => {
    const haystack = `${source.path} ${source.title} ${source.excerpt}`.toLowerCase();
    let score = /approved-public-claims|facts|capabilities|products|vocabulary|founder-decisions|investors/.test(source.path) ? 4 : 0;
    for (const term of query.split(/[^a-z0-9]+/).filter((term) => term.length > 3)) {
      if (haystack.includes(term)) score += 1;
    }
    return { source, score };
  });
  return scored.sort((a, b) => b.score - a.score || a.source.path.localeCompare(b.source.path)).map((item) => item.source);
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

function trimGroundedContext(context, maxChars) {
  let serialized = JSON.stringify(context);
  while (serialized.length > maxChars && context.sourceRecords.length > 8) {
    context.sourceRecords.pop();
    for (const key of ['approvedClaims', 'productFacts', 'terminology', 'featureStatus', 'prohibitedClaims', 'deprecatedTerminology']) {
      if (context[key]?.length) context[key].pop();
    }
    serialized = JSON.stringify(context);
  }
  return context;
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

function sourceId(relative) {
  return `brain:${relative.replace(/\\/g, '/').replace(/\.md$/, '').replace(/[^a-zA-Z0-9/_-]+/g, '-').toLowerCase()}`;
}

function slugify(value) {
  return String(value || 'certifyd-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'certifyd-draft';
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

function sanitizeLogMessage(message) {
  return String(message).replace(/(?:sk-|ghp_|cf-)[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 600);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
