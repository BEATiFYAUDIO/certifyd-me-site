# Payments


## Definition

Payments are the capability for initiating, routing, processing, or settling value. Payment initiation, payment routing, processor integration, custody, settlement, Lightning, fiat, cryptocurrency, and internal balances are separate concepts.

## Purpose

Connect Lightning purchases to verified payment state and explain LND credential permissions, without confusing a receiving address with a ready commerce node. Payment verification, buyer access and payout are separate operations.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core includes Lightning/LND readiness checks that distinguish a configured endpoint from a synchronized, channel-capable receive-ready node.
- Core separates LND invoice, read, send and operator credential roles instead of treating one credential as universal commerce authority.
- A Lightning Address is a receiving destination; saving it alone does not establish provider trust, local-node readiness or priced-work publication readiness.
- Core’s paid-purchase fulfilment path requires a recorded paid content-purchase intent and validates deterministic settlement allocations before completing supported fulfilment.
- Lightning invoices, buyer access, participant accounting and actual participant payout are different stages; payment availability, liquidity and payout timing are not guaranteed.
- Certifyd source material describes Bitcoin Lightning payments where supported.

## Technical Mechanism

LND credentials are separated into invoice, read, send and operator roles. Readiness distinguishes reachability, synchronization, channel availability and receive readiness. Paid-purchase tracking requires a paid CONTENT_PURCHASE intent before the fulfilment checkpoint is written. Deterministic finalization validates that settlement allocations sum to the expected total.

## Creator or Fan Workflow

The tested readiness helpers classify node/credential state. Isolated purchase fixtures start with recorded payment state and check fulfilment and allocation results; they do not send an invoice or move funds.

## Current Behavior

Core contains Lightning/LND configuration and readiness logic, provider-backed payment intent paths and paid-purchase fulfilment. A Lightning Address is a separate receiving destination; it does not configure every prerequisite for priced commerce.

## Architectural Role

Creators can choose supported operator/payment services while Core retains explicit payment and access records. Operator liquidity, credentials and availability remain real dependencies.

## Why It Exists

Payments exist so commerce, access, support, receipts, splits, and payouts can be connected to actual economic activity.

## Product Surfaces

- Core
- Fan
- Creator profiles
- Partner infrastructure

## Intended Users

- creators
- fans
- partners
- administrators
- investors

## Current Evidence

- knowledge/mission.md
- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/investors/revenue-model.md
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/lightning.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/lightning.onboarding.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/finalizePurchase.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/server.ts: provider intent/handshake and payout-destination handlers`
- `https://certifyd.me/core/guide/#wallet`
- `https://certifyd.me/core/guide/#provider`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- No live invoice was created or paid during this audit. Real payment/provider interoperability, custody/legal characterization, channel liquidity and success across every wallet are not proven by offline tests. No fiat rail or guaranteed settlement claim is added.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Payments are universally available.
- Settlement is always instant.
- Certifyd is non-custodial.
- Fiat and crypto rails are all live.
- Internal balances are equivalent to legal balances.

## Technical Verification Required

- Real-funds integration, provider-specific failure/refund behavior, custody responsibilities and universal wallet compatibility need separate verification.

## Legal or Policy Verification Required

- financial regulation
- money transmission
- tax
- consumer protection
- custody
- AML/KYC if applicable

## Commercial Status

monetization enabled

## Dependencies

- commerce flow
- payment providers
- legal/compliance review
- entitlement and receipt systems

## Open Questions

- Real-funds integration, provider-specific failure/refund behavior, custody responsibilities and universal wallet compatibility need separate verification.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

No live invoice was created or paid during this audit. Real payment/provider interoperability, custody/legal characterization, channel liquidity and success across every wallet are not proven by offline tests. No fiat rail or guaranteed settlement claim is added.

## Historical Beta 20 Comparison

The Beta 20 guide’s “Lightning Address alone does not enable priced works” distinction remains supported. Its named setup paths are not a guarantee that every current installation satisfies commerce readiness.

## Verification Status

Verified on 2026-11-05. Lightning onboarding/readiness/credential-role tests and isolated SQLite purchase fixtures; no real invoice or payment.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing readiness tests distinguish channel/receive state and credential roles. Isolated purchase fixtures demonstrate fulfilment/allocation handling after a recorded paid intent. No invoice was paid and no funds moved.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Live provider/LND operations, liquidity, custody, refunds, payout delivery and full checkout remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
