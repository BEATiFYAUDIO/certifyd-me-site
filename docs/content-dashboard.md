# Certifyd Content Dashboard

The Certifyd Content Dashboard is an internal operating interface for the Certifyd Content system. It is not a public product and it does not publish content live unless a publishing adapter is explicitly configured.

## Architecture

`certifyd-me-site` is a static GitHub Pages site. It has no framework router, no account model, no protected route system, no SQLite runtime and no place to store application secrets.

The dashboard runs as a separate Node application under a private admin hostname. The recommended production route is:

- `certifyd.me`: public GitHub Pages site.
- `admin.certifyd.me`: Cloudflare Access + Cloudflare Tunnel to the Node dashboard.
- `staging-admin.certifyd.me`: separate staging dashboard process for testing AI/content pipeline changes.

The dashboard server lives under:

- `scripts/content-dashboard-server.js`
- `scripts/content-dashboard/`

The dashboard reads and writes Content Engine artifacts through repository/action classes. It does not expose generic shell access or arbitrary file paths.

## Routes

Public static routes remain unchanged:

- `/`
- `/network.html`
- `/blog`
- `/blog/:slug`

Health routes:

- `/health`
- `/api/health`
- `/ready`
- `/version`

Internal protected routes:

- `/app/login`
- `/app/content`
- `/app/content/articles`
- `/app/content/articles/:runId`
- `/app/content/articles/:runId/preview`
- `/app/content/review/:runId`
- `/app/content/brain`
- `/app/content/topics`
- `/app/content/publishing`
- `/app/content/distribution`
- `/app/content/analytics`
- `/app/content/settings`

## Current Pages

The current implementation includes:

- Overview
- Articles
- Article workspace
- Founder review
- Authenticated Blog preview
- Brain visibility
- Topics
- Publishing preparation
- Distribution assets
- Analytics empty states
- Settings

## Auth and RBAC

Production mode uses Cloudflare Access for the outer gate and SQLite users for internal roles. Environment role mappings are first-run bootstrap only; the database is the source of truth after initialization.

Supported roles:

- `founder`
- `editor`
- `writer`
- `marketing`
- `developer`
- `viewer`

Viewer is intended for Vassal or other trusted collaborators who need read-only visibility.

## Publishing

Publishing is abstracted behind a publisher interface.

Current adapters:

- Disabled/local package adapter.
- GitHub draft pull request adapter.

The GitHub adapter uses a GitHub App, creates a draft branch and opens a draft pull request. It does not merge, force-push, deploy directly or use a personal access token.

## Distribution safety

Automatic destination posting and canonical-bearing manual exports require a Certifyd article that has been verified live for the exact published version. A GitHub write or draft PR leaves the Certifyd destination in `publishing`; the founder must use **Verify Live** after deployment. Verification compares the public article HTML with the generated article HTML recorded at publish time and checks its canonical link. Editing the article after publication closes the gate until the updated version is republished and verified.

Each destination attempt is persisted in `distribution/destinations.json` before its API call, with an operation key, attempt ID, prior external identity, timestamps and result history. A confirmed response must include an external post ID. A missing response or identity becomes `uncertain` and blocks automatic retry. The founder must check the external platform, then record its post ID or explicitly confirm that no post was created. The per-destination Retry control applies only to a certain failure; successful destinations are left alone. An article-level lock prevents concurrent publish actions, and an interrupted in-flight attempt remains visible for reconciliation after restart.

Connector credentials remain in the dashboard server environment. Platform response bodies are excluded from persisted distribution errors.

### Distribution Phase 2

The founder flow is **Approve → Publish Certifyd → Verify Live → review destinations → Publish Everywhere**. On first use, DEV, WordPress, and all manual exports are preselected; disconnected automatic destinations will be skipped. Saved destination defaults then preselect the article form, and the founder can adjust them for that article. Publish Everywhere runs each selected destination independently and shows confirmed, failed, uncertain, manual-ready, and skipped outcomes. A failed or uncertain destination does not erase a successful one. Retrying targets only a certain failure; an uncertain API result requires checking the platform and reconciling the external post first. Repeated submission skips posts already confirmed for the article version, and the article-level lock rejects concurrent submissions.

Phase 2 automatic destinations are **DEV Community** and **WordPress**; the Blogger OAuth upgrade adds Blogger as an opt-in automatic destination after connection testing. LinkedIn, X, Facebook, Reddit, Ghost, and Hashnode remain disabled in this workflow even if their scaffold or credentials exist. Manual exports are Markdown, HTML, email, PDF source, Medium, and Substack. Their generated content can be viewed, copied, and downloaded in the Distribution workspace after live Certifyd verification; an article edit hides stale exports until the new version is verified and exports are regenerated. **PDF source** is text for a later PDF workflow; it is not a PDF file. A founder can record a manual destination as externally published with its public HTTPS URL. That stores the article version, Certifyd canonical URL, timestamp, and `publicationMethod: manual`; it does not claim an API post occurred.

