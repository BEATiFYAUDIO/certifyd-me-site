import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildGroundedContext,
  createGenerationProvider,
  GenerationConfigurationError,
  GenerationValidationError,
  OllamaQwenGenerationProvider,
  parseJsonContent,
  persistGeneratedArticleRun,
  resetGenerationState,
} from '../scripts/content-dashboard/generation-provider.js';

async function makeConfig(overrides = {}) {
  const siteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'certifyd-provider-'));
  await fs.mkdir(path.join(siteRoot, 'content-agent/knowledge/facts'), { recursive: true });
  await fs.mkdir(path.join(siteRoot, 'content-agent/knowledge/products'), { recursive: true });
  await fs.mkdir(path.join(siteRoot, 'content/blog'), { recursive: true });
  await fs.writeFile(path.join(siteRoot, 'content-agent/knowledge/facts/approved-public-claims.md'), [
    '# Approved Public Claims',
    '',
    'Certifyd Core is the foundational engine for identity, publishing and direct commerce.',
    'Certifyd Network supports discovery, routing and distribution.',
    'Certifyd Fan is a fan-facing discovery and playback application.',
    'Planned capabilities must not be described as live unless source material confirms they are live.',
  ].join('\n'));
  await fs.writeFile(path.join(siteRoot, 'content-agent/knowledge/products/core.md'), [
    '# Certifyd Core',
    '',
    'Certifyd Core runs locally for creator and operator workflows.',
    'Some capabilities are live, beta, planned or implementation-specific.',
  ].join('\n'));
  return {
    siteRoot,
    outputDir: path.join(siteRoot, 'content-agent/engine/outputs'),
    ollama: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:8b',
      timeoutMs: 1000,
      maxOutputTokens: 5000,
      temperature: 0.35,
      maxContextChars: 24000,
      think: false,
      maxConcurrentGenerations: 1,
      ...overrides.ollama,
    },
    ...overrides,
  };
}

async function makeContext(config, input = {}) {
  return buildGroundedContext(config, {
    topic: 'What Certifyd Core Is',
    audience: 'Creators and investors',
    objective: 'Explain Certifyd Core accurately.',
    contentType: 'article',
    ...input,
  });
}

function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function validArticle(sourceId, overrides = {}) {
  return {
    title: 'What Certifyd Core Is',
    suggestedSlug: 'what-certifyd-core-is',
    excerpt: 'A grounded draft explaining Certifyd Core.',
    author: 'Certifyd',
    tags: ['Certifyd', 'creator ownership'],
    seoTitle: 'What Certifyd Core Is | Certifyd',
    seoDescription: 'A grounded draft explaining Certifyd Core.',
    bodyMarkdown: 'Certifyd Core supports identity, publishing and direct commerce.',
    claims: [{ text: 'Certifyd Core supports identity, publishing and direct commerce.', sourceIds: [sourceId], confidence: 'supported' }],
    warnings: [],
    ...overrides,
  };
}

function makeOllamaFetch(article, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
    if (String(url).endsWith('/api/chat')) return mockResponse({
      message: { content: JSON.stringify(article) },
      prompt_eval_count: 100,
      eval_count: 200,
    });
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test('deterministic provider remains available offline', async () => {
  const config = await makeConfig({ ollama: { enabled: false } });
  const context = await makeContext(config);
  const provider = createGenerationProvider(config, { provider: 'deterministic' });
  const article = await provider.generateArticle({ topic: 'Core Explainer', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.equal(article.status, 'draft');
  assert.equal(provider.providerName, 'deterministic');
});

test('Ollama health reports missing model without auto-download', async () => {
  const config = await makeConfig();
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async () => mockResponse({ models: [{ name: 'llama3.1:8b' }] }),
  });
  const health = await provider.healthCheck();
  assert.deepEqual(health, { enabled: true, reachable: true, model: 'qwen3:8b', modelInstalled: false });
});

test('Ollama health fails safely when unreachable', async () => {
  const config = await makeConfig();
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    },
  });
  await assert.rejects(() => provider.healthCheck(), /ECONNREFUSED/);
});

