import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildGroundedContext,
  createDeterministicFallbackArticle,
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
  const agentRoot = path.join(siteRoot, 'content-agent');
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
    agentRoot,
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

test('deterministic source-backed fallback creates a real article from source facts', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-bmg-suno',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'BMG and Suno Reach Licensing Deal for AI Music Model',
      summary: 'BMG and Suno reached a licensing agreement covering creator opt-in for AI inputs and outputs, compensation for participating artists and songwriters, derivative works and settlement of prior use.',
      articleUrl: 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/',
      categories: ['Music', 'AI'],
      certifydRelevanceScore: 16,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    trendSourceItemIds: 'source-bmg-suno',
  });
  const article = await createDeterministicFallbackArticle({
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    audience: 'Creators',
    objective: 'Explain the source facts and Certifyd relevance.',
    trendSourceItemIds: 'source-bmg-suno',
  }, context, 'Qwen timed out');

  assert.match(article.bodyMarkdown, /BMG and Suno reached a licensing agreement/i);
  assert.match(article.bodyMarkdown, /creator opt-in/i);
  assert.match(article.bodyMarkdown, /permissions|creator control|provenance|attribution|compensation/i);
  assert.doesNotMatch(article.bodyMarkdown, /Source Scope|Approved Certifyd Knowledge|Business Relevance|Core Knowledge Themes|Certifyd Relevance/);
  assert.doesNotMatch(article.bodyMarkdown, /integrating Certifyd|through Certifyd|using Certifyd/i);
  assert.match(article.warnings.join('\n'), /Qwen timed out/);
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
  const researchRecord = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'research-record.json'), 'utf8'));
  assert.equal(manifest.currentStatus, 'PENDING_FOUNDER_REVIEW');
  assert.equal(manifest.publishability, 'BLOCKED_PENDING_APPROVAL');
  assert.equal(finalArticle.status, 'draft');
  assert.ok(Array.isArray(researchRecord.selectedEvidence));
  assert.equal(researchRecord.selectedEvidence[0].id, sourceId);
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

test('malformed Qwen JSON is recovered into a review-only draft', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
      return mockResponse({ message: { content: '{"title": "Bot Farming and Certifyd", "bodyMarkdown": "Certifyd can help creators focus on commerce instead of fake engagement."' } });
    },
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'why certifyd is a good solution to bot farming', audience: 'Creators', objective: 'Explain clearly.' }, context);
  assert.equal(article.status, 'draft');
  assert.match(article.title, /Bot Farming|certifyd/i);
  assert.match(article.warnings.join('\n'), /malformed JSON|recovered/i);
});

test('stalled Qwen response body fails with timeout instead of hanging', async () => {
  const config = await makeConfig();
  config.ollama.timeoutMs = 25;
  config.ollama.healthTimeoutMs = 25;
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"message":{"content":'));
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /timed out while waiting for the local model response/i,
  );
});

test('Qwen JSON parser accepts fenced and prefixed JSON responses', () => {
  assert.deepEqual(parseJsonContent('```json\n{"title":"A"}\n```'), { title: 'A' });
  assert.deepEqual(parseJsonContent('<think>drafting</think>\nHere is the JSON:\n{"title":"B"}\nDone.'), { title: 'B' });
});

test('Qwen JSON missing generated helper fields is completed safely', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch({
      title: 'Bot Farming and Real Creator Commerce',
      bodyMarkdown: 'Certifyd should be discussed as a way to emphasize real customer activity, direct commerce and attribution instead of fake engagement metrics.',
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'bot farming', audience: 'Creators', objective: 'Explain the issue.' }, context);
  assert.equal(article.slug, 'bot-farming-and-real-creator-commerce');
  assert.match(article.excerpt, /real customer activity/);
  assert.equal(article.author, 'Certifyd');
});

test('Qwen JSON without an article body becomes a review-only placeholder draft', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch({
      title: 'Bot Farming and Certifyd',
      excerpt: 'A draft about fake engagement and real customer activity.',
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'bot farming', audience: 'Creators', objective: 'Explain the issue.' }, context);
  assert.equal(article.slug, 'bot-farming-and-certifyd');
  assert.match(article.bodyMarkdown, /did not return a usable article body/i);
  assert.match(article.warnings.join('\n'), /without a usable bodyMarkdown/i);
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

test('unsafe generated cover image falls back to automatic safe cover', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, { coverImage: 'https://evil.example/tracker.png' })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.equal(article.coverImage, '/images/creator-commerce-raw-20260601-edgefix.jpeg');
});

