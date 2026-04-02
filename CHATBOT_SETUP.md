# Chatbot Setup

The site chatbot supports two modes:

1. FAQ fallback mode (default): no backend required.
2. Live assistant mode: set `window.CERTIFYD_CHAT_ENDPOINT`.

## Recommended free setup (OpenRouter + Cloudflare Worker)

This repo includes a Worker proxy at:

- `worker/chat-api/src/index.js`

It supports:

- `CHAT_PROVIDER=openrouter` (default, free-friendly)
- `CHAT_PROVIDER=openai` (optional)

### 1. Deploy worker

```bash
cd worker/chat-api
npm install
npx wrangler login
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler deploy
```

After deploy, copy the Worker URL (for example `https://certifyd-chat-api.<account>.workers.dev`).

### 2. Wire site endpoint

Add this before the main site script in `index.html`:

```html
<script>
  window.CERTIFYD_CHAT_ENDPOINT = "https://certifyd-chat-api.<account>.workers.dev";
</script>
```

## Request payload from site

When endpoint is set, frontend sends:

```json
{
  "message": "user question",
  "source": "certifyd.me",
  "context": {
    "page": "https://certifyd.me/...",
    "sectionHints": ["ownership", "own", "how", "product", "network", "early-access"]
  }
}
```

## Response payload expected by site

Any one of these fields is accepted:

- `reply` (preferred)
- `message`
- `answer`
- `output_text`

## Security note

Do not place model API keys in `index.html`.
Always call model providers from the Worker/server.
