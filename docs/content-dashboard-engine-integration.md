# Content Dashboard Engine Integration

## Boundary

The dashboard uses a typed service boundary instead of exposing the Content Engine directly.

Primary modules:

- `ContentRunRepository`
- `ContentBrainRepository`
- `ContentDashboardActions`
- `AuditLogRepository`

These live under `scripts/content-dashboard/`.

## Local Storage Adapter

For Phase 3, the dashboard reads local Content Engine artifacts from:

```text
CONTENT_AGENT_ROOT/engine/outputs
```

Default development path:

```text
/home/Darryl/Projects/contentbox/content-agent/engine/outputs
```

This is development/internal-only and can later be replaced by a database-backed repository.

## Allowed Operations

The dashboard exposes explicit operations only:

- list runs
- read run summary
- read run details
- generate deterministic draft from the known fixture
- start review
- approve exact version
- reject
- request revision
- prepare Blog package
- validate Blog package
- read SEO package
- read claim ledger
- read distribution package
- read lifecycle
- read manifest

No arbitrary command runner exists.

## Publishing Boundary

The dashboard can prepare and validate a Blog package. It cannot publish live.

The highest allowed status remains:

```text
READY_TO_PUBLISH
```

No dashboard action can mark content as `PUBLISHED`.

## Founder Review

Founder approval requires:

- authenticated founder role
- `content.article.approve` permission
- exact current article version
- explicit confirmation
- zero blocking/unresolved/prohibited claims
- audit record

The model or deterministic engine cannot approve content.

## Revision Workflow

A revision request calls the existing Content Engine revision flow. Prior versions are preserved and a new version is created.

The dashboard does not silently mutate approved content.

## Audit Log

Dashboard action audit records are appended to:

```text
CONTENT_AGENT_ROOT/review/dashboard-audit.log.jsonl
```

Records include action, actor, role, run ID, version, timestamp, result, note and request ID.

Secrets, tokens and passwords are not logged.
