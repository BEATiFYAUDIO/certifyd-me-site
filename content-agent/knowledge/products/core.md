# Certifyd Core

## Source Scope

This file applies the founder-approved architectural definition of Certifyd Core and keeps implementation status separate from architecture.

Evidence base:

- Founder-approved product-architecture decision.
- `content-agent/knowledge/ecosystem.md`.
- `content-agent/knowledge/facts/approved-public-claims.md`.
- `content-agent/knowledge/investors/investment-thesis.md`.
- `content-agent/knowledge/investors/business-model.md`.
- `content-agent/knowledge/investors/transaction.md`.
- `content-agent/knowledge/investors/revenue-model.md`.
- `content-agent/knowledge/investors/investor-claims-review.md`.
- Root public-site knowledge files in `knowledge/`.

The 2026-11-05 technical enrichment also inspects the local Core implementation, existing offline tests and the version-labelled Beta 20 guide. Exact repository revisions, scope and unresolved differences are in `capabilities/consistency-review.md`. The founder-approved definition below is unchanged.

## Founder-Approved Architectural Definition

> Certifyd Core is the foundational engine that powers identity, publishing, provenance, creator profiles, release records, access, and direct commerce across the Certifyd ecosystem.

- **Architecture status:** Approved.
- **Capability deployment status:** Separate from the architectural definition.
- **Important distinction:** Approval of the Core architecture does not mean every listed capability is fully live or generally available.

## What Core Is Not

Certifyd Core is not merely software for running creator or operator nodes. Nodes are part of the broader infrastructure model, but they do not define the full role of Core.

## Role In The Ecosystem

Core is the central engine beneath Certifyd’s public and infrastructure surfaces.

Conceptually:

```text
Certifyd
   |
   v
Certifyd Core
   |
   +-- Creator Profiles
   +-- Certifyd Fan
   +-- Certifyd Awards
   +-- Certifyd Network
   +-- Partner and commerce surfaces
```

This is a conceptual product hierarchy, not a complete technical deployment diagram.

## Capability Status Matrix

Capability status remains conservative. A capability can be part of Core’s approved architecture while still being beta, planned, funding-dependent, transaction-dependent, or unclear in implementation.

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| identity | `BETA` | `capabilities/identity.md` | Browser-held Ed25519 creator keys, registered public keys and platform challenges; legal identity remains separate. |
| creator profiles | `LIVE` surface / `BETA` controls | `capabilities/profiles.md` | Existing public surface retained; private/public boundary and profile inclusion inspected. |
| publishing | `BETA` | `capabilities/publishing.md` | Canonical manifest/hash, publication receipt payload and mode/readiness gates inspected. |
| provenance | `UNCLEAR` | Founder-approved Core definition; `approved-public-claims.md` risk notes | Architecture includes provenance; definition and proof boundaries remain unresolved. |
| release records | `BETA` subset | `capabilities/release-records.md` | Manifest/file/split anchors inspected; no legal authority or permanence claim. |
| work records | `BETA` | `capabilities/catalog-management.md` | ContentItem, files, credits and external-reference schema inspected. |
| receipts | `BETA` subset | `capabilities/receipts.md` | Purchase receipt/access context differs from hash/proof bundles; signatures are not universal. |
| splits | `BETA` | `capabilities/splits.md` | Versioned participants, accepted active total, locking and allocation tests inspected. |
| access | `BETA` | `capabilities/access.md` | Core-authorized playback and tracked purchase entitlement paths inspected. |
| access control | `BETA` | `capabilities/access.md` | Canonical offers, receipt matching and fail-closed media selection; not copy prevention. |
| direct commerce | `BETA` | `capabilities/commerce.md` | Tracked paid-purchase fulfilment tested offline; live payment availability not asserted. |
| payments | `BETA` | `capabilities/payments.md` | LND readiness and credential roles inspected; real-funds flows not exercised. |
| payouts | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Do not claim guaranteed payout timing. |
| catalog management | `BETA` | `capabilities/catalog-management.md` | Work/file/credit/identifier structures inspected; not full rights administration. |
| analytics | `PLANNED` / `FUNDING-DEPENDENT` | `content-agent/knowledge/investors/transaction.md` | AI/data/reporting systems are part of funding plan. |
| royalty management | `UNCLEAR` | `knowledge/mission.md`; `approved-public-claims.md` | Risky until product/legal scope is defined. |
| network distribution | `BETA` subset | `capabilities/network-distribution.md` | Configured public origins, provider records and Fan aggregation; peer replication remains unverified. |
| partner integrations | `PLANNED` / `FUNDING-DEPENDENT` | `content-agent/knowledge/investors/transaction.md`; `business-model.md` | Services/integrations are in model/funding plan. |

