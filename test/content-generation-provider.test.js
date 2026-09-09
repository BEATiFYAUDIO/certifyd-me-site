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
  OpenAIGenerationProvider,
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
    modelProvider: 'openai',
    openai: {
      apiKey: 'test-openai-key',
      model: 'gpt-5.6-terra',
      timeoutMs: 1000,
      healthTimeoutMs: 1000,
      maxOutputTokens: 5000,
      maxContextChars: 24000,
      maxConcurrentGenerations: 1,
      ...overrides.openai,
    },
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
  const bodyMarkdown = [
    '# What Certifyd Core Is',
    '',
    'A source-backed Certifyd draft should begin with the concrete facts in front of it, then explain the business consequence those facts create for creators, operators, partners and readers.',
    '',
    'The useful article does not turn Certifyd into a claimed participant in another company’s story. It separates what the outside source reported from the narrower Certifyd relevance selected from approved Brain records.',
    '',
    'That distinction matters because creator businesses often depend on identity, publishing context, distribution, commerce and audience relationships that live across many outside systems.',
    '',
    'A strong draft should show the mechanism behind the shift, identify the specific creator consequence, and use only the Certifyd concept that clarifies that mechanism.',
    '',
    'The article should also explain why the timing matters, what changed from the prior operating reality, and what a creator would need to watch next. Those details create enough depth for founder review without inventing partnerships, adoption, legal conclusions or product promises.',
    '',
    'For source-backed drafts, the article has to make the source story do real work. It should name the reported shift, explain the pressure it creates, and make the Certifyd connection only after the external facts have established a reason for that connection.',
    '',
    'For Certifyd-only explainers, the article can stay closer to approved Brain context, but it should still avoid thin filler. The writing should make a useful argument that a founder can review, revise and approve without rebuilding the entire structure.',
    '',
    'The result should read like an editorial article, not a copied research brief, glossary entry, source recap or generic product pitch. It should have enough substance for review even when it is still a draft.',
  ].join('\n');
  return {
    title: 'What Certifyd Core Is',
    suggestedSlug: 'what-certifyd-core-is',
    excerpt: 'A grounded draft explaining Certifyd Core.',
    author: 'Certifyd',
    tags: ['Certifyd', 'creator ownership'],
    seoTitle: 'What Certifyd Core Is | Certifyd',
    seoDescription: 'A grounded draft explaining Certifyd Core.',
    focusKeyword: 'Certifyd Core',
    secondaryKeywords: ['creator identity', 'creator commerce'],
    category: 'Creator Infrastructure',
    bodyMarkdown,
    claims: [{ text: 'Certifyd Core supports identity, publishing and direct commerce.', sourceIds: [sourceId], confidence: 'supported' }],
    warnings: [],
    ...overrides,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function completeEditorialGate(context, overrides = {}) {
  context.editorialBrief = {
    ...(context.editorialBrief || {}),
    verifiedFacts: ['A source story reports a concrete business event.'],
    editorialTension: 'The source facts create a concrete creator-business tension.',
    creatorConsequence: 'Creators need to understand the practical business consequence of the source facts.',
    possibleThesis: 'This source story creates a specific creator-business argument.',
    thesisTest: { status: 'PASS', reason: 'Fixture thesis is specific enough for this test.' },
    articleProgression: ['Open with the source facts.', 'Explain what changed.', 'Show the creator consequence.', 'Close with the source-backed editorial implication.'],
    selectedCertifydConcepts: [{ concept: 'Narrow Certifyd relevance', relevance: 'Relevant to this source story.', sourceConnection: 'The source facts create this connection.' }],
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

function validReasoning(overrides = {}) {
  return {
    eventSummary: 'A source story reports a concrete business event.',
    obviousTake: 'The immediate news is a concrete business update.',
    editorialTension: 'The source facts create a specific creator-business tension.',
    hiddenQuestion: 'What changes for creators if this pattern continues?',
    whatThisReveals: 'Before the source event, the issue was easier to miss. Now the business consequence is visible.',
    editorialIdea: 'This source story creates a specific creator-business argument.',
    editorialIdeaSupport: [{ idea: 'The event creates a specific creator-business argument.', factIds: ['fact-1'] }],
    verifiedFacts: ['A source story reports a concrete business event.'],
    tension: 'The source facts create a specific creator-business tension.',
    whatChanged: 'Before the source event, the issue was easier to miss. Now the business consequence is visible.',
    creatorConsequence: 'Creators need to understand how this event changes control, trust or commerce.',
    thesis: 'This source story creates a specific creator-business argument.',
    worthPublishing: true,
    rejectionReason: '',
    certifydConcepts: [],
    avoidAngles: ['generic decentralization claims'],
    articleProgression: ['Open with the source facts.', 'Explain what changed.', 'Show the creator consequence.', 'Close with the source-backed editorial implication.'],
    ...overrides,
  };
}

function mockOpenAIClient({ reasoning = validReasoning(), article, failAt = '', incompleteAt = '', calls = [] } = {}) {
  const articleQueue = Array.isArray(article) ? [...article] : null;
  return {
    responses: {
      create: async (payload) => {
        calls.push(payload);
        const stage = payload.text?.format?.name || '';
        if (failAt && stage.includes(failAt)) {
          const error = new Error('mock OpenAI failure');
          error.status = 500;
          throw error;
        }
        if (incompleteAt && stage.includes(incompleteAt)) {
          return {
            id: `resp_${calls.length}`,
            status: 'incomplete',
            output_text: '{"title"',
            incomplete_details: { reason: 'max_output_tokens' },
            usage: { input_tokens: 100 + calls.length, output_tokens: 50 + calls.length, total_tokens: 150 + calls.length * 2 },
          };
        }
        const body = stage.includes('reasoning')
          ? reasoning
          : (articleQueue ? articleQueue.shift() : (article || validArticle('brain:facts/approved-public-claims')));
        return {
          id: `resp_${calls.length}`,
          status: 'completed',
          output_text: JSON.stringify(body),
          usage: { input_tokens: 100 + calls.length, output_tokens: 50 + calls.length, total_tokens: 150 + calls.length * 2 },
        };
      },
    },
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
  assert.match(article.bodyMarkdown, /permissions|creator control|compensation/i);
  assert.doesNotMatch(article.bodyMarkdown, /Source Scope|Approved Certifyd Knowledge|Business Relevance|Core Knowledge Themes|Certifyd Relevance/);
  assert.doesNotMatch(article.bodyMarkdown, /integrating Certifyd|through Certifyd|using Certifyd/i);
  assert.match(article.warnings.join('\n'), /Qwen timed out/);
});

test('missing OpenAI API key reports configured=false', async () => {
  const config = await makeConfig({ openai: { apiKey: '', model: 'gpt-5.6-terra', timeoutMs: 1000, healthTimeoutMs: 1000, maxOutputTokens: 5000, maxContextChars: 24000, maxConcurrentGenerations: 1 } });
  const provider = new OpenAIGenerationProvider(config, { openaiClient: mockOpenAIClient() });
  const health = await provider.healthCheck();
  assert.equal(health.configured, false);
  assert.equal(health.available, false);
  assert.equal(health.model, 'gpt-5.6-terra');
});

test('OpenAI provider uses default model and env override config', async () => {
  const defaultConfig = await makeConfig({ openai: { apiKey: 'test-openai-key' } });
  const overrideConfig = await makeConfig({ openai: { apiKey: 'test-openai-key', model: 'gpt-5.6-sol' } });
  assert.equal(new OpenAIGenerationProvider(defaultConfig, { openaiClient: mockOpenAIClient() }).modelName, 'gpt-5.6-terra');
  assert.equal(new OpenAIGenerationProvider(overrideConfig, { openaiClient: mockOpenAIClient() }).modelName, 'gpt-5.6-sol');
});

test('normal generation uses OpenAI Responses with separate reasoning and writing calls', async () => {
  const calls = [];
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ calls, article: validArticle(sourceId) }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.equal(article.status, 'draft');
  assert.equal(provider.providerName, 'openai');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].text.format.name, 'certifyd_editorial_reasoning');
  assert.equal(calls[1].text.format.name, 'certifyd_article');
  assert.equal(calls[0].model, 'gpt-5.6-terra');
  assert.equal(calls[1].model, 'gpt-5.6-terra');
  assert.equal(calls[1].max_output_tokens, 5000);
});

