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
