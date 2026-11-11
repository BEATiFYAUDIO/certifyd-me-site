# Dashboard production reconciliation — pre-commit review

Date: November 11, 2026 (America/Toronto). Status: local, uncommitted candidate; no production restart, deployment or runtime-data migration.

Branch: `feature/dashboard-production-reconciliation`.
Worktree: `/home/Darryl/Projects/certifyd-me-dashboard-reconciled`.
Base: `7cc8f998d3713074f6f71651da589219d54c8176`.
Production checkout remains at `b5b5f90633c6fc9585ce48d586b1718ee5eeaa2b` with its original local work preserved.

## Result and protected behavior

The candidate adds only still-needed local LinkedIn/Blogger/static-security source changes onto current main. It does not replace production files wholesale, change the Blog Engine architecture, or carry production data into the new checkout. Current main is the authoritative implementation for generation, manual paste, founder approval, Certifyd publishing, Verify Live, article-version gating, dashboard staging, existing destinations, retry/uncertain outcomes and Brain SEO proposals.

Protected method bodies checked byte-for-byte against main: `generateDraft`, `createManualDraft`, `approve`, `preparePublishing`, `validatePublishing`, `validateRepublishing`, `publishToCertifyd`, `republishToCertifyd`, `resolveDistributionOutcome`, `markManualExternallyPublished`, `normalizeDistributionSelections`, `verifyLivePublication`, `verifyLivePublicationLocked`, and all existing SEO queue/generation/current-proposal/review/save and article-save methods. All original test cases are retained.

Generation provider, generation-provider tests, SEO strategy/scoring/tests, repository, permission/security module, user/database module, publisher, config loader and startup/daemon scripts remain byte-identical to main. Existing DEV and WordPress adapters, manual-export implementation, distribution state persistence, operation locks, identity checks and outcome-reconciliation code are retained. LinkedIn enters the existing founder-authorized distribution flow; it does not establish a second publishing system.

The intended behavior change for Blogger is actionable expired/revoked-token diagnosis and reconnect state. Successful Blogger publishing/OAuth behavior remains protected. Existing destination payloads retain their prior content; the package gains additive source-fingerprint metadata for LinkedIn approval. Suggested SEO links remain recommendations; SEO never changes indexing, article content, approval or publishing state.

## Exact changed files (14)

| File | Reason |
|---|---|
| `.gitignore` | Exclude encrypted LinkedIn token envelopes and temporary token writes. |
| `deploy/admin/env.example` | Document LinkedIn client/Page/version placeholders; no real credentials. |
| `docs/content-dashboard.md` | Append LinkedIn workflow and Blogger reconnect notes while retaining main Brain SEO documentation. |
| `docs/dashboard-production-reconciliation-precommit-review.md` | This review and cutover/rollback contract. |
| `package.json` | Retain main dashboard/SEO tests and add LinkedIn/static-security suites. No dependency or lockfile changes. |
| `scripts/content-dashboard/actions.js` | Integrate LinkedIn connection actions, source-bound copy checks and media checkpoints into existing distribution. |
| `scripts/content-dashboard/blogger-oauth.js` | Preserve expired refresh-token handling without logging provider response bodies. |
| `scripts/content-dashboard/distribution-adapters.js` | Register LinkedIn Page adapter, verify/upload/reuse media, validate returned external post identity. |
| `scripts/content-dashboard/distribution-package.js` | Include source fingerprint in approved destination payload metadata. |
| `scripts/content-dashboard/linkedin-oauth.js` | New-to-main local OAuth implementation: founder/session-bound state, Page authorization, encrypted atomic storage, expiry and disconnect. |
| `scripts/content-dashboard/server.js` | Add LinkedIn routes/UI, precise article Generate routing, and private static-file containment; preserve main SEO jobs/routes/panel and distribution layout. |
| `test/content-dashboard.test.js` | Retain main fixtures/tests; add six local regression tests, fixture isolation test, and a portable private-path assertion. |
| `test/content-static-security.test.js` | Five isolated security groups covering private namespaces, traversal/symlinks, custom roots and protected workspace/public assets. |
| `test/linkedin-oauth.test.js` | Three isolated mocked OAuth/media tests, including rejecting an untrusted upload destination. |

## Preserved production-local hunks

Hunk numbers below refer to the immutable audit's `comparisons/main-to-local/<file>.patch`, under `/home/Darryl/Projects/dashboard-reconciliation-review-2026-11-11/`. Those full patches and the 138-file evidence snapshot remain outside the candidate.

