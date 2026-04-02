const DEFAULTS = {
  openaiModel: 'gpt-4o-mini',
  openrouterModel: 'openrouter/free',
  maxMessageChars: 2000,
  maxTokens: 220,
};

function sanitizeMessage(input) {
  return String(input || '').trim().slice(0, DEFAULTS.maxMessageChars);
}

function allowedOrigin(request, env) {
  const configured = String(env.ALLOWED_ORIGIN || '*').trim();
  if (configured === '*') return '*';
  const origin = request.headers.get('origin') || '';
  if (origin === configured) return configured;
  return configured;
}

function corsHeaders(request, env, extra = {}) {
  return {
    'access-control-allow-origin': allowedOrigin(request, env),
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    ...extra,
  };
}

function json(request, env, data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env, init.headers),
    },
  });
}

function buildSystemPrompt() {
  return [
    'You are the Certifyd website assistant.',
    'Keep responses concise, direct, and factual.',
    'Primary message: Certifyd is creator-owned publishing and commerce, not a closed platform.',
    'Focus on identity, publishing, payments, splits, receipts, payouts, and early access.',
    'Do not invent pricing, guarantees, dates, or roadmap claims.',
    'If asked for account-specific support, direct user to early access/contact forms on the site.',
  ].join(' ');
}

async function callOpenAI({ apiKey, model, system, message }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      max_output_tokens: DEFAULTS.maxTokens,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(`openai_${response.status}:${text.slice(0, 300)}`);
  }

  return (
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    data?.choices?.[0]?.message?.content ||
    ''
  ).trim();
}

async function callOpenRouter({ apiKey, model, system, message, siteUrl }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'http-referer': siteUrl || 'https://certifyd.me',
      'x-title': 'Certifyd Website Chat',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      max_tokens: DEFAULTS.maxTokens,
      temperature: 0.2,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(`openrouter_${response.status}:${text.slice(0, 300)}`);
  }

  return (
    data?.choices?.[0]?.message?.content ||
    data?.output_text ||
    ''
  ).trim();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method !== 'POST') {
      return json(request, env, { error: 'method_not_allowed' }, { status: 405 });
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch {
      return json(request, env, { error: 'invalid_json' }, { status: 400 });
    }

    const message = sanitizeMessage(payload?.message);
    if (!message) {
      return json(request, env, { error: 'message_required' }, { status: 400 });
    }

    const system = buildSystemPrompt();
    const provider = String(env.CHAT_PROVIDER || 'openrouter').trim().toLowerCase();

    try {
      let reply = '';

      if (provider === 'openai') {
        const apiKey = String(env.OPENAI_API_KEY || '').trim();
        if (!apiKey) {
          return json(
            request,
            env,
            { error: 'missing_openai_api_key', message: 'Server missing OPENAI_API_KEY secret.' },
            { status: 500 },
          );
        }
        const model = String(env.OPENAI_MODEL || DEFAULTS.openaiModel).trim() || DEFAULTS.openaiModel;
        reply = await callOpenAI({ apiKey, model, system, message });
      } else {
        const apiKey = String(env.OPENROUTER_API_KEY || '').trim();
        if (!apiKey) {
          return json(
            request,
            env,
            { error: 'missing_openrouter_api_key', message: 'Server missing OPENROUTER_API_KEY secret.' },
            { status: 500 },
          );
        }
        const model = String(env.OPENROUTER_MODEL || DEFAULTS.openrouterModel).trim() || DEFAULTS.openrouterModel;
        reply = await callOpenRouter({
          apiKey,
          model,
          system,
          message,
          siteUrl: String(payload?.context?.page || ''),
        });
      }

      return json(request, env, {
        reply: reply || 'I can help with Certifyd ownership, product flow, and early access questions.',
      });
    } catch (error) {
      return json(
        request,
        env,
        {
          error: 'chat_failed',
          message: 'Chat service is temporarily unavailable.',
          detail: String(error?.message || error || 'unknown'),
        },
        { status: 502 },
      );
    }
  },
};