test('missing generated cover image is selected automatically from topic signals', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'AI Music Streaming and Creator Rights',
      tags: ['music', 'AI'],
      coverImage: '',
      bodyMarkdown: 'AI music streaming raises questions about artists, licensing and royalties.',
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'AI music streaming', audience: 'Creators', objective: 'Explain the issue.' }, context);
  assert.equal(article.coverImage, '/images/ip-publishing-creators-20260605.jpeg');
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

test('unsupported generated claims are rejected', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id, {
      bodyMarkdown: 'Certifyd creates a permanent record for every creator.',
      claims: [{ text: 'Certifyd has a broad creator business model.', sourceIds: [], confidence: 'needs-review' }],
    })),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /no approved Brain evidence/,
  );
});

test('risky wording is preserved as warnings when claims have evidence', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      bodyMarkdown: 'Certifyd creates a permanent record for every creator.',
      claims: [{ text: 'Certifyd has a broad creator business model.', sourceIds: [sourceId], confidence: 'supported' }],
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.match(article.warnings.join('\n'), /permanent record/);
});

test('generation cleanup repairs brand drift and flags provenance overclaims', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      bodyMarkdown: [
        '# Provenance Draft',
        '',
        'Certified by Design (Certifyd) helps creators avoid platform reporting.',
        '',
        'Creators can prove ownership and prove authorship with legitimate proof.',
      ].join('\n'),
      claims: [{ text: 'Certifyd supports creator commerce context.', sourceIds: [sourceId], confidence: 'supported' }],
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Provenance', audience: 'Creators', objective: 'Explain carefully.' }, context);
  assert.doesNotMatch(article.bodyMarkdown, /Certified by Design/i);
  assert.match(article.bodyMarkdown, /Certifyd/);
  assert.match(article.warnings.join('\n'), /prove ownership|prove authorship|legitimate proof/);
});

test('external company Certifyd adoption claims are rejected', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  context.externalSourceFacts = [{
    id: 'umg-buyback',
    publisher: 'Music Business Worldwide',
    publishedAt: '2026-08-01',
    title: 'Universal Music Group Completes Share Buyback',
    summary: 'Universal Music Group completed a share buyback. The source facts do not mention Certifyd.',
    articleUrl: 'https://example.test/umg-buyback',
  }];
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Universal Music Group Completes Share Buyback',
      bodyMarkdown: 'By leveraging Certifyd’s platform, Universal Music Group creates a more direct path for creators.',
      claims: [{ text: 'Certifyd supports creator commerce context.', sourceIds: [sourceId], confidence: 'supported' }],
    })),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Universal Music Group share buyback', audience: 'Creators', objective: 'Explain relevance.' }, context),
    /unsupported external Certifyd adoption claims/i,
  );
});

test('generic Certifyd capability wording is not treated as external adoption without source facts', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Direct Fan Commerce',
      suggestedSlug: 'direct-fan-commerce',
      bodyMarkdown: 'With Certifyd capabilities, creators can describe direct fan commerce and audience relationships without depending entirely on platform reporting.',
      claims: [{ text: 'Certifyd connects publishing, discovery, and direct creator-to-fan commerce.', sourceIds: [sourceId], confidence: 'supported' }],
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Direct fan commerce', audience: 'Creators', objective: 'Explain Certifyd relevance.' }, context);
  assert.equal(article.status, 'draft');
  assert.match(article.bodyMarkdown, /direct fan commerce/i);
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

test('bot farming prompts are sent to Qwen with explicit anti-fraud guardrails', async () => {
  const calls = [];
  const config = await makeConfig();
  const prompt = 'write a blog explain why certifyd is a good solution to bot farming';
  const context = await makeContext(config, { topic: prompt, objective: 'Explain the business issue clearly.' });
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id), calls) });
  await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: prompt,
    audience: 'Creators',
    objective: 'Explain the business issue clearly.',
  }, context);

  const chatCall = calls.find((call) => call.url.endsWith('/api/chat'));
  const payload = JSON.parse(chatCall.options.body);
  const outboundPrompt = JSON.stringify(payload.messages);
  assert.match(outboundPrompt, /not enabling automation/i);
  assert.match(outboundPrompt, /Do not say Certifyd creates, manages, controls, monitors or secures bot farms/i);
  assert.match(outboundPrompt, /real customer activity/i);
});

test('plain Certifyd explainer prompts do not force source-story framing', async () => {
  const calls = [];
  const config = await makeConfig();
  const context = await makeContext(config, { topic: 'Direct fan commerce', objective: 'Explain the Certifyd business problem.' });
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id), calls) });
  await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'Direct fan commerce',
    audience: 'Creators',
    objective: 'Explain the Certifyd business problem.',
  }, context);

  const chatCall = calls.find((call) => call.url.endsWith('/api/chat'));
  const payload = JSON.parse(chatCall.options.body);
  const outboundPrompt = JSON.stringify(payload.messages);
  assert.match(outboundPrompt, /No external source story is attached/i);
  assert.match(outboundPrompt, /Start with the Certifyd business problem/i);
  assert.doesNotMatch(outboundPrompt, /Start with the source facts as the news\/business story/i);
});

