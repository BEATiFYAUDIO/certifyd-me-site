# Chatbot Setup

The site chatbot supports two modes:

1. FAQ fallback mode (default): no backend required.
2. Live assistant mode: set a chat API endpoint.

## Enable live mode

Add this script before the chatbot script block in `index.html`:

```html
<script>
  window.CERTIFYD_CHAT_ENDPOINT = "https://your-chat-endpoint.example.com/chat";
</script>
```

If this value is set, the chatbot will `POST` JSON:

```json
{
  "message": "user question",
  "source": "certifyd.me",
  "context": {
    "page": "https://certifyd.me/...",
    "sectionHints": ["why", "how", "product", "network", "early-access"]
  }
}
```

Expected response payload may include one of:

- `reply`
- `message`
- `answer`
- `output_text`

## Security note

Do not put provider API keys directly in `index.html`.
Use a server-side endpoint (worker/function/API) to call your model provider.

