# Fan


## Definition

Fan is both a product surface and a grouping of capabilities around discovery, playback, access, library, collection, support, and commerce. These sub-capabilities must be evaluated separately.

## Purpose

Provide discovery, receipt verification and authorized playback across creator-operated Core origins, while Core retains control of catalog records, playback permissions, offers, payments and entitlements.

## Current Status

`LIVE`

| Component | Status | Notes |
|---|---|---|
| public discovery surface | `LIVE` | Existing public surface claim retained. |
| origin aggregation, player and offer/access client | `BETA` | Current checkout and offline regressions inspected. |
| collection/receipt restoration | `BETA` / partial | Client behavior only; full cross-device recovery unverified. |
| commerce authority | Core-side | Fan consumes authorized offers and links to Core. |

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Fan fetches public discoverable content from configured creator Core origins and merges the results for browsing.
- Fan’s shared player consumes Core’s canonical full/preview/none playback contract instead of selecting a guessed full-media URL.
- Paid access requires matching receipt evidence or a trusted Core-confirmed offer; arbitrary client-supplied ownership flags are not sufficient.
- Fan routes unlock/support actions to the creator’s existing public commerce surface; Core remains the authority for payment and entitlement state.
- Fan can verify the signed AR context and live Core authorization used for supported AR eligibility, while its discovery interface remains distinct from the extension’s page augmentation.
- Certifyd Fan is linked from the public website as a discovery surface.
- Fan is the fan-facing application and experience in the approved hierarchy.

## Technical Mechanism

config merges origins.json and environment origins. Progressive discovery reconciles per-origin results; unavailable origins do not become fake content. offerFetch binds a trusted full-playback response to the expected creator origin/content endpoint; accessResolver uses the canonical offer plus matching receipt context. AR eligibility in Fan separately verifies signed AR action data rather than trusting a registry listing.

## Creator or Fan Workflow

The tested client flow discovers configured Core origins, resolves matching work and receipt context, and consumes the canonical full/preview/none offer. Core remains responsible for authorization. This contract-level verification does not establish a complete browser/player navigation session.

## Current Behavior

Passing regression fixtures verify configured-origin discovery, reconciliation, access/receipt context and AR eligibility. These are beta client contracts; the pre-existing public discovery status does not certify the complete player UI.

## Architectural Role

Fan is a client of creator-operated infrastructure, not the owner of purchase rights. The same creator can expose work through supported public surfaces while Core keeps the underlying authorization state.

## Why It Exists

Fan exists so supporters can discover, access, play, collect, and support creator work through a user-facing experience connected to the Certifyd ecosystem.

## Product Surfaces

- Fan
- Core
- Creator profiles
- Network

## Intended Users

- fans
- creators
- investors
- administrators

## Current Evidence

- knowledge/brand.md
- knowledge/vocabulary.md
- knowledge/vision.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/ecosystem.md
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/config.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/api.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/progressiveDiscovery.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/progressiveDiscovery.regression.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/offerFetch.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/accessResolver.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/fanEntitlement.regression.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/arEligibility.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/arEligibility.regression.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/docs/certifyd-player-mvp.md`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- LIVE refers to the pre-existing public discovery surface; playback, receipt handling and AR eligibility are tested beta implementation subsets. Offline playback, every device/browser, universal origin support and live commerce were not validated. A saved client library is not a legal ownership register.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Every Fan feature is live.
- Fan guarantees discovery or sales.
- Fan proves all Core capabilities are generally available.

## Technical Verification Required

- README/current-player reconciliation, full production/browser coverage, offline access and cross-device receipt recovery need separate validation.

## Legal or Policy Verification Required

- privacy
- consumer protection
- payment terms
- content access rights
- data rights

## Commercial Status

monetization enabled

## Dependencies

- Core
- profiles
- discovery data
- access/commerce/payment systems

## Open Questions

- README/current-player reconciliation, full production/browser coverage, offline access and cross-device receipt recovery need separate validation.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

LIVE refers to the pre-existing public discovery surface; playback, receipt handling and AR eligibility are tested beta implementation subsets. Offline playback, every device/browser, universal origin support and live commerce were not validated. A saved client library is not a legal ownership register.

## Historical Beta 20 Comparison

The older README says Fan is discovery/routing only, while newer implementation and the player document provide playback/access clients. The narrower authority boundary is retained: Fan does not become commerce authority. Production preview durations follow the canonical offer, not a universal 20-second promise.

## Verification Status

Verified on 2026-11-05. Six existing Fan regression files: accessResolver, fanEntitlement, progressiveDiscovery, arEligibility, api.discovery and receiptHandoff.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing mocked regression files demonstrate configured-origin discovery/reconciliation, matching receipt/access context, Core-bound offer trust and AR eligibility checks. They do not test a complete player/navigation session or actual payment.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. The pre-existing LIVE designation remains limited to the previously evidenced public discovery/profile surface; it does not extend to every mechanism described here.

## Unresolved Issues

Full player/navigation behavior, live commerce, every browser/device and cross-device receipt recovery remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