test('trend source summaries are included separately from Certifyd Brain context', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-article-1',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-08-01T10:00:00.000Z',
      title: 'Label revenue rises as direct fan activity grows',
      summary: 'A music business article reports higher recorded music revenue and discusses direct fan relationships.',
      articleUrl: 'https://example.test/music-business-story',
    }],
    opportunities: [{
      id: 'opp-music-1',
      sourceItemIds: ['source-article-1'],
    }],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Label revenue and creator commerce',
    trendOpportunityId: 'opp-music-1',
    trendSourceItemIds: 'source-article-1',
  });
  assert.equal(context.externalSourceFacts.length, 1);
  const provider = new OllamaQwenGenerationProvider(config, { fetchImpl: makeOllamaFetch(validArticle(context.sourceRecords[0].id), calls) });
  const generatedArticle = await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'Label revenue and creator commerce',
    audience: 'Creators',
    objective: 'Explain the external business news and Certifyd relevance.',
    trendOpportunityId: 'opp-music-1',
    trendSourceItemIds: 'source-article-1',
  }, context);

  const generationResult = await persistGeneratedArticleRun(config, generatedArticle, {
    actorEmail: 'writer@example.test',
    topic: 'Label revenue and creator commerce',
    audience: 'Creators',
    objective: 'Explain the external business news and Certifyd relevance.',
    trendOpportunityId: 'opp-music-1',
    trendSourceItemIds: 'source-article-1',
  }, context, provider);

  const chatCall = calls.find((call) => call.url.endsWith('/api/chat'));
  const payload = JSON.parse(chatCall.options.body);
  const outboundPrompt = JSON.stringify(payload.messages);
  assert.doesNotMatch(outboundPrompt, /about half of the draft about the external business\/news facts/i);
  assert.match(outboundPrompt, /external story is the factual foundation/i);
  assert.match(outboundPrompt, /Facts from the source story/i);
  assert.match(outboundPrompt, /Internal editorial brief/i);
  assert.match(outboundPrompt, /Music Business Worldwide/i);
  assert.match(outboundPrompt, /Label revenue rises as direct fan activity grows/i);
  assert.ok(outboundPrompt.indexOf('Facts from the source story') < outboundPrompt.indexOf('Internal editorial brief'));
  assert.ok(outboundPrompt.indexOf('Internal editorial brief') < outboundPrompt.indexOf('Approved Certifyd context'));
  const researchRecord = JSON.parse(await fs.readFile(path.join(config.outputDir, generationResult.runId, 'research-record.json'), 'utf8'));
  assert.deepEqual(researchRecord.trendProvenance.sourceUrls, [{
    id: 'source-article-1',
    sourceTitle: 'Label revenue rises as direct fan activity grows',
    publisher: 'Music Business Worldwide',
    publishedAt: '2026-08-01',
    sourceUrl: 'https://example.test/music-business-story',
  }]);
  assert.ok(researchRecord.generationDiagnostics.brainSourcesScanned >= 2);
  assert.ok(researchRecord.generationDiagnostics.brainRecordsSelected.length >= 2);
  assert.ok(researchRecord.generationDiagnostics.brainRecordsSentToModel.length >= 2);
  assert.equal(researchRecord.generationDiagnostics.brainSelectionStage, 'after-editorial-brief');
  assert.equal(researchRecord.generationDiagnostics.originalSourceArticlesRetrieved.length, 1);
  assert.ok(researchRecord.generationDiagnostics.verifiedFactsExtracted.length >= 2);
  assert.match(researchRecord.generationDiagnostics.editorialThesisGenerated, /Label revenue rises as direct fan activity grows|creator commerce/i);
  assert.match(outboundPrompt, /Approved Certifyd context/i);
  assert.match(outboundPrompt, /Editorial angle/i);
  assert.match(outboundPrompt, /Instructions for the draft/i);
  const userPrompt = payload.messages.find((message) => message.role === 'user')?.content || '';
  assert.ok(userPrompt.length < 7000, `Qwen prompt should stay compact enough for local Qwen, got ${userPrompt.length} chars`);
});

