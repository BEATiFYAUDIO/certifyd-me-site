# Commerce


## Definition

Commerce is the capability for creators, partners, or Certifyd surfaces to support paid or value-bearing activity. Direct sale, creator storefront, access purchase, supporter payment, marketplace, checkout, payment settlement, and creator-customer relationship are separate concepts.

## Purpose

Let a creator publish a priced or free work and retain a distinct record of sale, fulfilment, access and participant accounting.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core keeps public work/buy/offer surfaces distinct from private creator administration and payment configuration.
- Tracked settled purchases use an idempotent fulfilment checkpoint so repeated recovery does not create duplicate sales or settlement records.
- Buyer entitlements, participant settlement allocations and actual payouts are separate records and operations.
- A missing or invalid required split can leave paid-purchase fulfilment pending with an explicit failure record instead of silently granting unsupported access.
- Fan routes a buyer to the creator’s commerce surface and consumes Core’s resulting offer/access state; Fan does not independently authorize a purchase.
- Certifyd public knowledge supports direct commerce as a model and says fans can purchase content directly.

## Technical Mechanism

purchaseFulfillment uses a stable per-intent checkpoint; repeated recovery does not duplicate the sale or recreate a deliberately removed entitlement after completion. finalizePurchase requires a valid split authority and checks allocation integrity. Provider trust, route readiness and local payment capability are separate gates.

## Creator or Fan Workflow

The tested purchase flow starts from a recorded paid intent, finalizes supported settlement/access state and can retry interrupted fulfilment idempotently. It does not constitute a live buyer checkout demonstration.

## Current Behavior

Core exposes public creator/buy/offer surfaces while keeping creator administration private. Settled tracked purchases can create a sale, settlement allocations and buyer entitlement through a recoverable fulfilment checkpoint.

## Architectural Role

The creator’s Core holds the business and access state instead of a fan-facing discovery client deciding what was bought. Provider infrastructure can still be involved in invoicing, hosting or payouts.

## Why It Exists

Commerce exists so creator work, access, support, and related services can generate economic activity closer to the creator and connected to official context.

## Product Surfaces

- Core
- Fan
- Creator profiles
- Partner infrastructure
- Network

## Intended Users

- creators
- fans
- partners
- businesses
- administrators
- investors

## Current Evidence

- knowledge/mission.md
- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/investors/business-model.md
- content-agent/knowledge/investors/revenue-model.md
- content-agent/knowledge/products/core.md
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/finalizePurchase.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/security/publicRoutePolicy.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/destinations.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/docs/certifyd-player-mvp.md`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Offline fixtures verify accounting and access behavior, not live revenue, payment success or regulatory status. Basic/advanced/LAN and provider readiness remain distinct; there is no new blanket commerce availability claim.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- All commerce models are live.
- Creators own all customer data.
- Certifyd guarantees creator earnings.
- Marketplace-scale distribution is live.

## Technical Verification Required

- Live provider transactions, every product-tier UI path, tax/refund and consumer-policy behavior require separate validation.

## Legal or Policy Verification Required

- consumer protection
- tax
- refunds
- privacy
- financial regulation
- payment custody
- terms of sale

## Commercial Status

monetization enabled

## Dependencies

- access
- payments
- receipts
- creator profile/storefront implementation
- legal/compliance review

## Open Questions

- Live provider transactions, every product-tier UI path, tax/refund and consumer-policy behavior require separate validation.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Scrape Update — 2026-07-28

The Network join page states that a node operator provides commerce services to creators and that the network starts with commerce because creators need control over how they get paid. The page lists commerce service, settlement service, network availability, provider public key, canonical provider URL, and reachable public route as operator-provided concepts.

- **Classification:** `BETA` / early network.
- **Source:** `https://network.certifyd.me/join`.
- **Limit:** The page supports commerce-service positioning, not mature payment volume, guaranteed earnings, or universal availability.

Fan is not the commerce authority. The Fan PWA routes fans to creator buy pages and reads public content but does not use payment POST routes, buyer claim routes, receipt/access write routes, provider/payout/split routes, or creator dashboard routes.

- **Classification:** `LIVE` for Fan scope boundary.
- **Source:** `BEATiFYAUDIO/certifyd-fan-pwa README.md`.

## Limitations

Offline fixtures verify accounting and access behavior, not live revenue, payment success or regulatory status. Basic/advanced/LAN and provider readiness remain distinct; there is no new blanket commerce availability claim.

## Historical Beta 20 Comparison

The guide’s separation of support tips and priced-work setup remains valid. The walkthrough is not a complete mode-policy specification; current capability and publish gates decide eligibility.

## Verification Status

Verified on 2026-11-05. Core publicRoutePolicy/privateHostGuard/publicServer tests plus isolated purchase fulfilment/finalization suites.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing isolated SQLite fixtures demonstrate paid-intent prerequisites, recoverable/idempotent fulfilment, allocation validation and supported access records. Boundary tests cover representative public/private routes. This is not live checkout verification.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Real invoice/payment/provider behavior, buyer browser flow and actual participant payout were not tested. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
