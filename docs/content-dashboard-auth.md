# Content Dashboard Auth

## Auth Boundary

`certifyd-me-site` is a static GitHub Pages site. It has no server-side sessions, protected APIs, SQLite runtime, application secrets or durable background workers.

The internal Content Dashboard therefore runs as a separate Node application. In production it should sit behind Cloudflare Access and Cloudflare Tunnel on a private admin hostname such as `admin.certifyd.me`.

Cloudflare Access answers: "is this person allowed through the front door?"

The dashboard SQLite user database answers: "what can this person do?"

## Required Environment Variables

```bash
export CONTENT_DASHBOARD_ENABLED=true
export CONTENT_DASHBOARD_AUTH_MODE="cloudflare-access"
export ALLOW_TEMPORARY_TUNNEL_TESTING=false
export CONTENT_DASHBOARD_SESSION_SECRET="replace-with-long-random-secret"
export CONTENT_DASHBOARD_FOUNDER_EMAILS="darryl@example.com"
export CONTENT_DASHBOARD_DB_PATH="/srv/certifyd/content-agent/dashboard/content-dashboard.sqlite"
export CONTENT_AGENT_ROOT="/srv/certifyd/content-agent"
export CLOUDFLARE_ACCESS_TEAM_DOMAIN="certifyd.cloudflareaccess.com"
export CLOUDFLARE_ACCESS_AUD="replace-with-access-application-audience"
```

For local development only:

```bash
export CONTENT_DASHBOARD_AUTH_MODE="local"
export CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN="replace-with-local-login-token"
```

Optional first-run bootstrap mapping:

```bash
export CONTENT_DASHBOARD_ALLOWED_ROLES="viewer:vassal@example.com;editor:editor@example.com"
```

The role mapping is only used when the SQLite `users` table is empty. After the database exists, roles should be changed in SQLite, not environment variables.

## User Store

The dashboard stores users in SQLite:

```text
users
-----
id
email
display_name
role
enabled
created_at
last_login_at
```

Cloudflare Access identity is matched to the database by email. Disabled users and missing users are rejected even if Cloudflare Access lets them through.

## Permissions

Roles map to explicit permissions:

- Founder: full dashboard, approval, settings, publishing preparation and Brain read/write.
- Editor: article edit, review, revision, publishing preparation visibility, distribution, analytics and Brain read.
- Writer: article draft/create/edit, research visibility, analytics and Brain read.
- Marketing: article, distribution and analytics visibility.
- Developer: article, settings, validation/distribution/analytics/publishing visibility and Brain read.
- Viewer: read-only articles, previews, publishing status, distribution and analytics visibility.

Brain access is split into separate permissions:

- `brain.read`
- `brain.write`

## Login Flow

### Production Cloudflare Access Mode

1. Cloudflare Access authenticates approved users before traffic reaches the origin.
2. Cloudflare injects `Cf-Access-Jwt-Assertion`.
3. The Node dashboard verifies the JWT issuer, audience, expiry and RS256 signature.
4. The verified email is resolved against the SQLite users table.
5. Dashboard RBAC is enforced per route and per action.

Direct origin access without a valid Cloudflare Access JWT fails closed.

### Local Development Mode

1. Unauthenticated users requesting `/app/content/*` are redirected to `/app/login?returnTo=<safe-path>`.
2. The login form accepts an enabled database user email and the local login token.
3. The server creates an HttpOnly, SameSite=Lax signed session cookie.
4. The user is redirected back to the original safe dashboard path.

Open redirects are blocked. Only same-origin `/app/*` return paths are accepted.

## Health Endpoints

- `/health`: process is alive and returns only `{ "status": "ok" }`.
- `/api/health`: same minimal health response for simple proxy checks.
- `/ready`: dashboard enabled flag and auth mode.
- `/version`: service name and package version.

## Temporary Tunnel Testing

Before Cloudflare Zero Trust Access is active, temporary tunnel testing can be enabled explicitly with `ALLOW_TEMPORARY_TUNNEL_TESTING=true`. This mode is disabled by default.

When enabled in `cloudflare-access` auth mode, missing Cloudflare Access JWTs may fall back to the normal local login/session flow. This does not grant anonymous access, does not create users, does not assign founder privileges and does not trust client-controlled identity headers.

Disable this flag before production use.

## Local Use

Start the local dashboard server:

```bash
npm run serve:dashboard
```

or:

```bash
npm run start:admin
```

Default local URLs:

- `http://localhost:8000/app/login`
- `http://localhost:8000/app/content`

## Security Notes

- Auth is enforced server-side.
- Authorization is enforced per route and per action.
- Mutating forms require CSRF tokens.
- Secrets are never displayed in settings.
- Absolute engine paths are not returned in normal dashboard settings responses.
- Production access should use Cloudflare Access with MFA, plus dashboard RBAC.
- Local token login is development-only and should not be exposed publicly.