test('news-like article generation without original source evidence is blocked before Brain-only drafting', async () => {
  const config = await makeConfig();
  await assert.rejects(
    () => makeContext(config, {
      topic: 'Authentic Brands Group Acquires Majority Stake in IP of Drake’s OVO Brand',
      objective: 'Write a Certifyd Blog article about the acquisition and why it matters for creator IP.',
    }),
    /Cannot generate news article — attach at least one original article URL with a source summary before generation\./,
  );
});

test('source-first generation limits Brain records to the editorial thesis instead of generic context', async () => {
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/capabilities/access.md', '# Access\n\nAPPROVED\n\nCertifyd access records help describe permissions and creator-controlled access decisions.'],
    ['content-agent/knowledge/capabilities/provenance.md', '# Provenance\n\nAPPROVED\n\nCertifyd provenance records help connect work, attribution, permissions and publication context.'],
    ['content-agent/knowledge/capabilities/publishing.md', '# Publishing\n\nAPPROVED\n\nCertifyd publishing context can connect releases, derivative works, credits and rights-clearance review.'],
    ['content-agent/knowledge/capabilities/commerce.md', '# Commerce\n\nAPPROVED\n\nCertifyd supports direct creator commerce context and owned customer relationships.'],
    ['content-agent/knowledge/capabilities/payments.md', '# Payments\n\nAPPROVED\n\nCertifyd payment records can support transaction context where payment workflows are configured.'],
    ['content-agent/knowledge/capabilities/analytics.md', '# Analytics\n\nAPPROVED\n\nCertifyd analytics can help review activity.'],
    ['content-agent/knowledge/capabilities/payouts.md', '# Payouts\n\nAPPROVED\n\nCertifyd payout records can help configured payment workflows.'],
    ['content-agent/knowledge/capabilities/fan.md', '# Fan\n\nAPPROVED\n\nCertifyd Fan is a fan-facing discovery and playback app.'],
    ['content-agent/knowledge/capabilities/awards.md', '# Awards\n\nAPPROVED\n\nCertifyd Awards recognizes creator work.'],
    ['content-agent/knowledge/investors/investment-thesis.md', '# Investment Thesis\n\nAPPROVED\n\nCertifyd has investor-facing business-model materials.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'ip-acquisition-story',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-08-28T09:00:00.000Z',
      title: 'Authentic Brands Group Acquires Majority Stake in OVO Brand IP',
      summary: 'A report says Authentic Brands Group acquired a majority stake in Drake’s OVO brand intellectual property, including brand rights and licensing interests.',
      articleUrl: 'https://example.test/abg-ovo-ip',
      categories: ['Music', 'Rights', 'Creator IP'],
      certifydRelevanceScore: 12,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Authentic Brands Group Acquires Majority Stake in OVO Brand IP',
    objective: 'Explain the source facts and creator-owned IP angle.',
    sourceRestrictions: 'Relevant approved Brain records: brain:capabilities/access,brain:capabilities/provenance,brain:capabilities/publishing,brain:capabilities/commerce,brain:capabilities/payments,brain:capabilities/analytics,brain:capabilities/payouts,brain:capabilities/fan,brain:capabilities/awards,brain:investors/investment-thesis.',
    trendBrainRecordIds: 'brain:capabilities/access,brain:capabilities/provenance,brain:capabilities/publishing,brain:capabilities/commerce,brain:capabilities/payments,brain:capabilities/analytics,brain:capabilities/payouts,brain:capabilities/fan,brain:capabilities/awards,brain:investors/investment-thesis',
    trendSourceItemIds: 'ip-acquisition-story',
  });
  const selectedIds = context.sourceRecords.map((source) => source.id);
  assert.ok(selectedIds.length <= 6);
  assert.ok(selectedIds.includes('brain:capabilities/provenance'));
  assert.ok(selectedIds.includes('brain:capabilities/access') || selectedIds.includes('brain:capabilities/publishing'));
  assert.ok(context.generationDiagnostics.brainRecordsSelected.every((record) => /after|source-story|rights|provenance|finance|creator-owned|ranked/i.test(record.selectionReason)));
  assert.equal(context.generationDiagnostics.brainSelectionStage, 'after-editorial-brief');
  assert.match(context.editorialBrief.possibleThesis, /creative IP|creator permission|provenance|compensation|ownership|rights/i);
});

