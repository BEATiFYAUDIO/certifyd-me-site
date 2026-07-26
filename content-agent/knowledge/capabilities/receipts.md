# Receipts

## Definition

Receipts are records related to purchase, payment, access, or content interaction. The source material uses receipt language ambiguously across commerce receipts, proof records, payment records, and public work records.

## Why It Exists

Receipts exist to provide clearer transaction and access context for creators and buyers.

## Architectural Role

Receipts are referenced in public knowledge and investor language, but their Core implementation and legal status are unclear.

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

## Current Status

`UNCLEAR`

| Component | Status | Notes |
|---|---|---|
| commerce receipt | `UNCLEAR` | Meaning supported, implementation not verified. |
| proof/public record | `UNCLEAR` | Potential usage, not defined. |
| payment record | `UNCLEAR` | Payment records require processor evidence. |

## Confidence

`MEDIUM`

Receipt terminology appears repeatedly, but the exact meaning and implementation are not defined.

## Current Evidence

- knowledge/vocabulary.md
- knowledge/faq.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/products/core.md

## Supported Current Claims

- A receipt can describe a record of purchase, payment, or content access when implemented.

## Qualified Claims

- Certifyd may use receipts to provide transaction or access context.
- Receipts can support clearer buyer/creator context subject to implementation.

## Prohibited Claims

- Receipts are permanent or immutable.
- Receipts prove legal ownership.
- Every access event creates a public receipt.
- Receipts guarantee payout or entitlement forever.

## Technical Verification Required

- receipt schema
- payment integration
- access grant model
- privacy model
- record visibility rules
- retention policy

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

- Are receipts private, public, or both?
- Do receipts represent payment, access, proof, or all of these?
- What retention and correction policies apply?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.
