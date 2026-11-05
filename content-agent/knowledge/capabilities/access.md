# Access


## Definition

Access is the capability for determining whether a person or system can view, preview, play, unlock, download, or otherwise use content or records. Public access, paid access, entitlement, preview access, authenticated access, authorization, and ownership are separate concepts.

## Purpose

Explain paid-access permissions and receipt verification: give fans a supported preview or Core-authorized full playback without allowing a discovery client to invent purchase rights.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core supplies a canonical playback contract selecting full, preview or no playback; Fan uses the authorized stream rather than guessing a full-media URL.
- Missing or ambiguous price data is not sufficient to classify content as free; the access helpers require an explicit free-price signal.
- Core’s tracked paid-purchase fulfilment binds an entitlement to the payment intent and buyer after settlement is recorded.
- Fan checks receipt/content context and trusted Core offer responses before presenting paid full access; arbitrary client-side access flags are insufficient.
- Purchase fulfilment and payout processing are separate steps: a creator payout failure is not itself evidence that a buyer should lose a completed, valid entitlement.
- Certifyd source material describes access and premium release concepts.

## Technical Mechanism

publicPlayback maps free/locked/owned conditions to full/preview/none; contentAccess does not treat missing price as free. A paid purchase checkpoint and finalizer bind fulfilment to the intent and buyer. Fan’s offerFetch/accessResolver require Core-confirmed full playback or matching receipt evidence, not arbitrary browser flags or a guessed full-media URL.

## Creator or Fan Workflow

The tested access contract resolves a work to full, preview or no playback using Core state and matching receipt context. Purchase fixtures grant the supported entitlement after a recorded paid intent. A complete payment-to-browser playback session was not exercised.

## Current Behavior

Core computes a canonical playback contract with mode, streamUrl, previewLimitSeconds, canPlayFull and reason. Purchase fulfilment can grant an entitlement after the tracked payment is paid. Fan consumes Core’s authorization result.

## Architectural Role

Core remains access authority while Fan is a replaceable viewer. A discovery app or cached card does not become the owner of the entitlement rules.

## Why It Exists

Access exists so creators can make some work public, restrict other work, offer previews, and connect commerce or supporter status to availability.

## Product Surfaces

- Core
- Fan
- Creator profiles
- Partner infrastructure

## Intended Users

- creators
- fans
- administrators
- partners

## Current Evidence

- knowledge/faq.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/investors/revenue-model.md
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/publicPlayback.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/publicPlayback.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentAccess.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentAccess.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.test.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/offerFetch.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/accessResolver.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/accessResolver.regression.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/fanEntitlement.regression.ts`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Neither playback authorization nor a receipt grants copyright ownership or prevents copying after authorized playback. Offline/cross-device restoration, entitlement duration and every browser-storage loss case were not established by this audit.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Payment equals ownership.
- Preview access is secure without server-side enforcement.
- Entitlements are permanent or guaranteed.
- All protected media cannot be copied.

## Technical Verification Required

- All expiry/refund/revocation policy paths, offline use and device migration require separate end-to-end coverage.

## Legal or Policy Verification Required

- consumer protection
- refunds
- terms of access
- privacy
- copyright and licensed usage

## Commercial Status

monetization enabled

## Dependencies

- commerce
- payments
- entitlements
- media delivery
- profile/Fan surfaces

## Open Questions

- All expiry/refund/revocation policy paths, offline use and device migration require separate end-to-end coverage.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Scrape Update — 2026-07-28

The Fan player docs state that Contentbox owns the canonical playback contract and offer/playback authorization. Fan fetches canonical offers and plays only authorized `offer.playback` streams. Fan must not infer entitlement, ownership, price, or unlock eligibility.

- **Classification:** `BETA` / repository-described behavior.
- **Source:** `BEATiFYAUDIO/certifyd-fan-pwa docs/certifyd-player-mvp.md`.

### Supported Current Claims

- Fan can display public-safe access labels such as locked, unlocked, owned, preview, or full playback where provided by the authoritative offer/playback contract.
- Contentbox/Core-side systems remain the authority for access and entitlement decisions.

### Additional Prohibited Claims

- Fan independently decides entitlement.
- Fan independently decides ownership, price, unlock eligibility, or full-media authorization.

## Limitations

Neither playback authorization nor a receipt grants copyright ownership or prevents copying after authorized playback. Offline/cross-device restoration, entitlement duration and every browser-storage loss case were not established by this audit.

## Historical Beta 20 Comparison

The guide’s distinction between access, authored work and other Library relationships remains useful. The old player document’s preview duration is a documented contract example, not a universal hard-coded limit for every offer.

## Verification Status

Verified on 2026-11-05. Core publicPlayback/contentAccess and isolated purchase suites; Fan accessResolver/fanEntitlement/receiptHandoff regressions.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing Core helpers demonstrate full/preview/none selection and rejection of missing-price free-access assumptions. Purchase and Fan regressions test entitlement/receipt context with isolated or mocked state. They do not demonstrate payment through real playback end to end.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Production payment-to-playback flow, cross-device recovery and every supported browser/device remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