test('retained source story generation creates a normal review draft with source provenance', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-retained-1',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-08-03T10:00:00.000Z',
      title: 'Creators test direct fan commerce after platform policy shifts',
      summary: 'A source story reports on creator commerce, direct fan relationships and platform dependency.',
      articleUrl: 'https://example.test/retained-source-story',
      categories: ['Music', 'Creator Commerce'],
      certifydRelevanceScore: 6,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Creators test direct fan commerce after platform policy shifts',
    trendSourceItemIds: 'source-retained-1',
  });
  const provider = createGenerationProvider(config, { provider: 'deterministic' });
  const article = await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'Creators test direct fan commerce after platform policy shifts',
    audience: 'Creators',
    objective: 'Explain the external business news and Certifyd relevance.',
    trendSourceItemIds: 'source-retained-1',
  }, context);
  const result = await persistGeneratedArticleRun(config, article, {
    actorEmail: 'writer@example.test',
    topic: 'Creators test direct fan commerce after platform policy shifts',
    audience: 'Creators',
    objective: 'Explain the external business news and Certifyd relevance.',
    trendSourceItemIds: 'source-retained-1',
  }, context, provider);
  const researchRecord = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'research-record.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'publication-manifest.json'), 'utf8'));
  const claimLedger = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'claim-ledger.json'), 'utf8'));

  assert.deepEqual(researchRecord.trendProvenance.sourceUrls, [{
    id: 'source-retained-1',
    sourceTitle: 'Creators test direct fan commerce after platform policy shifts',
    publisher: 'Music Business Worldwide',
    publishedAt: '2026-08-03',
    sourceUrl: 'https://example.test/retained-source-story',
  }]);
  assert.equal(manifest.currentStatus, 'PENDING_FOUNDER_REVIEW');
  assert.equal(manifest.publishability, 'BLOCKED_PENDING_APPROVAL');
  assert.match(claimLedger.warnings.join('\n'), /Low Certifyd relevance source/i);
});

test('Brain retrieval prioritizes rights and provenance over generic payments for AI licensing stories', async () => {
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/capabilities/access.md', '# Access\n\n## Current Status\n`BETA`\n\n## Confidence\n`MEDIUM`\n\n## Supported Current Claims\n- Certifyd access records help describe permissions and creator-controlled access decisions.'],
    ['content-agent/knowledge/capabilities/provenance.md', '# Provenance\n\n## Current Status\n`UNCLEAR`\n\n## Confidence\n`LOW`\n\n## Qualified Claims\n- Provenance may be discussed as a rights and attribution context when framed carefully.'],
    ['content-agent/knowledge/capabilities/publishing.md', '# Publishing\n\nAPPROVED\n\nCertifyd publishing context can connect releases, derivative works, credits and rights-clearance review.'],
    ['content-agent/knowledge/capabilities/commerce.md', '# Commerce\n\nAPPROVED\n\nCertifyd supports direct creator commerce context and owned customer relationships.'],
    ['content-agent/knowledge/capabilities/payments.md', '# Payments\n\nAPPROVED\n\nCertifyd payment records can support transaction context where payment workflows are configured.'],
    ['content-agent/knowledge/investors/investment-thesis.md', '# Investment Thesis\n\nAPPROVED\n\nCertifyd has investor-facing business-model materials.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'billboard-bmg-suno-ranking',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'BMG and Suno Reach Licensing Deal for AI Music Model',
      summary: 'Billboard reports that BMG and Suno reached a licensing agreement involving creator opt-in, AI inputs and outputs, derivative works, compensation and settlement of prior use.',
      articleUrl: 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/',
      categories: ['Music', 'AI', 'Rights'],
      certifydRelevanceScore: 13,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    objective: 'Explain creator opt-in, licensing, derivative works, compensation and rights clearance without inventing adoption.',
    sourceRestrictions: 'Relevant approved Brain records: brain:capabilities/access,brain:capabilities/provenance,brain:capabilities/publishing,brain:capabilities/payments,brain:investors/investment-thesis.',
    trendBrainRecordIds: 'brain:capabilities/access,brain:capabilities/provenance,brain:capabilities/publishing,brain:capabilities/payments,brain:investors/investment-thesis',
    trendSourceItemIds: 'billboard-bmg-suno-ranking',
  });
  const selectedIds = context.sourceRecords.map((source) => source.id);
  assert.ok(selectedIds.includes('brain:capabilities/access'));
  assert.ok(selectedIds.includes('brain:capabilities/provenance'));
  assert.ok(selectedIds.includes('brain:capabilities/publishing'));
  assert.ok(selectedIds.indexOf('brain:capabilities/access') < selectedIds.indexOf('brain:capabilities/payments'));
  assert.equal(selectedIds.includes('brain:investors/investment-thesis'), false);
  assert.ok(context.approvedKnowledge.some((record) => /Permissions and rights/.test(record.theme)));
  assert.ok(context.approvedKnowledge.some((record) => /Provenance/.test(record.theme)));
  const accessRecord = context.approvedKnowledge.find((record) => record.id === 'brain:capabilities/access');
  const provenanceRecord = context.approvedKnowledge.find((record) => record.id === 'brain:capabilities/provenance');
  assert.equal(accessRecord.currentStatus, 'BETA');
  assert.equal(accessRecord.confidence, 'MEDIUM');
  assert.deepEqual(accessRecord.supportedClaims, ['Certifyd access records help describe permissions and creator-controlled access decisions.']);
  assert.equal(provenanceRecord.currentStatus, 'UNCLEAR');
  assert.equal(provenanceRecord.confidence, 'LOW');
  assert.deepEqual(provenanceRecord.qualifiedClaims, ['Provenance may be discussed as a rights and attribution context when framed carefully.']);
  assert.ok(context.generationDiagnostics.brainRecordsSelected.every((record) => record.selectionReason));
});