DEV uses an API key in `CONTENT_DISTRIBUTION_DEVTO_API_KEY`. Set optional `CONTENT_DISTRIBUTION_DEVTO_USERNAME` to require a specific DEV account. **Test connection** calls DEV's authenticated `/api/users/me` endpoint. DEV receives Markdown, the Certifyd canonical URL, up to four normalized tags, description, and a public Certifyd cover-image URL when available. It returns an article ID and public URL. The adapter supports create and update, but does not offer deletion.

WordPress uses an HTTPS site URL in `CONTENT_DISTRIBUTION_WORDPRESS_API_URL`, a username in `CONTENT_DISTRIBUTION_WORDPRESS_USERNAME`, and a WordPress Application Password in `CONTENT_DISTRIBUTION_WORDPRESS_APPLICATION_PASSWORD`. **Test connection** calls `/wp-json/wp/v2/users/me?context=edit`. The adapter creates and updates posts using the REST API. It converts Markdown to escaped, structured HTML with a clickable Certifyd attribution link. When there is a Certifyd cover image, it uploads the image to WordPress media, records the media ID before creating/updating the post, and reuses that media ID on retry or update. If a media or post response is ambiguous, reconcile the destination before retrying. Deletion and unpublishing are not offered by this adapter.

WordPress canonical handling has two observed outcomes per post. An installation may register a REST-visible canonical meta key and configure it as `CONTENT_DISTRIBUTION_WORDPRESS_CANONICAL_META_KEY`; the dashboard still reports **canonical verified** only after the public WordPress page emits a canonical link to the Certifyd article. Otherwise it reports **canonical unverified** while retaining the visible “Originally published on Certifyd” link. A custom REST meta field alone does not change the page's canonical tag. The connected WordPress site needs its own theme or SEO-plugin configuration to emit the desired tag. These destinations have been verified against official API documentation and mocked tests; no live external account has been tested or used to publish.

Connection states are **not configured**, **configured**, **connected**, and **connection test failed**. Only a successful account test makes DEV, WordPress, or Blogger connected; results expire after 24 hours. The dashboard persists status, account ID and test time, never credentials or authorization headers. Disconnected automatic destinations are skipped with an explicit reason.

### Blogger OAuth

Register a Google OAuth 2.0 **Web application** with this exact authorized redirect URI: `https://admin.certifyd.me/app/content/oauth/blogger/callback`. Configure `CONTENT_DISTRIBUTION_BLOGGER_CLIENT_ID`, `CONTENT_DISTRIBUTION_BLOGGER_CLIENT_SECRET`, and `CONTENT_DISTRIBUTION_BLOGGER_BLOG_ID` server-side. The dashboard public URL must be `https://admin.certifyd.me`. A founder uses **Connect Blogger** in Distribution to grant `https://www.googleapis.com/auth/blogger` with offline access. Google returns to the fixed callback; the server validates the one-time state against the founder session, exchanges the authorization code, requires a refresh token, and verifies that the Google account can access the configured blog. No Blogger article is published during connection or Test Connection.

The refresh token is stored as AES-256-GCM ciphertext in `CONTENT_AGENT_ROOT/dashboard/blogger-oauth.enc.json` with file mode `0600`; its encryption key is derived from `CONTENT_DASHBOARD_SESSION_SECRET`. Keep that session secret stable and back it up securely: rotating it without migrating the token requires reconnecting Blogger. Short-lived access tokens stay in server memory and are automatically refreshed. **Disconnect Blogger** deletes the encrypted token file and clears the connection test. Test Connection performs an authenticated, read-only blog-list request; its successful result expires after 24 hours. Blogger create and update retain the existing Certifyd-first distribution state and do not offer deletion. The post includes a visible Certifyd attribution link; Blogger canonical tags are not set or verified by this adapter. OAuth is not usable until the client is registered in Google Cloud.

## Local AI Generation

The production blog-writing provider is local Ollama running Qwen 3. The deterministic generator remains available as the explicit offline/test fallback.

Install and verify the model on the machine running the dashboard:

```bash
ollama pull qwen3:8b
ollama run qwen3:8b
```

Dashboard environment:

```bash
CONTENT_MODEL_PROVIDER=ollama
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CONTENT_MODEL=qwen3:8b
OLLAMA_REQUEST_TIMEOUT_MS=180000
OLLAMA_MAX_OUTPUT_TOKENS=5000
OLLAMA_TEMPERATURE=0.35
OLLAMA_CONTEXT_LIMIT=24000
OLLAMA_THINK=false
OLLAMA_MAX_CONCURRENT_GENERATIONS=1
```

Operational rules:

- Ollama is called only from the Node dashboard server. Browser code must never call `:11434` directly.
- `OLLAMA_BASE_URL` must be localhost or a private-network origin. Do not expose Ollama through Cloudflare.
- Generation requires `content.article.create`; publishing remains a separate founder/PR workflow.
- Qwen receives targeted approved Brain context, article intake fields and source IDs. It must not receive secrets, tokens, GitHub keys, Cloudflare keys or full private logs.
- Qwen output is saved as `status: "draft"` and `PENDING_FOUNDER_REVIEW`. The model cannot approve, publish, create GitHub branches, merge PRs or set public status.
- Claim validation rejects unknown Brain source IDs and blocks model-supplied publication state. Unsupported claims and risky wording remain warnings until founder review.
- One active local generation is allowed per user. The default global concurrency is one generation at a time.
- The Local AI health endpoint is protected at `/app/content/model-health` and returns only enabled/reachable/model/modelInstalled status.

