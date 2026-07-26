# Certifyd Content Dashboard Production Deployment

## Recommended architecture

- `certifyd.me` remains the public GitHub Pages site.
- `admin.certifyd.me` is the private internal dashboard.
- Cloudflare Access protects the full `admin.certifyd.me` hostname.
- Cloudflare Tunnel routes Access-approved traffic to the Node dashboard on `127.0.0.1:8000`.
- The Node dashboard verifies the Cloudflare Access JWT on every `/app/content/*` request.
- The Node dashboard enforces internal RBAC after Cloudflare identity is verified.
- The Content Engine stays private on the same host or private network.
- Publishing to the public site is draft pull request based, not direct production writes.

This keeps the public site and internal admin system separated while still allowing Vassal or another trusted collaborator to view the dashboard remotely.

## Hostnames

| Hostname | Purpose | Origin |
| --- | --- | --- |
| `certifyd.me` | Public landing site | GitHub Pages |
| `admin.certifyd.me` | Internal production dashboard | Cloudflare Access + Tunnel to Node |
| `staging-admin.certifyd.me` | Internal staging dashboard | Cloudflare Access + Tunnel to separate Node process |

Do not expose the Node dashboard at `certifyd.me/app/*`. GitHub Pages has no Node runtime, sessions, SQLite, protected APIs, secrets, or background processes.

## Authentication layers

### Layer 1: Cloudflare Access

Cloudflare Access should require approved identity provider login and ideally MFA. It blocks unauthenticated traffic before it reaches the origin.

### Layer 2: Dashboard RBAC

Cloudflare Access answers who can reach the front door. The dashboard SQLite database answers what that person can do. The environment role lists are first-run bootstrap only and should not be used as the long-term role store.

The dashboard stores users in SQLite:

```sql
users(id, email, display_name, role, enabled, created_at, last_login_at)
```

Runtime role changes should be made in the database and do not require restarting the server.

Dashboard roles:

- `founder`: full review, approval, publishing preparation and settings access.
- `editor`: article review and revision workflows, no founder approval.
- `writer`: draft creation and article workspace access.
- `marketing`: distribution and analytics visibility.
- `developer`: settings and Brain read access for operations.
- `viewer`: read-only article, preview, publishing status, distribution and analytics visibility.

For Vassal, use `viewer` unless he needs editorial actions.

## Cloudflare setup

1. Create an Access application for `https://admin.certifyd.me/*`.
2. Allow Darryl as Founder and Vassal as Viewer through Access policies.
3. Copy the application Audience Tag into `CLOUDFLARE_ACCESS_AUD`.
4. Set `CLOUDFLARE_ACCESS_TEAM_DOMAIN` to the team domain, for example `your-team.cloudflareaccess.com`.
5. Create a Cloudflare Tunnel route from `admin.certifyd.me` to `http://127.0.0.1:8000`.
6. Reserve `staging-admin.certifyd.me` now and route it to a separate process/database, for example `http://127.0.0.1:8001`.
7. Use `deploy/admin/cloudflared/config.example.yml` as the starting point.

The app still rejects requests missing a valid `Cf-Access-Jwt-Assertion`, so direct origin access does not bypass Access when `CONTENT_DASHBOARD_AUTH_MODE=cloudflare-access`.

## GitHub publishing

Use a GitHub App, not a personal access token.

Recommended permissions:

- Repository contents: Read and write
- Pull requests: Read and write
- Metadata: Read

Recommended flow:

1. Dashboard validates a Content Engine package is `READY_TO_PUBLISH`.
2. Dashboard creates a new branch.
3. Dashboard writes the generated Markdown into `content/blog/<slug>.md` with `draft: true`.
4. Dashboard opens a draft pull request.
5. A human reviews, builds, and merges.
6. GitHub Pages deploys from the normal public site workflow.

The dashboard should not push directly to `main`.

## Secrets

Store secrets in an OS-level env file such as `/etc/certifyd/content-dashboard.env`, not in git.

Required production secrets:

- `CONTENT_DASHBOARD_SESSION_SECRET`
- `CONTENT_DASHBOARD_DB_PATH`
- `CLOUDFLARE_ACCESS_AUD`
- `GITHUB_APP_PRIVATE_KEY` when GitHub publishing is enabled

