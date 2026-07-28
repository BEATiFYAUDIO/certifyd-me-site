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
| identity | `UNCLEAR` | Founder-approved Core definition; existing profile/source-of-truth language in `knowledge/vocabulary.md` | Architecture approved; current implementation scope needs confirmation. |
| creator profiles | `LIVE` as public surface / `UNCLEAR` as full Core capability | `knowledge/brand.md`; `knowledge/vision.md`; founder decision | Creator profiles are approved as Core-powered public surfaces; rollout and feature scope need confirmation. |
| publishing | `BETA` / `UNCLEAR` | `knowledge/mission.md`; `knowledge/faq.md`; founder-approved Core definition | Public copy supports publishing; Core implementation status needs confirmation. |
| provenance | `UNCLEAR` | Founder-approved Core definition; `approved-public-claims.md` risk notes | Architecture includes provenance; definition and proof boundaries remain unresolved. |
| release records | `UNCLEAR` | Founder-approved Core definition; `knowledge/faq.md` record language | Needs product/technical confirmation. |
| work records | `UNCLEAR` | `knowledge/faq.md`; `approved-public-claims.md` | Needs record lifecycle and correction/dispute model. |
| receipts | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Receipts are defined with limits; live/Core scope unclear. |
| splits | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Concept described; implementation status unclear. |
| access | `BETA` / `UNCLEAR` | Founder-approved Core definition; `knowledge/faq.md` unlock/access language | Access is architectural; current deployment needs confirmation. |
| access control | `BETA` / `UNCLEAR` | Product/investor knowledge around unlocks and commerce | Needs current implementation confirmation. |
| direct commerce | `BETA` / `UNCLEAR` | `knowledge/mission.md`; `knowledge/faq.md`; `content-agent/knowledge/investors/business-model.md` | Direct commerce model supported; exact live scope unresolved. |
| payments | `BETA` / `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Bitcoin Lightning can be supported where available; Core scope unclear. |
| payouts | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Do not claim guaranteed payout timing. |
| catalog management | `UNCLEAR` | `knowledge/mission.md`; `approved-public-claims.md` | Catalog-performance/management claims need documentation. |
| analytics | `PLANNED` / `FUNDING-DEPENDENT` | `content-agent/knowledge/investors/transaction.md` | AI/data/reporting systems are part of funding plan. |
| royalty management | `UNCLEAR` | `knowledge/mission.md`; `approved-public-claims.md` | Risky until product/legal scope is defined. |
| network distribution | `BETA` / `UNCLEAR` | `content-agent/knowledge/ecosystem.md`; `knowledge/vocabulary.md` | Network is the distributed infrastructure layer; exact Core relationship needs confirmation. |
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

- Which Core capabilities are live today versus beta or planned?
- What is the exact Core-to-Network runtime architecture?
- Which implementations currently expose identity, access, commerce, receipts, and release records?
- What is the legal and technical boundary of provenance in Core?

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