test('source facts are passed to OpenAI reasoning', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-ai-rights',
      publisher: 'Billboard',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'BMG and Suno Reach Licensing Deal for AI Music Model',
      summary: 'BMG and Suno reached a licensing agreement covering creator opt-in and compensation.',
      articleUrl: 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/',
      categories: ['Music', 'AI'],
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    trendSourceItemIds: 'source-ai-rights',
  });
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ calls, article: validArticle(context.sourceRecords[0].id) }),
  });
  await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'BMG and Suno Reach Licensing Deal for AI Music Model',
    audience: 'Creators',
    objective: 'Explain the source facts.',
    trendSourceItemIds: 'source-ai-rights',
  }, context);
  assert.match(calls[0].input, /SOURCE FACTS/);
  assert.match(calls[0].input, /Billboard/);
  assert.match(calls[0].input, /BMG and Suno Reach Licensing Deal/);
  assert.match(calls[0].input, /creator opt-in and compensation/);
});

test('OpenAI thesis reasoning receives source facts but no Certifyd Brain candidates', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-only-story',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Artist identity dispute raises profile verification question',
      summary: 'A source story reports a dispute involving artist identity, representative authority and profile verification.',
      articleUrl: 'https://example.test/source-only-story',
      categories: ['Music', 'Identity'],
      certifydRelevanceScore: 8,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Artist identity dispute raises profile verification question',
    trendSourceItemIds: 'source-only-story',
  });
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ calls, article: validArticle(context.sourceRecords[0].id) }),
  });
  await provider.generateArticle({
    actorEmail: 'writer@example.test',
    topic: 'Artist identity dispute raises profile verification question',
    audience: 'Creators',
    objective: 'Explain the source facts.',
    trendSourceItemIds: 'source-only-story',
  }, context);
  assert.match(calls[0].input, /SOURCE FACTS/);
  assert.match(calls[0].input, /Artist identity dispute raises profile verification question/);
  assert.match(calls[0].input, /SOURCE-ONLY DETERMINISTIC BRIEF/);
  assert.doesNotMatch(calls[0].input, /APPROVED CERTIFYD BRAIN CANDIDATES/i);
  assert.doesNotMatch(calls[0].input, /Approved Certifyd context/i);
  assert.doesNotMatch(calls[0].input, /Certifyd Core is the foundational engine/i);
});

test('OpenAI final writing receives no Brain context when source-only reasoning approves no Certifyd concept', async () => {
  const calls = [];
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/capabilities/profiles.md', '# Profiles\n\nAPPROVED\n\nCertifyd profiles describe creator-controlled identity and account context.'],
    ['content-agent/knowledge/capabilities/payouts.md', '# Payouts\n\nAPPROVED\n\nA payout is the movement of allocated earnings to creators or participants.'],
    ['content-agent/knowledge/capabilities/provenance.md', '# Provenance\n\nAPPROVED\n\nCertifyd provenance records help connect work, attribution, permissions and publication context.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      reasoning: validReasoning(),
      article: validArticle(sourceId),
    }),
  });
  await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.match(calls[1].input, /SELECTED CERTIFYD BRAIN FOR FINAL WRITING/);
  assert.match(calls[1].input, /No selected Brain facts supplied/i);
  assert.doesNotMatch(calls[1].input, /A payout is the movement of allocated earnings/i);
  assert.doesNotMatch(calls[1].input, /Certifyd profiles describe creator-controlled identity/i);
});

