# Access

## Definition

Access is the capability for determining whether a person or system can view, preview, play, unlock, download, or otherwise use content or records. Public access, paid access, entitlement, preview access, authenticated access, authorization, and ownership are separate concepts.

## Why It Exists

Access exists so creators can make some work public, restrict other work, offer previews, and connect commerce or supporter status to availability.

## Architectural Role

Access is included in the approved Core definition. Public and product knowledge suggests unlock/access concepts, but current implementation scope needs verification.

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

## Current Status

`BETA`

No component-status table required.

## Confidence

`MEDIUM`

Access and unlock language appears in public/product knowledge, but exact entitlement and authorization behaviour is not verified from knowledge files alone.

## Current Evidence

- knowledge/faq.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/investors/revenue-model.md

## Supported Current Claims

- Certifyd source material describes access and premium release concepts.

## Qualified Claims

- Certifyd Core is designed to support access.
- Paid, preview, authenticated, or entitled access may be supported where implemented.

## Prohibited Claims

- Payment equals ownership.
- Preview access is secure without server-side enforcement.
- Entitlements are permanent or guaranteed.
- All protected media cannot be copied.

## Technical Verification Required

- authorization routes
- entitlement model
- preview/full media flow
- session binding
- permissions
- storage and token model

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

- Which access modes are live?
- How long do entitlements last?
- How is preview access enforced?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.