Troubleshooting:

- `modelInstalled: false`: run `ollama pull qwen3:8b`.
- `reachable: false` or connection errors: start Ollama locally and confirm `OLLAMA_BASE_URL`.
- timeout errors: increase `OLLAMA_REQUEST_TIMEOUT_MS` only if the machine is slow; do not add retries that can create duplicate drafts.
- busy errors: wait for the active generation to finish or cancel it in the browser.

## Trend Research

The Blog Engine can suggest source-backed article opportunities from approved RSS/Atom feeds. Qwen evaluates source summaries supplied by the dashboard; it must not claim it searched the web itself.

Provider IDs:

- `seeded`: development examples only.
- `rss`: approved RSS/Atom feeds.
- `composite`: RSS/Atom now, with explicit unavailable placeholders for future search and social providers.
- `manual`: founder-entered ideas.
- `search`: future provider placeholder; no live search data is fabricated.
- `social`: future provider placeholder; X/social trends are not claimed without an approved integration.

Environment:

```bash
CONTENT_TREND_PROVIDER=composite
CONTENT_TREND_SOURCE_URLS=
CONTENT_TREND_SCAN_MAX_ITEMS_PER_SOURCE=30
CONTENT_TREND_MAX_ITEM_AGE_DAYS=7
CONTENT_TREND_SCAN_TIMEOUT_MS=20000
CONTENT_TREND_MAX_CONCURRENT_FETCHES=3
CONTENT_TREND_DEFAULT_LOCALE=en-CA
CONTENT_TREND_DAILY_SCAN_ENABLED=false
CONTENT_TREND_SCAN_HOUR=7
CONTENT_TREND_QWEN_EVALUATION_ENABLED=false
```

Manual scan:

```bash
npm run trends:scan
```

Operational rules:

- Source fetching is server-side only and rejects localhost, loopback, private-network and link-local feed URLs unless test mode explicitly permits them.
- Fetching uses timeouts, redirect limits, response-size limits and feed parsing for RSS 2.0 and Atom.
- The dashboard stores feed titles, summaries, links and source attribution only; it does not copy full article bodies.
- One unavailable source does not fail the entire scan.
- Source-backed opportunities show source counts, publishers, freshness, risk flags and Brain coverage. Trend scans use deterministic source-backed ranking by default; set `CONTENT_TREND_QWEN_EVALUATION_ENABLED=true` only if slower local-model ranking is acceptable.
- Generating from a trend passes opportunity ID, source item IDs and Brain record IDs into the article run for provenance.
- Saving a trend idea persists it in `content-agent/dashboard/trends/trend-state.json`; saved ideas are deduplicated by opportunity ID and survive later scans.
- Trend scanning defaults to `composite`, which uses approved RSS/news sources first. Use `CONTENT_TREND_PROVIDER=seeded` only for local fixture demos; seeded scans are prevented from overwriting existing source-backed scan results.
- A trend scan never approves or publishes an article automatically.
- Daily scans are disabled by default. When `CONTENT_TREND_DAILY_SCAN_ENABLED=true`, the dashboard process schedules one local scan per day at `CONTENT_TREND_SCAN_HOUR`. Use `npm run trends:scan` for a manual scan or external cron/systemd if the dashboard process is not expected to stay running.

## Current Run

The dashboard is designed to show the existing Content Engine run:

- `core-explainer-001`
- title: `What Certifyd Core Is`
- status: `PENDING_FOUNDER_REVIEW`
- publishability: `BLOCKED_PENDING_APPROVAL`
- canonical URL: `https://certifyd.me/blog/what-certifyd-core-is`
- model mode: deterministic fallback

## Temporary tunnel testing

If Cloudflare Zero Trust is temporarily unavailable, set `ALLOW_TEMPORARY_TUNNEL_TESTING=true` only for a private test session. The dashboard still requires local application login and SQLite-backed RBAC. Do not invite other users or consider the dashboard production-ready until Cloudflare Access is active and the temporary flag is disabled.

## Production Responsibilities

Before production use, configure:

- Cloudflare Access policy with approved users and MFA.
- Cloudflare Tunnel routes for production and staging admin hostnames.
- SQLite dashboard database path on persistent storage.
- Backup jobs for SQLite, Content Engine outputs, Brain files and audit logs.
- Optional GitHub App credentials for draft PR publishing.
- Monitoring against `/health`, `/ready` and `/version`.

## Limitations

- No live analytics adapters are connected.
- No live social publishing APIs are connected.
- GitHub publishing is disabled until the GitHub App is installed and configured.
- Local filesystem storage is acceptable for the initial internal deployment but must be backed up.
- Local token login is development-only; production should use Cloudflare Access.