| Source | Local hunks retained | Purpose and integration choice |
|---|---|---|
| `.gitignore` | 1 | Keep only LinkedIn envelope exclusions. |
| `deploy/admin/env.example` | 1 | Keep LinkedIn configuration examples. |
| Dashboard docs | 1–2; additive portion of 3 | Preserve LinkedIn/Blogger notes; append LinkedIn section after, rather than instead of, Brain SEO docs. |
| Actions | 6–12, 15–18 | LinkedIn connection state/actions, package fingerprint, permitted destination, source-bound approved copy, media preparation/checkpoints and LinkedIn-only preflight. Preserve main SEO wiring and review/hash protections. |
| Blogger OAuth | 1–2 | Recognize invalid_grant on refresh and surface reconnect guidance without response-body leakage. |
| Distribution adapters | All local-only delta | LinkedIn import/registration/availability and the new adapter; existing destination classes and state machinery retained. |
| Distribution package | 1 | Add sourceFingerprint to approval payload. |
| Server | 2, 4–5, additive LinkedIn actions from 6, 12–13, 15 | LinkedIn import/callback/actions/copy and connect UI; precise Generate route; full static containment. Main SEO actions retained alongside LinkedIn actions. |
| Dashboard tests | 1, 12, additive local tests from 13 | Keep LinkedIn import, expired Blogger test, five local tail tests. Retain the main Brain SEO integration test and all main fixture updates. |
| LinkedIn OAuth source and two new test files | Entire new source files | Files absent from main, dependency/security requirements of the preserved local feature. These contain test credentials only, not production secrets/state. |

New safety coverage asserts that default dashboard fixture roots are temporary and SQLite is in-memory. The existing private-path non-disclosure test now checks the actual fixture paths instead of matching a hard-coded machine path.

## Excluded local changes and why

- Main/local actions hunks 1–5, 13–14, and server hunks removing SEO imports, jobs, actions or panels: these represent missing main functionality in the old checkout, not desired changes. Keep main.
- Local generation provider and its test file: byte-identical to pre-PR21 main, already upstream except for missing PR21 additions. Keep current main entirely.
- Local dashboard fixture imports/root/guide/sitemap changes that would undo main test isolation or coverage: excluded. No hard-coded contentbox fixture dependency is carried forward.
- Server hunk 14 optional distribution-panel collapse and revised distribution wording: excluded as unnecessary UI simplification. Main distribution layout/guidance remains intact.
- Local homepage/footer, public privacy/policy pages, protected CTR articles and matching artwork: already represented on main or unrelated to this code task. No public content/assets/branding edits.
- Thirteen local Brain knowledge/source-record changes from the audit: excluded from this code reconciliation under the explicit runtime-data boundary. They remain in the original agent root and private evidence. No knowledge/output migration or deletion.
- Runtime distribution defaults/connections, database/SQLite sidecars, OAuth envelopes, secrets/env files, article/output state, logs, caches, temporary evidence and screenshots: not copied or added. OAuth code and mocked test fixtures are source; actual tokens/state are not.
- Raw source-material captures and generated artwork: preserved in original storage/evidence, excluded from Git and the candidate source delta.

## Overlaps resolved manually

No Git merge/stash/reset/pull/rebase was performed in production. Integration used selected text changes against clean main, not whole-file copies of modified production source.

- Actions: retained main constructor, background scheduling, deduplication, current-request/hash checks, accepted-strategy separation and founder state; inserted LinkedIn changes into the existing distribution methods only.
- Server: retained main SEO scheduling/UI/actions and generic background jobs, then added LinkedIn routes and security checks. Both route sets coexist. Precise article Generate matching prevents distribution Generate from routing to article intake.
- Package: union of four test files, keeping SEO coverage alongside the new suites.
- Dashboard tests: retained the complete main Brain SEO integration test and temporary roots; appended local regression cases. No production-coupled fixture configuration was transplanted.
- Documentation: retained both Brain SEO and LinkedIn sections rather than choosing one tail over the other.
- Generation provider: no remaining source conflict to resolve; keep main.

## Validation results

The exact main suite was run unchanged first in this clean worktree. Every validation was run here, never in the production checkout. Test launchers use a sanitized environment without production credentials/configuration; fixtures own their runtime paths and all publishing/OAuth network interactions use test doubles.

