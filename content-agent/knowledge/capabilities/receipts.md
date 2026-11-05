# Receipts


## Definition

Receipts are records related to purchase, payment, access, or content interaction. The source material uses receipt language ambiguously across commerce receipts, proof records, payment records, and public work records.

## Purpose

Preserve checkable purchase/access and publication context without collapsing payment, proof and legal ownership into one concept.

## Current Status

`BETA`

| Component | Status | Scope |
|---|---|---|
| purchase/access receipt | `BETA` | Tracked paid-intent and receipt-context implementation. |
| publication/split proof bundle | `BETA` | Hash-bound v1 structures; signatures optional. |
| external processor settlement | unverified live | No real payment or payout exercised. |

## Confidence

`HIGH`

For the inspected structures and offline fulfilment tests only.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core’s tracked purchase flow associates a receipt ID/token and payment intent with buyer fulfilment and access context.
- Core’s publication receipt payload binds a content ID and manifest hash to publication time and node identifiers.
- Portable v1 proof bundles can combine publication and split anchors with optional settlement data; signatures are optional in that format.
- Fan can carry receipt context back to the authoritative Core origin to resolve supported access; the receipt alone does not grant copyright ownership.
- A receipt can describe a record of purchase, payment, or content access when implemented.

## Technical Mechanism

The purchase checkpoint is stable per payment intent; receipt IDs/tokens are distinct from the canonical manifest/split hashes used by proof bundles. Matching origin/content and Core authorization are required for supported paid access. Optional v1 proof-bundle signatures do not change the mandatory signature rules of AR records.

## Creator or Fan Workflow

The tested fixtures associate recorded purchase/receipt context with the matching work’s supported access result. The separate proof-bundle verifier checks publication and split anchors. No new live purchase or export workflow is claimed.

## Current Behavior

Purchase finalization records receipt context and supported entitlements. Publication builds a separate manifest-bound receipt payload. Fan uses Core-checked offer and receipt state for the matching work.

## Architectural Role

Core records purchase/access and publication/proof context. These are distinct receipt families, with different visibility and signature rules; none is automatically a legal ownership certificate.

## Why It Exists

Receipts exist to provide clearer transaction and access context for creators and buyers.

## Product Surfaces

- Core
- Fan
- Creator profiles
- Partner infrastructure

## Intended Users

- creators
- fans
- businesses
- administrators
- investors

## Current Evidence

- knowledge/vocabulary.md
- knowledge/faq.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/products/core.md
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/finalizePurchase.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/proofs/proofBundle.ts`
- `/home/Darryl/Projects/contentbox/docs/proofs.md`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/receiptStatus.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/receiptHandoff.regression.ts`
- `content-agent/knowledge/capabilities/consistency-review.md`

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- These receipt families have different public/private and signature boundaries. No audit claim establishes universal retention, irrevocable access, payout completion or legal ownership.
- The July receipt-implementation classification below is historical; the concrete November subset above supersedes that lack of implementation evidence.

## Prohibited Claims

- Receipts are permanent or immutable.
- Receipts prove legal ownership.
- Every access event creates a public receipt.
- Receipts guarantee payout or entitlement forever.

## Technical Verification Required

- Production processor settlement, retention/visibility policies and all restore/refund/revocation edge cases.

## Legal or Policy Verification Required

- consumer protection
- privacy
- financial records
- tax/accounting
- chargebacks/refunds
- record retention

## Commercial Status

monetization enabled

## Dependencies

- commerce implementation
- payment processor/Lightning integration
- access-control model
- privacy policy

## Open Questions

- Production retention, expiry, consumer-rights and cross-device receipt recovery policy.
- Which receipt/export features are available in each shipped mode/build?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Scrape Update — 2026-07-28

The Fan PWA docs explicitly place receipts outside Fan authority. Fan discovery ranking must not decide receipt validity, and Fan does not use receipt/access write routes.

- **Classification:** `UNCLEAR` for receipt implementation; `LIVE` for Fan boundary.
- **Source:** `BEATiFYAUDIO/certifyd-fan-pwa README.md`; `docs/DISCOVERY_RANKING.md`.

### Additional Qualified Claims

- Receipts may be used by Contentbox/Core-side systems where implemented.
- Fan may display public-safe labels or route users, but receipt validity remains outside Fan.

## Limitations

Receipt possession is not legal IP ownership. Live processor state, legal retention requirements, every refund/revocation policy and all cross-device restore behavior remain unresolved.

## Historical Beta 20 Comparison

The guide’s Library/access distinctions remain useful. Its short walkthrough does not establish permanent receipt retention or universal access recovery. Earlier July implementation uncertainty is narrowed only for the source/test-backed structures here.

## Verification Status

Verified on 2026-11-05. Purchase/receipt fixture tests, Fan receipt/access regressions and existing proof-bundle verifier script.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Verified Mechanism

Passing purchase/Fan fixtures check receipt context and the matching work’s access result. The existing proof-bundle script verifies fixture publication/split anchors and arithmetic. No live receipt was created.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Live receipt delivery/export, retention and cross-device access restoration remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
