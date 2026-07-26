# Splits

## Definition

Splits describe how revenue or credit may be allocated among contributors or participants. Declared contribution splits, royalty splits, payment splits, revenue-sharing instructions, and legal ownership percentages are separate concepts.

## Why It Exists

Splits exist so collaboration and revenue participation can be represented more clearly in creator commerce and attribution contexts.

## Architectural Role

Splits are referenced in public knowledge and may relate to Core commerce and record capabilities, but automated enforcement and legal meaning are not verified.

## Product Surfaces

- Core
- Creator profiles
- Fan
- Partner infrastructure

## Intended Users

- creators
- collaborators
- partners
- administrators
- investors

## Current Status

`UNCLEAR`

No component-status table required.

## Confidence

`MEDIUM`

Splits are described conceptually, but implementation, payment linkage, and legal authority are unresolved.

## Current Evidence

- knowledge/vocabulary.md
- knowledge/faq.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/products/core.md

## Supported Current Claims

- A split can describe how revenue from a sale may be allocated among contributors or participants.

## Qualified Claims

- Certifyd can support split context or revenue-sharing instructions where implemented.

## Prohibited Claims

- Certifyd automatically enforces legal royalty splits.
- Declared splits are legal ownership percentages.
- All payouts are instant or guaranteed.

## Technical Verification Required

- split data model
- payment allocation logic
- collaborator identity model
- receipt linkage
- payout workflow

## Legal or Policy Verification Required

- royalty law
- contractual rights
- tax reporting
- payment custody
- dispute resolution

## Commercial Status

monetization enabled

## Dependencies

- commerce implementation
- payment/payout integration
- legal split definitions
- collaborator workflows

## Open Questions

- Are splits payment instructions, attribution, legal rights, or all of these?
- Which split types are live?
- How are disputes handled?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.