test('source story generation keeps BMG Suno article coherent without internal context leakage', async () => {
  const calls = [];
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/capabilities/access.md', '# Access\n\nAPPROVED\n\nCertifyd access records help describe permissions, creator opt-in and creator-controlled access decisions.'],
    ['content-agent/knowledge/capabilities/provenance.md', '# Provenance\n\nAPPROVED\n\nCertifyd provenance records help connect work, attribution, permissions and publication context.'],
    ['content-agent/knowledge/capabilities/commerce.md', '# Commerce\n\nAPPROVED\n\nCertifyd supports direct creator commerce context, compensation pathways and owned customer relationships where configured.'],
    ['content-agent/knowledge/capabilities/payments.md', '# Payments\n\nAPPROVED\n\nCertifyd payment records can support transaction context where payment workflows are configured.'],
    ['content-agent/knowledge/capabilities/publishing.md', '# Publishing\n\nAPPROVED\n\nCertifyd publishing context can connect releases, derivative works, credits and rights-clearance review.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'billboard-bmg-suno',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'BMG and Suno Reach Licensing Deal for AI Music Model',
      summary: 'Billboard reports that BMG and Suno reached a licensing agreement covering creator opt-in for AI inputs and outputs, compensation for participating artists and songwriters, derivative works, and settlement of prior use.',
      articleUrl: 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/',
      categories: ['Music', 'AI', 'Creator Commerce'],
      certifydRelevanceScore: 13,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    objective: 'Explain the source facts and relevant Certifyd angle around permissions, creator control, derivative works, attribution and compensation.',
    trendSourceItemIds: 'billboard-bmg-suno',
  });
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'BMG and Suno Show Why AI Music Licensing Needs Creator Choice',
      suggestedSlug: 'bmg-suno-ai-music-licensing-creator-choice',
      excerpt: 'A grounded look at BMG and Suno’s licensing agreement and why creator opt-in, compensation and derivative-work permissions matter.',
      bodyMarkdown: [
        '# BMG and Suno Show Why AI Music Licensing Needs Creator Choice',
        '',
        'Billboard reports that BMG and Suno reached a licensing agreement for an AI music model after earlier disputes over prior use.',
        '',
        '## What the deal puts on the table',
        '',
        'The reported agreement centers on creator opt-in for AI inputs and outputs, compensation for participating artists and songwriters, derivative works and settlement of prior use.',
        '',
        '## Why this matters for creator control',
        '',
        'The business signal is not just that AI music deals are happening. It is that permission, attribution, rights clearance and compensation have to be explicit when creative work becomes training input, output or derivative material.',
        '',
        '## The Certifyd relevance',
        '',
        'Certifyd’s approved knowledge points to provenance, permissions, publishing context and commerce records as useful infrastructure for creator-owned decision making. That makes this kind of licensing story relevant without implying any adoption by BMG or Suno.',
      ].join('\n'),
      claims: [{ text: 'Certifyd provenance records help connect work, attribution, permissions and publication context.', sourceIds: [sourceId], confidence: 'supported' }],
    }), calls),
  });
  const article = await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    audience: 'Creators',
    objective: 'Explain the source facts and relevant Certifyd angle.',
    trendSourceItemIds: 'billboard-bmg-suno',
  }, context);
  const result = await persistGeneratedArticleRun(config, article, {
    actorEmail: 'writer@example.test',
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    audience: 'Creators',
    objective: 'Explain the source facts and relevant Certifyd angle.',
    trendSourceItemIds: 'billboard-bmg-suno',
  }, context, provider);

  const chatCall = calls.find((call) => call.url.endsWith('/api/chat'));
  const payload = JSON.parse(chatCall.options.body);
  const outboundPrompt = JSON.stringify(payload.messages);
  assert.match(outboundPrompt, /Facts from the source story/i);
  assert.match(outboundPrompt, /Approved Certifyd context/i);
  assert.match(outboundPrompt, /Editorial angle/i);
  assert.match(outboundPrompt, /Instructions for the draft/i);
  assert.doesNotMatch(outboundPrompt, /^SOURCE FACTS$/im);
  assert.doesNotMatch(outboundPrompt, /^CERTIFYD FACTS$/im);
  assert.doesNotMatch(outboundPrompt, /^EDITORIAL ANGLE$/im);
  assert.doesNotMatch(outboundPrompt, /^WRITING INSTRUCTIONS$/im);
  assert.equal(payload.options.num_predict, 1200);
  assert.equal(payload.options.num_ctx, 24000);
  assert.match(outboundPrompt, /\[billboard-bmg-suno\]/i);
  assert.match(outboundPrompt, /BMG and Suno Reach Licensing Deal/i);
  assert.match(outboundPrompt, /https:\/\/www\.billboard\.com\/pro\/bmg-suno-licensing-deal-ai-music-model\//);
  assert.doesNotMatch(article.bodyMarkdown, /^(#{1,6}\s+)?(Definition|Source Scope|Approved Certifyd Knowledge|Brain Context|Prompt Instructions)\s*$/im);
  assert.match(article.bodyMarkdown, /BMG and Suno/i);
  assert.match(article.bodyMarkdown, /creator opt-in/i);
  assert.match(article.bodyMarkdown, /compensation/i);
  assert.match(article.bodyMarkdown, /derivative works/i);
  assert.ok(context.approvedKnowledge.some((record) => /Permissions and rights|Commerce and payments|Provenance/i.test(record.theme)));
  const researchRecord = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'research-record.json'), 'utf8'));
  assert.equal(researchRecord.trendProvenance.sourceUrls[0].sourceUrl, 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/');
  assert.equal(researchRecord.generationDiagnostics.externalArticleSourcesSentToModel[0].articleUrl, 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/');
  assert.equal(researchRecord.generationDiagnostics.selectedSourceCount, 1);
  assert.equal(researchRecord.generationDiagnostics.externalSourcesLoaded, 1);
  assert.deepEqual(researchRecord.generationDiagnostics.externalSourceIdsSentToModel, ['billboard-bmg-suno']);
});