test('OpenAI rejects thin Spotify MLC procedural update before Brain retrieval or writing', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'spotify-mlc-dmn',
      publisher: 'Digital Music News',
      publishedAt: '2026-09-08T09:00:00.000Z',
      title: 'Federal Judge Rejects MLC’s Interlocutory Appeal Push in Spotify Bundling Battle — While Striking One of the DSP’s Defenses',
      summary: 'Nearly 28 months after the bundling-focused Mechanical Licensing Collective v. Spotify legal battle kicked off, a federal judge has denied the MLC’s push for an interlocutory appeal. The headline says the judge also struck one Spotify defense.',
      articleUrl: 'https://example.test/spotify-mlc',
      categories: ['Music', 'Creator Commerce'],
      certifydRelevanceScore: 11,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Spotify bundling case MLC interlocutory appeal denied',
    objective: 'Explain the source facts.',
    trendSourceItemIds: 'spotify-mlc-dmn',
  });
  completeEditorialGate(context, {
    verifiedFacts: ['Digital Music News reports that a federal judge denied the MLC’s interlocutory appeal request.'],
    editorialTension: 'The source facts create a mixed procedural posture.',
    creatorConsequence: 'Creators should not infer changed business terms from the supplied facts.',
    possibleThesis: 'The supplied facts establish a mixed procedural update.',
    thesisTest: { status: 'PASS', reason: 'Let the OpenAI source-only bridge guard evaluate this fixture.' },
    articleProgression: ['Open with the procedural ruling.', 'Explain the mixed posture.', 'Name the missing details.', 'Conclude narrowly.'],
    selectedCertifydConcepts: [],
  });
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      reasoning: validReasoning({
        eventSummary: 'A judge denied the MLC’s interlocutory appeal request while one Spotify defense was struck.',
        obviousTake: 'The case remains unresolved.',
        editorialTension: 'The result is mixed procedurally, but the supplied facts do not explain the ruling or the struck defense.',
        hiddenQuestion: 'Is there enough detail to support an original editorial thesis?',
        whatThisReveals: 'The supplied facts show procedural movement, not a deeper structural conclusion.',
        editorialIdea: 'This is a mixed procedural update.',
        editorialIdeaSupport: [{ idea: 'The update is mixed and procedural.', factIds: ['spotify-mlc-dmn'] }],
        creatorConsequence: 'Creators should not infer changed rights, rates or business terms from the available facts.',
        thesis: 'The available source facts establish a mixed procedural update, not a distinctive creator-business thesis.',
        worthPublishing: false,
        rejectionReason: 'Mixed procedural update, but the available source facts do not establish enough detail about the ruling or underlying issue to support a distinctive editorial thesis.',
        certifydConcepts: [],
        articleProgression: [],
      }),
      article: validArticle(context.sourceRecords[0].id),
    }),
  });
  await assert.rejects(
    () => provider.generateArticle({
      actorEmail: 'writer@example.test',
      topic: 'Spotify bundling case MLC interlocutory appeal denied',
      audience: 'Creators',
      objective: 'Explain the source facts.',
      trendSourceItemIds: 'spotify-mlc-dmn',
    }, context),
    /SOURCE-ONLY WORTH PUBLISHING != true.*Mixed procedural update/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text.format.name, 'certifyd_editorial_reasoning');
  assert.doesNotMatch(calls[0].input, /APPROVED CERTIFYD BRAIN CANDIDATES/i);
});

test('OpenAI source-only reasoning cannot rescue Spotify MLC story with records provenance or catalog context', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'spotify-mlc-dmn',
      publisher: 'Digital Music News',
      publishedAt: '2026-09-08T09:00:00.000Z',
      title: 'Federal Judge Rejects MLC’s Interlocutory Appeal Push in Spotify Bundling Battle',
      summary: 'A federal judge denied the MLC’s push for an interlocutory appeal in a bundling-focused legal battle with Spotify. The supplied summary does not identify the defense that was struck or explain the court’s reasoning.',
      articleUrl: 'https://example.test/spotify-mlc',
      categories: ['Music'],
      certifydRelevanceScore: 11,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Spotify bundling case MLC interlocutory appeal denied',
    objective: 'Explain the source facts.',
    trendSourceItemIds: 'spotify-mlc-dmn',
  });
  completeEditorialGate(context, {
    verifiedFacts: ['Digital Music News reports that a federal judge denied the MLC’s interlocutory appeal request.'],
    editorialTension: 'The source facts create a mixed procedural posture.',
    creatorConsequence: 'Creators should not infer changed business terms from the supplied facts.',
    possibleThesis: 'The supplied facts establish a mixed procedural update.',
    thesisTest: { status: 'PASS', reason: 'Let the OpenAI source-only bridge guard evaluate this fixture.' },
    articleProgression: ['Open with the procedural ruling.', 'Explain the mixed posture.', 'Name the missing details.', 'Conclude narrowly.'],
    selectedCertifydConcepts: [],
  });
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      reasoning: validReasoning({
        eventSummary: 'A judge denied the MLC’s interlocutory appeal request.',
        obviousTake: 'The case remains unresolved.',
        editorialTension: 'The procedural result is mixed.',
        hiddenQuestion: 'What operational lesson should music businesses draw?',
        whatThisReveals: 'Music businesses need clear records around the context in which releases and offerings are presented.',
        editorialIdea: 'The ruling shows why documented release context and catalog context matter.',
        editorialIdeaSupport: [{ idea: 'Release context and catalog context matter.', factIds: ['spotify-mlc-dmn'] }],
        creatorConsequence: 'Creators need provenance and catalog context around music offerings.',
        thesis: 'The ruling is a reminder that provenance, clear records and catalog context matter long after a music offering reaches market.',
        worthPublishing: true,
        rejectionReason: '',
        certifydConcepts: [],
        articleProgression: [
          'Open with the procedural ruling.',
          'Explain the mixed posture.',
          'Discuss clear records around release context.',
          'Connect catalog context to the continuing dispute.',
        ],
      }),
      article: validArticle(context.sourceRecords[0].id),
    }),
  });
  await assert.rejects(
    () => provider.generateArticle({
      actorEmail: 'writer@example.test',
      topic: 'Spotify bundling case MLC interlocutory appeal denied',
      audience: 'Creators',
      objective: 'Explain the source facts.',
      trendSourceItemIds: 'spotify-mlc-dmn',
    }, context),
    /SOURCE-ONLY REASONING contains unsupported bridge concept: records\/documentation.*release\/offering context.*catalog context/,
  );
  assert.equal(calls.length, 1);
});

test('OpenAI final writing instructions discourage validator-facing defensive prose and forced Certifyd sections', async () => {
  const calls = [];
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ calls, article: validArticle(context.sourceRecords[0].id) }),
  });
  await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  const finalInstructionText = `${calls[1].instructions}\n${calls[1].input}`;
  assert.match(finalInstructionText, /Write like an informed technology\/music-business publication, not a compliance memo/i);
  assert.match(finalInstructionText, /Do not mention the validation system, source-support restrictions, uncertainty machinery, prompt rules, or internal editorial rules in article prose/i);
  assert.match(finalInstructionText, /Do not add defensive disclaimers merely to show what the article is not claiming/i);
  assert.match(finalInstructionText, /may contain zero Certifyd product references/i);
  assert.match(finalInstructionText, /Do not force Certifyd into the article/i);
  assert.match(finalInstructionText, /Never manufacture a Certifyd connection from generic payouts, provenance, identity, ownership, records, transparency or creator-control language/i);
  assert.match(finalInstructionText, /Prefer confident, conventional editorial prose over defensive phrases/i);
  assert.match(finalInstructionText, /Default to no Certifyd product mention/i);
  assert.match(finalInstructionText, /Absence of a Certifyd reference is a successful outcome/i);
  assert.match(finalInstructionText, /If certifydConcepts is empty, the article must contain zero Certifyd product references/i);
  assert.match(finalInstructionText, /If certifydConcepts is non-empty, it is permission to consider that concept, not a requirement to mention it/i);
  assert.match(finalInstructionText, /Use only the Certifyd connection explicitly approved in the reasoning object/i);
  assert.match(finalInstructionText, /legal dispute → documentation → provenance → Certifyd/i);
  assert.match(finalInstructionText, /AI → identity → Certifyd/i);
  assert.match(finalInstructionText, /payments → payouts → Certifyd/i);
  assert.match(finalInstructionText, /rights → ownership → Certifyd/i);
  assert.match(finalInstructionText, /creator story → creator control → Certifyd/i);
  assert.match(finalInstructionText, /Remove unnecessary defensive product disclaimers/i);
});