## Core-Powered Surfaces

### Creator Profiles

Creator profiles are a public creator-facing surface powered by Certifyd Core. They are not currently a separate top-level product.

### Certifyd Fan

Certifyd Fan is the fan-facing application and experience for discovering, accessing, playing, collecting, and directly supporting creator work. Fan is powered by or connected to Certifyd Core.

### Certifyd Awards

Certifyd Awards is the recognition layer for creators, works, partners, and infrastructure activity. Awards is a public ecosystem surface that can use proof, records, fan activity, commerce, and Network participation supplied through the broader Certifyd system.

Current Awards capabilities must remain separate from planned voting, scoring, rewards, commerce, and Network integration.

### Certifyd Network

Certifyd Network is the distributed infrastructure layer through which creators, partners, and operators can run, extend, host, distribute, or connect Certifyd capabilities.

The exact operational relationship between Core and individual nodes still requires technical confirmation.

## Safe Current Wording

> Certifyd Core is the foundational engine that powers identity, publishing, provenance, creator profiles, release records, access, and direct commerce across the Certifyd ecosystem.

Add this qualification when capability availability matters:

> Individual Core capabilities may be live, in beta, planned, funding-dependent, transaction-dependent, or available only in particular implementations. Public content must not imply that every Core capability is generally available today.

## Unsafe Wording For Now

Avoid these until verified:

- Certifyd Core is generally available.
- Every Core capability is live today.
- Core is merely a node application.
- Core guarantees creator ownership.
- Core guarantees provenance, attribution, or legal proof.
- Core creates permanent or immutable records.
- Core provides complete rights, royalty, or catalog-management guarantees.
- Core makes Certifyd Network fully decentralized or company-independent.

## Open Questions

- Exact shipped-build mapping for every platform and participation-mode resolver.
- Production provider/funds behavior, automatic peer replication and independently verified availability.
- Legal authority of records, rights disputes, data migration and every browser recovery path.

## Scrape Update — 2026-07-28

### Contentbox / Fan Authority Split

The Fan PWA source clarifies an important Core-adjacent boundary: Fan owns discovery, playback UI, persistent player dock, continuous playback, and collection/support experience. Contentbox owns canonical playback contract, offer/playback authorization, public creator/profile pages, buy/support pages, and APIs.

- **Classification:** `BETA` / repository-supported architecture.
- **Source:** `BEATiFYAUDIO/certifyd-fan-pwa docs/certifyd-player-mvp.md`; `BEATiFYAUDIO/contentbox` repository.
- **Impact:** When writing about Core or Fan, do not imply the Fan PWA is the commerce, entitlement, receipt, payout, split, settlement, or creator-dashboard authority.

### Network Operator Requirements

The Network join page supports a concrete early operator model: provider URL, provider node ID, provider public key, optional provider profile ID, reachable public metadata, identity capability, content capability, proof capability, and commerce/settlement status.

- **Classification:** `BETA` / early network.
- **Source:** `https://network.certifyd.me/join`.
- **Impact:** Core-to-Network architecture remains implementation-specific, but public node-operator readiness language is now source-backed.

## Current Status

`BETA`

## Confidence

`HIGH`

For the inspected local runtime and tests, not general availability or production deployment parity.

## Purpose

Run the creator’s local publishing and commerce engine while exposing a deliberately separate public creator surface.

## Supported Current Claims