The dashboard settings page only reports whether integrations are configured. It does not display secret values or absolute engine output paths.

## Minimum viable production deployment

1. Node dashboard runs on a small private VM or trusted machine.
2. Cloudflare Tunnel exposes only `admin.certifyd.me`.
3. Cloudflare Access protects the hostname.
4. Dashboard runs with `CONTENT_DASHBOARD_AUTH_MODE=cloudflare-access`.
5. Darryl has `founder`; Vassal has `viewer`.
6. GitHub publishing remains disabled until the GitHub App is installed.
7. Backups include SQLite, Content Engine outputs, Brain files, dashboard audit logs and the public site repository.

## Health checks

The dashboard exposes non-sensitive monitoring endpoints:

- `/health`: process is alive.
- `/ready`: dashboard enabled and ready flag.
- `/version`: dashboard service name and version.

Keep these behind the private admin hostname unless your monitoring system requires a separate private route.

## Backups

Back up these paths on an automated schedule:

- SQLite database at `CONTENT_DASHBOARD_DB_PATH`.
- Content Engine outputs at `CONTENT_AGENT_OUTPUT_DIR`.
- Brain and knowledge files under `CONTENT_AGENT_ROOT`.
- Audit logs under `CONTENT_AGENT_ROOT/review`.

Restore tests matter more than backup creation. Schedule periodic test restores before relying on the system for production content approvals.


## Temporary testing before Cloudflare Zero Trust is active

This is a temporary tunnel test mode only. It is not production deployment.

Use this only while Cloudflare Zero Trust billing/activation is blocked:

1. Keep `admin.certifyd.me` private and do not invite other users.
2. Run the dashboard bound to localhost only:

```bash
HOST=127.0.0.1 PORT=8000 \
CONTENT_DASHBOARD_ENABLED=true \
CONTENT_DASHBOARD_AUTH_MODE=cloudflare-access \
ALLOW_TEMPORARY_TUNNEL_TESTING=true \
CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN=replace-with-temporary-token \
CONTENT_DASHBOARD_SESSION_SECRET=replace-with-long-random-secret \
CONTENT_DASHBOARD_FOUNDER_EMAILS=darryl@example.com \
CONTENT_AGENT_ROOT=/srv/certifyd/content-agent \
npm run start:admin
```

3. Open `https://admin.certifyd.me/health` and confirm it returns only `{"status":"ok"}`.
4. Sign in through the dashboard local login form.
5. Stop the process immediately after testing.
6. Unset `ALLOW_TEMPORARY_TUNNEL_TESTING` or set it back to `false`.

Temporary tunnel mode does not create anonymous dashboard access. It only allows the normal application login/session path to work when Cloudflare Access is not active yet. RBAC still comes from the SQLite users table. Client-controlled headers such as `X-Forwarded-Email` are not trusted.

## Production-readiness warning

Do not treat the dashboard as publicly deployed until all of these are true:

- Cloudflare Zero Trust Access is enabled.
- The Access application protects `admin.certifyd.me`.
- `CLOUDFLARE_ACCESS_AUD` and `CLOUDFLARE_ACCESS_TEAM_DOMAIN` are configured.
- App-layer JWT validation succeeds against Cloudflare Access.
- `ALLOW_TEMPORARY_TUNNEL_TESTING=false`.
- Direct origin requests without a valid `Cf-Access-Jwt-Assertion` fail closed.

## Long-term version

- Managed container or private VM with automated deploys.
- Cloudflare Access with MFA and device posture policies.
- GitHub App draft PR publishing enabled behind the publisher interface.
- Centralized logs with query-token redaction.
- Regular backup restore tests.
- Separate staging and production dashboards.
- Hardware-backed authentication for founder accounts.

## Operational checks

Run before production cutover:

```bash
npm run test:dashboard
npm run build
CONTENT_DASHBOARD_AUTH_MODE=cloudflare-access npm run start:admin
```

Then test:

- unauthenticated access to `admin.certifyd.me/app/content` is blocked by Cloudflare;
- direct origin access without Cloudflare headers is rejected by the app;
- Vassal can access read-only pages only;
- Vassal cannot see Settings, Brain, approval, revision or publishing action controls;
- Founder can approve and prepare packages;
- GitHub PR publishing creates draft PRs only when enabled.