| Suite | Unchanged main baseline | Final candidate |
|---|---:|---:|
| Blog build | 14 pass | 14 pass |
| Dashboard + Brain SEO, plus new reconciliation suites | 126 pass | 141 pass |
| Generation/Brain provider | 158 pass | 158 pass |
| Trends | 85 pass | 85 pass |
| Images | 22 pass | 22 pass |
| Total JavaScript | 405 pass, 0 fail | 420 pass, 0 fail |
| Release-documentation tests | Not rerun as JS baseline | 7 pass, 0 fail |

The protected distribution cases cover canonical verification, Certifyd-first gating, malformed state failing closed, disconnected destinations, durable in-flight state, external identity, duplicate skip, recovered uncertainty, explicit reconciliation, updates to verified versions, secret redaction, concurrent submissions, manual exports, DEV, WordPress, Blogger, Publish Everywhere, version-gated approval and staging. A machine-readable before/after protected-test comparison accompanies this review.

Additional checks: production Beta27 release-documentation consistency; SEO validation for unchanged 112 published articles and two guides; JSON schemas/example; syntax checks; XML with 112 RSS items and 124 sitemap URLs; whitespace checks; source-scope and protected-file comparisons. Final details are in the accompanying evidence report.

The first baseline launch incorrectly supplied a global output-directory override, causing a fixture lookup failure. The launcher was corrected without modifying main tests or application code; the unchanged main baseline then passed all 405 tests. An intermediate integrated candidate passed 420 tests before the unrelated optional-panel collapse was removed. Final validation below uses the preserved main layout.

No tests depend on a hard-coded `/home/Darryl/Projects/contentbox/...` path. The inherited negative path assertion was made fixture-relative; no production Brain directory, outputs, database, token state or running checkout is used by tests.

## Exact persistent paths to retain before any cutover

The running process has no explicit CONTENT_AGENT_ROOT, CONTENT_AGENT_OUTPUT_DIR or CONTENT_DASHBOARD_DB_PATH; current effective paths derive from its checkout. The reconciled runtime must explicitly retain:

```dotenv
CONTENT_AGENT_ROOT=/home/Darryl/Projects/certifyd-me-site/content-agent
CONTENT_AGENT_OUTPUT_DIR=/home/Darryl/Projects/certifyd-me-site/content-agent/engine/outputs
CONTENT_DASHBOARD_DB_PATH=/home/Darryl/Projects/certifyd-me-site/content-agent/dashboard/content-dashboard.sqlite
```

| Persistent data | Existing location |
|---|---|
| Dashboard users/RBAC | `/home/Darryl/Projects/certifyd-me-site/content-agent/dashboard/content-dashboard.sqlite` and applicable `-wal`/`-shm` sidecars |
| Content Engine articles, versions, founder reviews, publication state, per-article destination identity/history/locks, new SEO records | `/home/Darryl/Projects/certifyd-me-site/content-agent/engine/outputs/` |
| Brain knowledge | `/home/Darryl/Projects/certifyd-me-site/content-agent/knowledge/` |
| Source/evidence referenced by existing Brain | `/home/Darryl/Projects/certifyd-me-site/content-agent/source-material/` |
| Blogger encrypted authorization | `/home/Darryl/Projects/certifyd-me-site/content-agent/dashboard/blogger-oauth.enc.json` |
| LinkedIn encrypted authorization | `/home/Darryl/Projects/certifyd-me-site/content-agent/dashboard/linkedin-oauth.enc.json` |
| Saved destination tests/defaults | `/home/Darryl/Projects/certifyd-me-site/content-agent/dashboard/distribution-connections.json`, `distribution-defaults.json` |
| Brain suggestion state, cover history, trends, trash | `/home/Darryl/Projects/certifyd-me-site/content-agent/dashboard/brain-suggestions.json`, `cover-image-history.json`, `trends/`, `trash/` |
| Audit log | `/home/Darryl/Projects/certifyd-me-site/content-agent/review/dashboard-audit.log.jsonl` |
| Image style guide | `/home/Darryl/Projects/certifyd-me-site/content-agent/image-generation/style-guide.md` |
| Existing environment/session/encryption configuration | Original private `.env.blog-engine.local` and `deploy/admin/local.env`; preserve values privately, never in Git |

OAuth pending challenges and short-lived tokens are process memory, not files that can be copied. Schedule a cutover with no authorization flow, generation or distribution operation in flight. Preserve the session secret: encrypted saved tokens rely on it.