test('OpenAI reasoning cannot introduce royalty frame without source support', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-discovery-visibility',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Creator platform changes independent music infrastructure',
      summary: 'A source story reports a platform infrastructure change for artists and labels. It discusses visibility, audience reach and creator-operated distribution.',
      articleUrl: 'https://example.test/source-discovery-visibility',
      categories: ['Music', 'Discovery'],
      certifydRelevanceScore: 8,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Creator platform changes independent music infrastructure',
    trendSourceItemIds: 'source-discovery-visibility',
  });
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      reasoning: validReasoning({
        tension: 'The tension is whether royalty flows become visible to creators.',
        whatChanged: 'Now royalty terms are part of the operational story.',
        creatorConsequence: 'Creators need royalty transparency.',
        thesis: 'This story shows why royalty context matters.',
        certifydConcepts: [{ concept: 'Royalty context', relevance: 'Relevant to royalty transparency.', sourceConnection: 'The source facts create a royalty question.' }],
      }),
      article: validArticle(sourceId),
    }),
  });
  await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Creator platform changes independent music infrastructure', audience: 'Creators', objective: 'Explain discovery.' }, context);
  assert.doesNotMatch(calls[1].input, /\broyalt(?:y|ies)\b/i);
});

test('OpenAI final writing prompt does not send glossary definitions verbatim', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.writeFile(path.join(config.siteRoot, 'content-agent/knowledge/facts/approved-public-claims.md'), [
    '# Approved Public Claims',
    '',
    'APPROVED',
    '',
    '## Supported Current Claims',
    '',
    '- Certifyd Core is the foundational engine for identity, publishing and direct commerce.',
    '- A payout is the movement of allocated earnings to creators or participants.',
    '- Certifyd Network supports discovery, routing and distribution.',
  ].join('\n'));
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-provenance-dispute',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Artist rights dispute centers provenance records',
      summary: 'A source story reports that an artist rights dispute turned on provenance, source records, credits and publication context.',
      articleUrl: 'https://example.test/source-provenance-dispute',
      categories: ['Music', 'Provenance'],
      certifydRelevanceScore: 12,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Artist rights dispute centers provenance records',
    trendSourceItemIds: 'source-provenance-dispute',
  });
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      reasoning: validReasoning({
        certifydConcepts: [{ concept: 'Provenance context', relevance: 'Relevant to source records.', sourceConnection: 'The source facts turn on provenance records.' }],
      }),
      article: validArticle(sourceId),
    }),
  });
  await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Artist rights dispute centers provenance records', audience: 'Creators', objective: 'Explain provenance.' }, context);
  assert.doesNotMatch(calls[1].input, /\bA payout is\b/i);
  assert.match(calls[1].input, /Payout context covers/i);
});

test('OpenAI retries once when article prose copies generic Certifyd glossary definitions', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-provenance-records',
      publisher: 'Billboard',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Label changes rights provenance records for artist releases',
      summary: 'A source story reports a label changed rights provenance records, source context, credits and publication context for artist releases.',
      articleUrl: 'https://example.test/source-provenance-records',
      categories: ['Music', 'Provenance'],
      certifydRelevanceScore: 12,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Label changes rights provenance records for artist releases',
    trendSourceItemIds: 'source-provenance-records',
  });
  const sourceId = context.sourceRecords[0].id;
  const baseBody = validArticle(sourceId).bodyMarkdown;
  const badArticle = validArticle(sourceId, {
    bodyMarkdown: `${baseBody}\n\nProvenance is evidence about the origin, source, publisher, timestamp, contribution context, release history, or record history of a work.`,
  });
  const goodArticle = validArticle(sourceId, {
    title: 'Label Changes Provenance Records',
    suggestedSlug: 'label-changes-provenance-records',
    bodyMarkdown: baseBody,
  });
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      article: [badArticle, goodArticle],
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Label changes rights provenance records for artist releases', audience: 'Creators', objective: 'Explain provenance.' }, context);
  assert.equal(calls.length, 3);
  assert.match(calls[2].input, /REVISION REQUIRED/);
  assert.match(calls[2].input, /Provenance is evidence about/i);
  assert.doesNotMatch(article.bodyMarkdown, /Provenance is evidence about/i);
});

test('OpenAI exact supplied Brain source ID in generated claim is accepted', async () => {
  const calls = [];
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      article: validArticle(sourceId),
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.deepEqual(article.claims[0].sourceIds, [sourceId]);
});

test('OpenAI external source item ID in claim provenance is not accepted as Brain provenance', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'src-21f0875939bac73e',
      publisher: 'Digital Music News',
      publishedAt: '2026-09-08T09:00:00.000Z',
      title: 'Platform changes creator rights policy for catalog visibility',
      summary: 'A source story reports that a platform changed creator rights policy for catalog visibility, distribution and audience reach.',
      articleUrl: 'https://example.test/source-policy',
      categories: ['Music', 'Policy'],
      certifydRelevanceScore: 10,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Platform changes creator rights policy for catalog visibility',
    trendSourceItemIds: 'src-21f0875939bac73e',
  });
  const badExternalId = 'src-21f0875939bac73e';
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      article: validArticle(badExternalId, {
        claims: [{ text: 'Certifyd Core supports identity, publishing and direct commerce.', sourceIds: [badExternalId], confidence: 'supported' }],
      }),
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Platform changes creator rights policy for catalog visibility', audience: 'Creators', objective: 'Explain policy.' }, context);
  assert.notEqual(article.claims[0]?.sourceIds?.[0], badExternalId);
  assert.match(article.claims[0]?.sourceIds?.[0] || '', /^brain:/);
  assert.match(article.warnings.join('\n'), /Repaired generated claim source ID metadata/);
});

test('unknown claim source ID with no unambiguous Brain match is removed without inventing replacement', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      article: validArticle(context.sourceRecords[0].id, {
        claims: [{ text: 'Outside source published an article about catalog visibility.', sourceIds: ['brain:not-current'], confidence: 'needs-review' }],
      }),
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.deepEqual(article.claims, []);
  assert.match(article.warnings.join('\n'), /Dropped generated claim with unknown Brain source IDs/);
});