test('BMG Suno source story rejects invented Certifyd relationship mechanics', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'billboard-bmg-suno',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'BMG and Suno Reach Licensing Deal for AI Music Model',
      summary: 'Billboard reports that BMG and Suno reached a licensing agreement covering creator opt-in for AI inputs and outputs, compensation for participating artists and songwriters, derivative works, and settlement of prior use.',
      articleUrl: 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/',
      categories: ['Music', 'AI', 'Creator Commerce'],
      certifydRelevanceScore: 13,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    objective: 'Explain the source facts and relevant Certifyd angle.',
    trendSourceItemIds: 'billboard-bmg-suno',
  });
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'BMG and Suno Licensing Deal',
      suggestedSlug: 'bmg-suno-licensing-deal',
      bodyMarkdown: [
        '# BMG and Suno Licensing Deal',
        '',
        'Billboard reports that BMG and Suno reached a licensing agreement covering creator opt-in, compensation, derivative works and settlement of prior use.',
        '',
        '## Why it matters',
        '',
        'By integrating Certifyd into its platform, Suno can facilitate royalty direct deposits to participating artists through Certifyd payment rails.',
      ].join('\n'),
    })),
  });
  await assert.rejects(
    () => provider.generateArticle({
      actorEmail: 'writer@example.test',
      topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
      audience: 'Creators',
      objective: 'Explain the source facts and relevant Certifyd angle.',
      trendSourceItemIds: 'billboard-bmg-suno',
    }, context),
    /Generated draft made unsupported external Certifyd adoption claims/,
  );
});

test('generation validation rejects leaked internal context headings', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Leaked Context Draft',
      suggestedSlug: 'leaked-context-draft',
      bodyMarkdown: [
        '# Leaked Context Draft',
        '',
        '## Definition',
        '',
        'Internal context appears here.',
        '',
        '## Approved Certifyd Knowledge',
        '',
        'This should not become article copy.',
      ].join('\n'),
    })),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Leak test', audience: 'Creators', objective: 'Test validation.' }, context),
    /Generation failed validation — internal context leaked into article/,
  );
});