Generated artwork is a separate site-root write path (`images/blog/`) in the existing architecture. A read-only reference audit found no referenced asset available only in production and absent from clean main. Eighteen historical references were absent in both locations; this is pre-existing, not an introduced regression, and no artwork was repaired or changed. Future cutover must retain an explicit writable/backup policy for generated assets and verify active draft references before switching. No storage redesign or asset migration is part of this branch.

## Proposed production cutover — requires later approval

1. Review this exact diff and final tests. No commit/push/merge is authorized yet. After any separately approved merge, prepare the runtime from that exact resulting commit without overwriting the dirty original checkout.
2. Keep original runtime data and code available for rollback. Privately reuse existing configuration; keep session/encryption secrets stable and pin the three persistent root paths above. Verify effective paths after both existing env files are loaded; startup file ordering can override shell values. Do not merely copy example `/srv` paths.
3. Confirm all persistent paths exist and match the original data; do not silently create a blank replacement database. Audit active draft asset paths and the generated-image write/backup location. No data move without separate approval.
4. Run isolated staging/smoke validation with temporary runtime data and mocked publishing, not a second writer on production SQLite. Check SEO, LinkedIn controls, static containment and unchanged protected distribution flows.
5. At an approved maintenance point, quiesce active work. Capture a consistent SQLite backup using its supported backup method plus secure backups of mutable state. Do not copy only the main file from a live WAL database. Record code, environment and process provenance.
6. Use the existing daemon/startup method: stop only the original dashboard daemon, then start the approved reconciled runtime on the existing origin port with explicit persistent paths. Do not restart tunnels, Core, Fan, Browser or unrelated services. Never run two dashboard writers against the production database.
7. Verify `/health`, `/ready`, `/version` and actual deployed Git provenance; version 1.0.0 alone does not prove source SHA. Run the requested single unpublished test draft smoke: automatic proposal, visible confidence/recommendations, no inserted links, Reject preservation, Reassess accepted-strategy preservation, stale hash, founder/publication state unchanged. Do not publish, send destination posts, refresh/replace accounts or alter live articles. Stop and report a smoke failure; no unreviewed fix.

## Rollback

Before a live switch, rollback means retaining/abandoning this isolated candidate only; production remains unchanged.

After a separately approved switch, stop only the new daemon with the existing stop method, verify port ownership and start the unchanged original checkout using its original startup/env and existing persistent paths. Keep the same session secret; leave tunnels and unrelated services running. Recheck health endpoints. Do not automatically restore old SQLite or destination JSON: it could erase post-switch state. No database migration is introduced here. Any data restore needs separate review, stopped writers and a consistent backup. Preserve failed candidate/logs for diagnosis.

## Production preservation

All original production status/index/branch/HEAD/unstaged/staged/untracked captures still match. All 138 captured working-tree files retain their SHA-256 values. Node PID 945206 and supervisor PID 945203 are unchanged; health/readiness/version remain HTTP 200. No production article or distribution state was modified by this work or its tests. Existing runtime is still the original process; the reconciled code is not live.

All 405 baseline JavaScript tests pass in the candidate. The explicitly inventoried existing dashboard distribution cohort is 36/36 before and 36/36 after. New coverage adds 15 passing cases (six dashboard regressions, one fixture-isolation case, three LinkedIn cases, five static-containment groups).

No commit, push, merge, production file edit, restart or deployment has been performed for this reconciliation. The new branch still points at the approved main SHA; changes are unstaged for review.

## Final diff summary

Exactly 14 changed/new source, test and documentation files. 974 insertions and 26 deletions versus the approved main, including this report and the three new code/test files. The unstaged tracked-only Git summary shows 10 files, 431 insertions and 26 deletions; four new files account for the remainder. No dependency-lock, published content, guide, topic, sitemap, feed, branding, asset or runtime-data delta.

Validation evidence is preserved privately outside the worktree in `/home/Darryl/Projects/dashboard-reconciliation-review-2026-11-11/implementation-review/`. The final full JavaScript log is `/tmp/certifyd-reconciliation-final-tests.log`; unchanged-main baseline is `/tmp/certifyd-reconciliation-baseline-tests-isolated.log`. `final-validation.json` lists all 36 protected distribution cases and production-preservation checks; `protected-behavior-checks.json` lists the byte-identical methods/files. The review ZIP contains the source diff and new source/test files; no runtime data or credentials.