test('current OpenAI writing prompt only exposes current allowed Brain source IDs for claims', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.writeFile(path.join(config.siteRoot, 'content-agent/knowledge/facts/approved-public-claims.md'), [
    '# Approved Public Claims',
    '',
    'APPROVED',
    '',
    'Certifyd Network supports discovery, routing and distribution.',
  ].join('\n'));
  const context = await makeContext(config, { topic: 'Certifyd Network distribution' });
  context.allowedBrainSourceIds = ['brain:capabilities/stale-record'];
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ calls, article: validArticle(sourceId) }),
  });
  await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Certifyd Network distribution', audience: 'Creators', objective: 'Explain Network.' }, context);
  assert.match(calls[1].input, /ALLOWED_BRAIN_SOURCE_IDS/);
  assert.match(calls[1].input, new RegExp(escapeRegExp(sourceId)));
  assert.doesNotMatch(calls[1].input, /brain:capabilities\/stale-record/);
});

test('isolated royalty vocabulary in general explanatory prose does not fail article validation', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-platform-policy',
      publisher: 'Music Ally',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Platform changes creator rights policy for catalog visibility',
      summary: 'A source story reports that a platform changed creator rights policy for catalog visibility, distribution and audience reach.',
      articleUrl: 'https://example.test/source-platform-policy',
      categories: ['Music', 'Policy'],
      certifydRelevanceScore: 10,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Platform changes creator rights policy for catalog visibility',
    trendSourceItemIds: 'source-platform-policy',
  });
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      article: validArticle(sourceId, {
        bodyMarkdown: `${validArticle(sourceId).bodyMarkdown}\n\nMusic agreements can involve royalties, licensing terms, performer rights and other obligations, but this source story is narrower than those general categories.`,
      }),
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Platform changes creator rights policy for catalog visibility', audience: 'Creators', objective: 'Explain rights policy.' }, context);
  assert.match(article.bodyMarkdown, /Music agreements can involve royalties/i);
});

test('unsupported factual royalty claim triggers one repair call and preserves article metadata', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-platform-policy-repair',
      publisher: 'Music Ally',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Platform changes creator rights policy for catalog visibility',
      summary: 'A source story reports that a platform changed creator rights policy for catalog visibility, distribution and audience reach.',
      articleUrl: 'https://example.test/source-platform-policy-repair',
      categories: ['Music', 'Policy'],
      certifydRelevanceScore: 10,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Platform changes creator rights policy for catalog visibility',
    trendSourceItemIds: 'source-platform-policy-repair',
  });
  const sourceId = context.sourceRecords[0].id;
  const base = validArticle(sourceId, {
    title: 'Platform Policy and Catalog Visibility',
    suggestedSlug: 'platform-policy-catalog-visibility',
    seoTitle: 'Platform Policy and Catalog Visibility | Certifyd',
  });
  const badArticle = {
    ...base,
    bodyMarkdown: `${base.bodyMarkdown}\n\nThe policy created a new royalty obligation for performers.`,
  };
  const goodArticle = {
    ...base,
    bodyMarkdown: `${base.bodyMarkdown}\n\nThe policy changed how catalog visibility and creator business context need to be explained.`,
  };
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ calls, article: [badArticle, goodArticle] }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Platform changes creator rights policy for catalog visibility', audience: 'Creators', objective: 'Explain rights policy.' }, context);
  assert.equal(calls.length, 3);
  assert.match(calls[2].input, /new royalty obligation/i);
  assert.equal(article.title, base.title);
  assert.equal(article.seoTitle, base.seoTitle);
  assert.doesNotMatch(article.bodyMarkdown, /new royalty obligation/i);
});

test('unsupported royalty thesis triggers repair without retrying reasoning or writing stages', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-policy-thesis-repair',
      publisher: 'Music Ally',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Platform changes creator rights policy for catalog visibility',
      summary: 'A source story reports that a platform changed creator rights policy for catalog visibility, distribution and audience reach.',
      articleUrl: 'https://example.test/source-policy-thesis-repair',
      categories: ['Music', 'Policy'],
      certifydRelevanceScore: 10,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Platform changes creator rights policy for catalog visibility',
    trendSourceItemIds: 'source-policy-thesis-repair',
  });
  const sourceId = context.sourceRecords[0].id;
  const base = validArticle(sourceId);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      article: [
        { ...base, bodyMarkdown: `${base.bodyMarkdown}\n\nThis story proves creators are entitled to royalties from platform catalog policy changes.` },
        { ...base, bodyMarkdown: `${base.bodyMarkdown}\n\nThis story shows why platform catalog policy changes need clearer creator-business context.` },
      ],
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Platform changes creator rights policy for catalog visibility', audience: 'Creators', objective: 'Explain rights policy.' }, context);
  assert.deepEqual(calls.map((call) => call.text.format.name), ['certifyd_editorial_reasoning', 'certifyd_article', 'certifyd_article']);
  assert.doesNotMatch(article.bodyMarkdown, /entitled to royalties/i);
});

test('unsupported source-attributed royalty claim remains fatal and creates no draft', async () => {
  const calls = [];
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-fatal-attribution',
      publisher: 'Billboard',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Platform changes creator rights policy for catalog visibility',
      summary: 'A source story reports that a platform changed creator rights policy for catalog visibility, distribution and audience reach.',
      articleUrl: 'https://example.test/source-fatal-attribution',
      categories: ['Music', 'Policy'],
      certifydRelevanceScore: 10,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Platform changes creator rights policy for catalog visibility',
    trendSourceItemIds: 'source-fatal-attribution',
  });
  const sourceId = context.sourceRecords[0].id;
  const base = validArticle(sourceId);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      calls,
      article: { ...base, bodyMarkdown: `${base.bodyMarkdown}\n\nBillboard reports that the policy created a new royalty obligation for performers.` },
    }),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Platform changes creator rights policy for catalog visibility', audience: 'Creators', objective: 'Explain rights policy.' }, context),
    /Generation blocked: unsupported factual claim/,
  );
  assert.equal(calls.length, 2);
  await assert.rejects(() => fs.access(config.outputDir));
});

test('OpenAI final validation still rejects unsafe generated article state', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ article: validArticle(context.sourceRecords[0].id, { status: 'published' }) }),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    GenerationValidationError,
  );
});

test('OpenAI article byline cannot override deterministic Certifyd author', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      article: validArticle(sourceId, { author: 'Outside Reporter' }),
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.equal(article.author, 'Certifyd');
});

test('malformed OpenAI model output fails safely', async () => {
  const calls = [];
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: {
      responses: {
        create: async (payload) => {
          calls.push(payload);
          return { id: `resp_${calls.length}`, output_text: calls.length === 1 ? JSON.stringify(validReasoning()) : '{bad json', usage: {} };
        },
      },
    },
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /AI returned malformed JSON/,
  );
});