test('generation validation repairs boilerplate headings without blocking usable drafts', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Boilerplate Heading Draft',
      suggestedSlug: 'boilerplate-heading-draft',
      bodyMarkdown: [
        '# Boilerplate Heading Draft',
        '',
        '## Business Relevance',
        '',
        'Creators need infrastructure that keeps commerce, identity and publishing connected.',
        '',
        '## Certifyd Relevance',
        '',
        'Certifyd helps explain why creator-controlled infrastructure matters.',
      ].join('\n'),
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Boilerplate heading test', audience: 'Creators', objective: 'Test validation.' }, context);
  assert.match(article.bodyMarkdown, /## Why It Matters/);
  assert.match(article.bodyMarkdown, /## Why It Matters for Certifyd Readers/);
  assert.doesNotMatch(article.bodyMarkdown, /## Business Relevance/);
  assert.doesNotMatch(article.bodyMarkdown, /## Certifyd Relevance/);
});

test('generation validation repairs copied prompt labels without dropping article content', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Prompt Label Draft',
      suggestedSlug: 'prompt-label-draft',
      bodyMarkdown: [
        '# Prompt Label Draft',
        '',
        '## SOURCE FACTS',
        '',
        'A source story describes a creator commerce shift.',
        '',
        '## CERTIFYD FACTS',
        '',
        'Certifyd connects publishing, discovery, and direct creator-to-fan commerce.',
        '',
        '## EDITORIAL ANGLE',
        '',
        'The useful angle is audience independence, not platform dependency.',
      ].join('\n'),
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Prompt label test', audience: 'Creators', objective: 'Test validation.' }, context);
  assert.match(article.bodyMarkdown, /## What Happened/);
  assert.match(article.bodyMarkdown, /## What Certifyd Adds/);
  assert.match(article.bodyMarkdown, /## Why This Angle Matters/);
  assert.doesNotMatch(article.bodyMarkdown, /## SOURCE FACTS/);
  assert.doesNotMatch(article.bodyMarkdown, /## CERTIFYD FACTS/);
  assert.doesNotMatch(article.bodyMarkdown, /## EDITORIAL ANGLE/);
});

test('generation cleanup removes duplicate leading title headings', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Why Independent Creators Need Direct Fan Commerce',
      suggestedSlug: 'why-independent-creators-need-direct-fan-commerce',
      bodyMarkdown: [
        '# Why Independent Creators Need Direct Fan Commerce',
        '',
        '### Why Independent Creators Need Direct Fan Commerce',
        '',
        'Creators need direct commerce routes that preserve audience relationships.',
      ].join('\n'),
    })),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Direct fan commerce', audience: 'Creators', objective: 'Explain clearly.' }, context);
  const titleHeadings = article.bodyMarkdown.match(/^#{1,6}\s+Why Independent Creators Need Direct Fan Commerce$/gim) || [];
  assert.equal(titleHeadings.length, 1);
});

test('raw leaked Qwen text is rejected before fallback coercion', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const leaked = [
    'Source Scope',
    'This file applies the founder-approved architectural definition of Certifyd Core.',
    '',
    'Definition',
    'Certifyd Core is a platform designed for creators.',
    '',
    'Approved Certifyd Knowledge',
    'This file uses only the approved Brain context above.',
  ].join('\n');
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
      if (String(url).endsWith('/api/chat')) return mockResponse({ message: { content: leaked } });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /Generation failed validation — internal context leaked into article/,
  );
});

test('source-backed generation with zero external source evidence fails before Qwen is called', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'billboard-beyonce-lawsuit',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'Beyoncé infringement lawsuit story',
      summary: '',
      articleUrl: '',
    }],
    opportunities: [{
      id: 'opp-beyonce-lawsuit',
      sourceItemIds: ['billboard-beyonce-lawsuit'],
    }],
  }, null, 2));
  let qwenCalled = false;
  await assert.rejects(
    async () => {
      const context = await makeContext(config, {
        topic: 'Beyoncé infringement lawsuit story',
        trendOpportunityId: 'opp-beyonce-lawsuit',
      });
      const provider = new OllamaQwenGenerationProvider(config, {
        fetchImpl: async () => {
          qwenCalled = true;
          return mockResponse({});
        },
      });
      return provider.generateArticle({
        actorEmail: 'writer@example.test',
        topic: 'Beyoncé infringement lawsuit story',
        audience: 'Creators',
        objective: 'Explain the source facts and Certifyd relevance.',
        trendOpportunityId: 'opp-beyonce-lawsuit',
      }, context);
    },
    /Cannot generate source-backed article — original source evidence is unavailable\./,
  );
  assert.equal(qwenCalled, false);
});

test('source-backed generation fails when selected source ID disappears', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'available-source',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'Available source story',
      summary: 'A valid source summary exists, but it is not the selected item.',
      articleUrl: 'https://www.billboard.com/pro/available-source/',
    }],
    opportunities: [],
  }, null, 2));
  await assert.rejects(
    () => makeContext(config, {
      topic: 'Missing selected source',
      trendSourceItemIds: 'missing-selected-source',
    }),
    /selected source evidence is unavailable: missing-selected-source/,
  );
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
