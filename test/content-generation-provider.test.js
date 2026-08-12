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

test('external company Certifyd adoption claims are rejected', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
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
  assert.match(outboundPrompt, /about half of the draft about the external business\/news facts/i);
  assert.match(outboundPrompt, /SOURCE FACTS/i);
  assert.match(outboundPrompt, /Music Business Worldwide/i);
  assert.match(outboundPrompt, /Label revenue rises as direct fan activity grows/i);
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
  assert.match(outboundPrompt, /CERTIFYD KNOWLEDGE/i);
  assert.match(outboundPrompt, /EDITORIAL ANGLE/i);
  assert.match(outboundPrompt, /WRITING INSTRUCTIONS/i);
  const userPrompt = payload.messages.find((message) => message.role === 'user')?.content || '';
  assert.ok(userPrompt.length < 4500, `Qwen prompt should stay compact, got ${userPrompt.length} chars`);
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

test('Brain retrieval covers positioning, rights, commerce and network dependency for music-rights stories', async () => {
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/capabilities/access.md', '# Access\n\nAPPROVED\n\nCertifyd access records help describe permissions and creator-controlled access decisions.'],
    ['content-agent/knowledge/capabilities/commerce.md', '# Commerce\n\nAPPROVED\n\nCertifyd supports direct creator commerce context and owned customer relationships.'],
    ['content-agent/knowledge/capabilities/payments.md', '# Payments\n\nAPPROVED\n\nCertifyd payment records can support transaction context where payment workflows are configured.'],
    ['content-agent/knowledge/capabilities/network-distribution.md', '# Network Distribution\n\nAPPROVED\n\nCertifyd Network reduces dependency on single-platform distribution by routing identity, discovery and commerce through creator-controlled records.'],
    ['content-agent/knowledge/ecosystem.md', '# Certifyd Ecosystem\n\nAPPROVED\n\nCertifyd connects creators, fans, partners and commerce infrastructure around creator-owned relationships.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  const context = await makeContext(config, {
    topic: 'IFPI, Sony and UMG take legal action against parasitic streaming app Musi',
    objective: 'Connect music rights, permissions, creator commerce, payments and platform dependency without inventing capabilities.',
    sourceRestrictions: 'Relevant approved Brain records: brain:founder-decisions,brain:capabilities/commerce,brain:capabilities/payments,brain:capabilities/access,brain:capabilities/network-distribution.',
    trendBrainRecordIds: 'brain:founder-decisions,brain:capabilities/commerce,brain:capabilities/payments,brain:capabilities/access,brain:capabilities/network-distribution',
  });
  const selectedIds = context.sourceRecords.map((source) => source.id);
  assert.ok(selectedIds.includes('brain:capabilities/commerce'));
  assert.ok(selectedIds.includes('brain:capabilities/payments'));
  assert.ok(selectedIds.includes('brain:capabilities/access'));
  assert.ok(selectedIds.includes('brain:capabilities/network-distribution'));
  assert.ok(context.approvedKnowledge.some((record) => /Commerce and payments/.test(record.theme)));
  assert.ok(context.approvedKnowledge.some((record) => /Permissions and rights/.test(record.theme)));
  assert.ok(context.approvedKnowledge.some((record) => /Network and platform dependency/.test(record.theme)));
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
  assert.match(outboundPrompt, /SOURCE FACTS/i);
  assert.match(outboundPrompt, /CERTIFYD KNOWLEDGE/i);
  assert.match(outboundPrompt, /EDITORIAL ANGLE/i);
  assert.match(outboundPrompt, /WRITING INSTRUCTIONS/i);
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