test('incomplete OpenAI article response fails with token-limit guidance', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ incompleteAt: 'article' }),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /OpenAI returned an incomplete article-writing response\. Increase OPENAI_MAX_OUTPUT_TOKENS/,
  );
});

test('OpenAI API failure creates no bogus draft', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({ failAt: 'reasoning' }),
  });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context),
    /AI request failed|OpenAI/,
  );
  await assert.rejects(() => fs.access(config.outputDir));
});

test('OpenAI SEO and frontmatter persist in generated draft run', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OpenAIGenerationProvider(config, {
    openaiClient: mockOpenAIClient({
      article: validArticle(sourceId, {
        title: 'Creator Identity and Certifyd Core',
        suggestedSlug: 'creator-identity-certifyd-core',
        seoTitle: 'Creator Identity and Certifyd Core | Certifyd',
        seoDescription: 'How creator identity connects to Certifyd Core.',
        focusKeyword: 'creator identity',
        secondaryKeywords: ['Certifyd Core', 'creator-owned infrastructure'],
        category: 'Creator Infrastructure',
      }),
    }),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Creator identity', audience: 'Creators', objective: 'Explain Core.' }, context);
  const result = await persistGeneratedArticleRun(config, article, { topic: 'Creator identity', audience: 'Creators', objective: 'Explain Core.' }, context, provider);
  const markdown = await fs.readFile(path.join(config.outputDir, result.runId, 'final/article.md'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'publication-manifest.json'), 'utf8'));
  assert.match(markdown, /seoTitle: "Creator Identity and Certifyd Core \\| Certifyd"/);
  assert.match(markdown, /seoDescription: "How creator identity connects to Certifyd Core\."/);
  assert.match(markdown, /focusKeyword: "creator identity"/);
  assert.match(markdown, /secondaryKeywords: \["Certifyd Core","creator-owned infrastructure"\]/);
  assert.match(markdown, /category: "Creator Infrastructure"/);
  assert.equal(manifest.modelProvider, 'openai');
  assert.equal(manifest.modelMode, 'OpenAI');
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

test('unknown Brain source ID is repaired when claim matches supplied Brain record', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle('brain:made-up-source')),
  });
  const article = await provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Core', audience: 'Creators', objective: 'Explain Core.' }, context);
  assert.deepEqual(article.claims[0].sourceIds, [sourceId]);
  assert.match(article.warnings.join('\n'), /Repaired generated claim source ID metadata/);
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
  completeEditorialGate(context, {
    possibleThesis: 'Universal Music Group Completes Share Buyback creates a specific creator-business argument.',
  });
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
  assert.match(outboundPrompt, /Editorial reasoning process/i);
  assert.match(outboundPrompt, /First understand the source story on its own terms/i);
  assert.match(outboundPrompt, /Reject it if it could fit 10 unrelated Certifyd articles/i);
  assert.match(outboundPrompt, /Only after the thesis exists, choose at most 3 Certifyd concepts/i);
  assert.ok(outboundPrompt.indexOf('Facts from the source story') < outboundPrompt.indexOf('Editorial reasoning process'));
  assert.ok(outboundPrompt.indexOf('Editorial reasoning process') < outboundPrompt.indexOf('Internal editorial brief'));
  assert.ok(outboundPrompt.indexOf('Internal editorial brief') < outboundPrompt.indexOf('Approved Certifyd context'));
  assert.match(outboundPrompt, /Editorial angle/i);
  assert.match(outboundPrompt, /Instructions for the draft/i);
  const userPrompt = payload.messages.find((message) => message.role === 'user')?.content || '';
  assert.ok(userPrompt.length < 9500, `Qwen prompt should stay compact enough for local Qwen, got ${userPrompt.length} chars`);
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
  if (selectedIds.includes('brain:capabilities/payments')) {
    assert.ok(selectedIds.indexOf('brain:capabilities/access') < selectedIds.indexOf('brain:capabilities/payments'));
  }
  assert.equal(selectedIds.includes('brain:investors/investment-thesis'), false);
  assert.ok(context.approvedKnowledge.some((record) => /Permissions and rights/.test(record.theme)));
  assert.ok(context.approvedKnowledge.some((record) => /Permissions and rights|Capabilities/.test(record.theme)));
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

test('deterministic editorial brief does not introduce royalty frame without source support', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'ai-rights-consent-source',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'AI music policy debate raises copyright and permission questions',
      summary: 'A report says music companies are debating copyright, creator permission and authorization for AI systems. The source focuses on consent and control.',
      articleUrl: 'https://example.test/ai-rights-consent-source',
      categories: ['Music', 'AI', 'Copyright'],
      certifydRelevanceScore: 10,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'AI music policy debate raises copyright and permission questions',
    objective: 'Explain the source-backed copyright and permission issue without importing payment boilerplate.',
    trendSourceItemIds: 'ai-rights-consent-source',
  });
  const briefText = JSON.stringify(context.editorialBrief).toLowerCase();
  assert.equal(/\broyalt(?:y|ies)\b/.test(briefText), false);
  assert.equal(/\bpayouts?\b/.test(briefText), false);
});

test('deterministic editorial brief allows royalty frame when source facts support it', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'royalty-source-supported',
      publisher: 'Music Ally',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Court ruling changes mechanical royalties dispute',
      summary: 'A federal court ruling addresses mechanical royalties, royalty accounting and payment obligations in a music licensing dispute.',
      articleUrl: 'https://example.test/royalty-source-supported',
      categories: ['Music', 'Rights'],
      certifydRelevanceScore: 12,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Court ruling changes mechanical royalties dispute',
    objective: 'Explain the source-backed royalty issue.',
    trendSourceItemIds: 'royalty-source-supported',
  });
  const briefText = JSON.stringify(context.editorialBrief).toLowerCase();
  assert.match(briefText, /\broyalt(?:y|ies)\b/);
});