test('successful Qwen response creates draft engine output and never publishes', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: makeOllamaFetch(validArticle(sourceId)) });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  const result = await persistGeneratedArticleRun(config, article, { topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context, provider);
  const manifest = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'publication-manifest.json'), 'utf8'));
  const finalArticle = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'final/article.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PENDING_FOUNDER_REVIEW');
  assert.equal(manifest.publishability, 'BLOCKED_PENDING_APPROVAL');
  assert.equal(finalArticle.status, 'draft');
});

test('model cannot set publication, approval or GitHub state', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id, { status: 'published' })),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    GenerationValidationError,
  );
});

test('malformed Qwen JSON is rejected', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
      return mockResponse({ message: { content: '{not-json' } });
    },
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /malformed JSON/,
  );
});

test('Qwen JSON parser accepts fenced and prefixed JSON responses', () => {
  assert.deepEqual(parseJsonContent('```json\n{"title":"A"}\n```'), { title: 'A' });
  assert.deepEqual(parseJsonContent('<think>drafting</think>\nHere is the JSON:\n{"title":"B"}\nDone.'), { title: 'B' });
});

test('generated article cover image is persisted when safe', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, { coverImage: '/images/certifyd-tab-icon.svg' })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  const result = await persistGeneratedArticleRun(config, article, { topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context, provider);
  const markdown = await fs.readFile(path.join(config.outputDir, result.runId, 'final/article.md'), 'utf8');
  assert.ok(markdown.includes('coverImage: "/images/certifyd-tab-icon.svg"'));
});

test('unsafe generated cover image falls back to default site image', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, { coverImage: 'https://evil.example/tracker.png' })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.equal(article.coverImage, '/images/certifyd-main-image-independent-scene-20260613.png');
});

test('invented Brain source IDs are rejected', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle('brain:made-up-source')),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /unknown Brain source IDs/,
  );
});

test('unsupported claims and risky wording are preserved as warnings', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id, {
      bodyMarkdown: 'Certifyd creates a permanent record for every creator.',
      claims: [{ text: 'Certifyd has a broad creator business model.', sourceIds: [], confidence: 'needs-review' }],
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.match(article.warnings.join('\n'), /Unsupported claim needs review/);
  assert.match(article.warnings.join('\n'), /permanent record/);
});

test('local AI generation is disabled unless explicitly enabled', async () => {
  const config = await makeConfig({ ollama: { enabled: false } });
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id)) });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /Local AI is disabled/,
  );
});

test('browser input cannot override the configured Ollama URL', async () => {
  const calls = [];
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id), calls) });
  await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'Core',
    audience: 'Creators',
    objective: 'Explain Core.',
    ollamaBaseUrl: 'https://evil.example',
  }, context);
  assert.ok(calls.every((call) => call.url.startsWith('http://127.0.0.1:11434/')));
});

test('one active local generation per user is enforced', async () => {
  resetGenerationState();
  const config = await makeConfig();
  const context = await makeContext(config);
  let release;
  let markChatStarted;
  const chatStarted = new Promise((resolve) => { markChatStarted = resolve; });
  const firstFetch = async (url) => {
    if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
    markChatStarted();
    await new Promise((resolve) => { release = resolve; });
    return mockResponse({ message: { content: JSON.stringify(validArticle(context.sourceRecords[0].id)) } });
  };
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: firstFetch });
  const first = provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core 2', audience: 'Creators', objective: 'Explain Core.' }, context),
    /already has an active generation/,
  );
  await chatStarted;
  release();
  await first;
  resetGenerationState();
});

test('no approved Brain context stops generation before any provider call', async () => {
  const config = await makeConfig();
  await fs.rm(path.join(config.siteRoot, 'content-agent/knowledge'), { recursive: true, force: true });
  const context = await buildGroundedContext(config, { topic: 'Empty', audience: 'Creators', objective: 'Explain.' });
  const provider = createGenerationProvider(config, { provider: 'deterministic' });
  await assert.rejects(
    () => provider.generateArticle({ topic: 'Empty', audience: 'Creators', objective: 'Explain.' }, context),
    GenerationConfigurationError,
  );
});