- Core’s local runtime defines SQLite-backed work and state storage.
- Core’s boundary separates private dashboard/API routes from an allowlisted public creator server; default source configuration uses ports 4000 and 4010 respectively.
- Core’s public-sharing lifecycle requires consent, coordinates listener/tunnel startup and rolls back failed startup; participation and payment readiness have separate checks.
- Core’s schema defines work, media, profile and split records; publication helpers compute canonical manifest hashes and receipt bindings.
- Core’s access and purchase helpers supply canonical playback, entitlement and accounting state; Fan’s client consumes matching public contracts.
- Fan discovers work from configured Core origins; origin discovery and public proof routes do not provide automatic peer-to-peer replication.

## Current Behavior

Core provides the private browser dashboard and local creator/runtime state, with an explicitly enabled public surface for supported profile, proof, discovery and work/buy routes. Content records, split versions and payment/access state remain Core-side authority.

## Technical Mechanism

The local package uses SQLite/Prisma for structured state, local file/media references and separate private/public Fastify surfaces. Public routes are allowlisted rather than exposing the administration API. The public lifecycle serializes start/stop and rolls back failed startup. Named/temporary transports do not themselves change product-tier or payment authority. Creator signing keys live in the dashboard browser’s origin storage; database ownership is not automatic possession of that browser key.

## Creator or Fan Workflow

The tested contracts connect local state, explicit sharing consent, canonical publication metadata and Core-authorized access. Fan consumes configured public origins and matching offers. Installer/first-owner onboarding, full dashboard publishing and live commerce were not exercised; their source-reviewed or historical observations remain in the audit.

## Architectural Significance

The creator operates the system holding the canonical work and commerce state. Public profiles and Fan are clients/surfaces of that engine. Local-first operation does not mean offline public availability, automatic replication or elimination of DNS, tunnel, provider and storage dependencies.

## Limitations

This is beta source/test verification, not proof of every installed binary. Key custody depends on browser/origin storage and recovery paths. Supported mode, route and commerce checks must succeed. Payout guarantees, legal rights, production availability and peer-to-peer replication remain outside these claims.

## Historical Beta 20 Comparison

The guide is labelled v0.1.0-beta.20. Its local dashboard address, explicit sharing, publishing/profile separation, support-address versus paid-commerce distinction and collaborative split acceptance/locking are corroborated by the inspected implementation. Its old download label, image limit, universal preview duration and exact capability availability must not be generalized to newer releases. The Beta 27 release worktree and current Core checkout differ in mode resolution and parts of server.ts; the mode-specific restriction for a particular shipped binary is unresolved.

## Current Evidence

- `/home/Darryl/Projects/contentbox/README.md`
- `/home/Darryl/Projects/contentbox/apps/api/src/publicServer.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/security/publicRoutePolicy.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/publicLifecycle.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/publicLifecycle.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.ts`
- `/home/Darryl/Projects/contentbox/apps/api/prisma/schema.prisma`
- `/home/Darryl/Projects/contentbox/apps/api/scripts/prepare-local-database.mjs`
- `https://certifyd.me/core/guide/#install`
- `content-agent/knowledge/capabilities/consistency-review.md`
- `/home/Darryl/Projects/contentbox/apps/api/src/security/publicRoutePolicy.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/security/privateHostGuard.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/publicServer.test.ts`

## Verification Status

Tested source behavior: public boundary/lifecycle, canonical publication, identity/AR, access and purchase fixtures passed on 2026-11-05. SQLite/schema/default-port claims are verified source definitions, not an installer test. Confirmed released functionality: none newly established. Existing Core architecture remains approved separately. No application, installer, live service or production database was changed or exercised.

## Review State

APPROVED technical enrichment is limited to the successfully verified source structures and passing test contracts in Supported Current Claims. The founder-approved architecture remains unchanged. No new shipped-build or production claim is approved.

## Qualified Claims

- New mechanism descriptions concern the inspected beta source and passing isolated tests; they do not confirm a released binary, installer, mobile build or production deployment.
- The pre-existing Core architecture is preserved and does not establish that every capability is currently released.

## Verified Mechanism

Passing isolated tests cover consent/startup/rollback, representative private/public route boundaries, manifest hashing, canonical access and paid-intent fulfilment. Source inspection separately confirms schema/default configuration. No installer or complete creator workflow was tested.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Installer/owner setup, full publishing UI, deployed mode mapping, live provider operation and complete buyer checkout remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