test('unsupported-concept gate still blocks a bad deterministic brief', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'discovery-source-for-bad-brief',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-09-09T09:00:00.000Z',
      title: 'Creator platform changes discovery tools',
      summary: 'A source story reports a platform discovery change for artists and labels. It discusses visibility and audience reach.',
      articleUrl: 'https://example.test/discovery-source-for-bad-brief',
      categories: ['Music', 'Discovery'],
      certifydRelevanceScore: 8,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Creator platform changes discovery tools',
    trendSourceItemIds: 'discovery-source-for-bad-brief',
  });
  context.editorialBrief.possibleThesis = 'This story shows why royalty context needs to be clearer for creators.';
  const provider = createGenerationProvider(config, { provider: 'deterministic' });
  await assert.rejects(
    () => provider.generateArticle({ actorEmail: 'writer@example.test', topic: 'Creator platform changes discovery tools' }, context),
    /EDITORIAL BRIEF contains source-unsupported concept: royalty/,
  );
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
    objective: 'Explain the source facts and relevant Certifyd angle around permissions, creator control, derivative works and compensation.',
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
        'That set of facts matters because it turns the AI-music argument from a loose debate about technology into an operating question about authorization. If existing work can become part of an AI system, creators need the practical terms around participation to be visible before new value is built on top of that work.',
        '',
        '## Why this matters for creator control',
        '',
        'The business signal is not just that AI music deals are happening. It is that permission, rights clearance and compensation have to be explicit when creative work becomes training input, output or derivative material.',
        '',
        'For artists and songwriters, the key issue is not whether every agreement uses the same structure. The issue is whether the systems around the agreement can preserve consent, participation choices and compensation context when music moves through new technical layers.',
        '',
        '## The Certifyd relevance',
        '',
        'Certifyd’s approved knowledge points to permissions, publishing context and commerce records as useful infrastructure for creator-owned decision making. That makes this kind of licensing story relevant without implying any adoption by BMG or Suno.',
        '',
        'The useful Certifyd angle is therefore narrow. It is not a claim that Certifyd is part of the deal. It is an example of the type of creator-side infrastructure that becomes more important when permission, publishing context and commercial participation need to travel with the work.',
      ].join('\n'),
      claims: [{ text: 'Certifyd access records help describe permissions, creator opt-in and creator-controlled access decisions.', sourceIds: [sourceId], confidence: 'supported' }],
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
  assert.ok(context.approvedKnowledge.some((record) => /Permissions and rights|Commerce and payments|Capabilities/i.test(record.theme)));
  const researchRecord = JSON.parse(await fs.readFile(path.join(config.outputDir, result.runId, 'research-record.json'), 'utf8'));
  assert.equal(researchRecord.trendProvenance.sourceUrls[0].sourceUrl, 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/');
  assert.equal(researchRecord.generationDiagnostics.externalArticleSourcesSentToModel[0].articleUrl, 'https://www.billboard.com/pro/bmg-suno-licensing-deal-ai-music-model/');
  assert.equal(researchRecord.generationDiagnostics.selectedSourceCount, 1);
  assert.equal(researchRecord.generationDiagnostics.externalSourcesLoaded, 1);
  assert.deepEqual(researchRecord.generationDiagnostics.externalSourceIdsSentToModel, ['billboard-bmg-suno']);
});

test('infrastructure erosion source story stays source-specific and rejects generic licensing contamination', async () => {
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/products/core.md', '# Certifyd Core\n\nAPPROVED\n\nCertifyd Core can be discussed as creator-operated infrastructure for identity, publishing and local operator workflows.'],
    ['content-agent/knowledge/capabilities/network-distribution.md', '# Network Distribution\n\nAPPROVED\n\nCertifyd Network supports discovery, routing and distribution context.'],
    ['content-agent/knowledge/capabilities/profiles.md', '# Profiles\n\nAPPROVED\n\nCertifyd profiles connect creator identity to publishing and business context.'],
    ['content-agent/knowledge/capabilities/payments.md', '# Payments\n\nAPPROVED\n\nCertifyd payment records can support transaction context where payment workflows are configured.'],
    ['content-agent/knowledge/capabilities/provenance.md', '# Provenance\n\nAPPROVED\n\nCertifyd provenance records help connect work, attribution, permissions and publication context.'],
    ['content-agent/knowledge/capabilities/payouts.md', '# Payouts\n\nAPPROVED\n\nA payout is the movement of allocated earnings to creators or participants.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'music-ally-indies-infrastructure',
      publisher: 'Music Ally',
      publishedAt: '2026-09-02T09:00:00.000Z',
      title: 'Report explores AI’s indies impact and infrastructure erosion',
      summary: 'Research firm Stvdio and Secretly Distribution published a report on the independent music sector. The report examines AI’s impact on independent music and frames the issue as a fight for music’s infrastructure and infrastructure erosion.',
      articleUrl: 'https://musically.com/2026/09/02/report-explores-ais-indies-impact-and-infrastructure-erosion/',
      categories: ['Music', 'AI', 'Infrastructure'],
      certifydRelevanceScore: 14,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Report explores AI’s indies impact and infrastructure erosion',
    objective: 'Explain why the report matters to independent creators.',
    trendBrainRecordIds: 'brain:products/core,brain:capabilities/network-distribution,brain:capabilities/profiles,brain:capabilities/payments,brain:capabilities/provenance,brain:capabilities/payouts',
    trendSourceItemIds: 'music-ally-indies-infrastructure',
  });

  assert.equal(context.editorialBrief.possibleThesis, 'Independent music does not just have an AI problem. It has an infrastructure problem.');
  assert.match(context.editorialBrief.editorialTension, /infrastructure dependency/i);
  assert.match(context.editorialBrief.creatorConsequence, /operated by third parties/i);
  assert.ok(context.editorialBrief.articleProgression.length >= 4);
  assert.ok(context.editorialBrief.selectedCertifydConcepts.length <= 3);
  assert.match(context.editorialBrief.selectedCertifydConcepts.map((concept) => concept.concept).join(' '), /infrastructure|identity|publishing/i);
  assert.match(context.editorialBrief.avoidAngles.join(' '), /music-rights boilerplate|financial definitions|adjacent rights angles/i);
  const selectedIds = context.sourceRecords.map((source) => source.id);
  assert.ok(selectedIds.length <= 3);
  assert.equal(selectedIds.includes('brain:capabilities/payments'), false);
  assert.equal(selectedIds.includes('brain:capabilities/provenance'), false);
  assert.equal(selectedIds.includes('brain:capabilities/payouts'), false);

  const sourceId = context.sourceRecords[0].id;
  const contaminatedProvider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Report Explores AI and Independent Music Infrastructure',
      suggestedSlug: 'report-explores-ai-independent-music-infrastructure',
      bodyMarkdown: [
        '# Report Explores AI and Independent Music Infrastructure',
        '',
        'Music Ally reports that Stvdio and Secretly Distribution published a report about AI’s impact on independent music and framed the issue as a fight for music infrastructure.',
        '',
        '## What happened',
        '',
        'The article should not use this heading in final editorial copy.',
        '',
        '## Why it matters for creators',
        '',
        'For creators, the important issue is not only whether a new licensing deal exists. A payout is the movement of allocated earnings to creators or participants.',
      ].join('\n'),
      claims: [{ text: 'Certifyd Core can be discussed as creator-operated infrastructure.', sourceIds: [sourceId], confidence: 'supported' }],
    })),
  });
  await assert.rejects(
    () => contaminatedProvider.generateArticle({
      actorEmail: 'writer@example.test',
      topic: 'Report explores AI’s indies impact and infrastructure erosion',
      audience: 'Creators',
      objective: 'Explain the source facts.',
      trendSourceItemIds: 'music-ally-indies-infrastructure',
    }, context),
    /generic editorial section headings|generic Certifyd glossary copy|source-unsupported editorial concepts/i,
  );
});

test('X Money source story selects account and commerce infrastructure without rights boilerplate', async () => {
  const config = await makeConfig();
  const records = [
    ['content-agent/knowledge/capabilities/profiles.md', '# Profiles\n\nAPPROVED\n\nCertifyd profiles can describe creator-controlled identity and account context.'],
    ['content-agent/knowledge/capabilities/commerce.md', '# Commerce\n\nAPPROVED\n\nCertifyd commerce context can connect creator business activity to direct customer relationships where configured.'],
    ['content-agent/knowledge/products/core.md', '# Certifyd Core\n\nAPPROVED\n\nCertifyd Core can be discussed as creator-operated infrastructure for identity and commerce workflows.'],
    ['content-agent/knowledge/capabilities/provenance.md', '# Provenance\n\nAPPROVED\n\nCertifyd provenance records help connect work, attribution, permissions and publication context.'],
    ['content-agent/knowledge/capabilities/access.md', '# Access\n\nAPPROVED\n\nCertifyd access records help describe permissions and creator-controlled access decisions.'],
    ['content-agent/knowledge/capabilities/payouts.md', '# Payouts\n\nAPPROVED\n\nA payout is the movement of allocated earnings to creators or participants.'],
  ];
  for (const [relative, text] of records) {
    const file = path.join(config.siteRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'x-money-account-security',
      publisher: 'Tech news source',
      publishedAt: '2026-09-02T09:00:00.000Z',
      title: 'Attackers target user accounts after launch of X Money',
      summary: 'X Money became widely available and users received unsolicited password-reset emails. X said attackers appeared to believe accounts were now more valuable. X found no evidence of successful breaches. X Money includes payments functionality.',
      articleUrl: 'https://example.test/x-money-account-security',
      categories: ['Technology', 'Payments', 'Security'],
      certifydRelevanceScore: 12,
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Attackers target user accounts after launch of X Money',
    objective: 'Explain the account and creator-business consequence.',
    trendBrainRecordIds: 'brain:capabilities/profiles,brain:capabilities/commerce,brain:products/core,brain:capabilities/provenance,brain:capabilities/access,brain:capabilities/payouts',
    trendSourceItemIds: 'x-money-account-security',
  });

  assert.equal(context.editorialBrief.possibleThesis, 'When a social account also becomes a financial account, losing control of it means considerably more than losing the ability to post.');
  assert.match(context.editorialBrief.selectedCertifydConcepts.map((concept) => concept.concept).join(' '), /identity|commerce infrastructure/i);
  assert.match(context.editorialBrief.avoidAngles.join(' '), /unrelated music-industry boilerplate|generic financial definitions|adjacent rights angles/i);
  const selectedIds = context.sourceRecords.map((source) => source.id);
  assert.ok(selectedIds.length <= 3);
  assert.ok(selectedIds.includes('brain:capabilities/profiles') || selectedIds.includes('brain:products/core'));
  assert.ok(selectedIds.includes('brain:capabilities/commerce') || selectedIds.includes('brain:products/core'));
  assert.equal(selectedIds.includes('brain:capabilities/provenance'), false);
  assert.equal(selectedIds.includes('brain:capabilities/access'), false);
  assert.equal(selectedIds.includes('brain:capabilities/payouts'), false);
});

test('source-backed article generation is blocked by the editorial hard gate before Qwen is called', async () => {
  const config = await makeConfig();
  await fs.mkdir(path.join(config.agentRoot, 'dashboard/trends'), { recursive: true });
  await fs.writeFile(path.join(config.agentRoot, 'dashboard/trends/trend-state.json'), JSON.stringify({
    sourceItems: [{
      id: 'source-hard-gate',
      publisher: 'Music Business Worldwide',
      publishedAt: '2026-08-12T09:00:00.000Z',
      title: 'Creator Commerce Report',
      summary: 'A source story reports direct fan commerce and customer relationship changes.',
      articleUrl: 'https://example.test/creator-commerce-report',
      categories: ['Music', 'Commerce'],
    }],
    opportunities: [],
  }, null, 2));
  const context = await makeContext(config, {
    topic: 'Creator Commerce Report',
    trendSourceItemIds: 'source-hard-gate',
  });
  context.editorialBrief.verifiedFacts = [];
  context.editorialBrief.editorialTension = '';
  context.editorialBrief.creatorConsequence = '';
  context.editorialBrief.possibleThesis = '';
  context.editorialBrief.thesisTest = { status: 'FAIL', reason: 'Test failure.' };
  context.editorialBrief.articleProgression = ['one', 'two', 'three'];
  context.editorialBrief.selectedCertifydConcepts = [{ concept: 'Creator-controlled commerce', relevance: 'Relevant.', sourceConnection: '' }];
  let qwenCalled = false;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/api/tags')) return mockResponse({ models: [{ name: 'qwen3:8b' }] });
      qwenCalled = true;
      return mockResponse({ message: { content: '{}' } });
    },
  });

  await assert.rejects(
    () => provider.generateArticle({
      actorEmail: 'writer@example.test',
      topic: 'Creator Commerce Report',
      audience: 'Creators',
      objective: 'Explain the source facts.',
      trendSourceItemIds: 'source-hard-gate',
    }, context),
    /Article generation blocked by editorial gate: CORE FACTS is empty; EDITORIAL TENSION is empty; CREATOR CONSEQUENCE is empty; EDITORIAL THESIS is empty; THESIS TEST != PASS; ARTICLE ARGUMENT has fewer than 4 steps; a selected Certifyd concept has no Source connection/,
  );
  assert.equal(qwenCalled, false);
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
        'By integrating Certifyd into its platform, Suno can facilitate creator opt-in review for participating artists through Certifyd workflow tools.',
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

test('generation validation rejects leaked editorial reasoning step headings', async () => {
  const config = await makeConfig();
  const context = await makeContext(config);
  const sourceId = context.sourceRecords[0].id;
  const provider = new OllamaQwenGenerationProvider(config, {
    fetchImpl: makeOllamaFetch(validArticle(sourceId, {
      title: 'Leaked Editorial Reasoning Draft',
      suggestedSlug: 'leaked-editorial-reasoning-draft',
      bodyMarkdown: [
        '# Leaked Editorial Reasoning Draft',
        '',
        '## STEP 1 - IDENTIFY WHAT ACTUALLY HAPPENED',
        '',
        'A source story appears here.',
        '',
        '## CERTIFYD CONCEPT',
        '',
        'This should remain internal.',
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
