# Identity

## Definition

Identity is the capability for representing who a creator, account, profile, publisher, or participant is within Certifyd contexts. Creator identity, account identity, cryptographic identity, profile identity, legal identity, and login/authentication are separate concepts.

## Why It Exists

Certifyd needs identity so creator work, public profiles, release context, records, payments, and relationships can be connected to a recognizable source rather than only to a third-party platform account.

## Architectural Role

Identity is included in the approved Certifyd Core architectural definition, but its implementation scope is not yet verified. Core may organize identity-related data; public profile identity may expose part of it; authentication and legal identity require separate verification.

## Product Surfaces

- Core
- Creator profiles
- Network
- Fan
- Awards
- Partner infrastructure

## Intended Users

- creators
- fans
- partners
- node operators
- administrators
- investors

## Current Status

`UNCLEAR`

No component-status table required.

## Confidence

`MEDIUM`

Identity is recurring in public and investor knowledge, but the sources do not define the identity model or distinguish all identity types.

## Current Evidence

- knowledge/vision.md
- knowledge/philosophy.md
- knowledge/vocabulary.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/facts/approved-public-claims.md

## Supported Current Claims

- Certifyd positions creator identity as an important part of its ecosystem.

## Qualified Claims

- Certifyd Core is designed to power creator identity across the ecosystem.
- Creator profiles can present identity context where supported.

## Prohibited Claims

- Certifyd legally verifies every creator identity.
- Certifyd identity is equivalent to legal identity.
- Cryptographic identity, login identity, profile identity, and creator identity are interchangeable.

## Technical Verification Required

- identity data model
- authentication model
- cryptographic key model
- profile ownership model
- verification workflows
- permission boundaries

## Legal or Policy Verification Required

- legal identity verification
- privacy
- account recovery
- data rights
- impersonation and dispute policy

## Commercial Status

unclear

## Dependencies

- founder-approved identity definitions
- technical identity implementation
- privacy/legal review

## Open Questions

- What identity types does Core currently manage?
- Which identity claims are verified, self-declared, or cryptographic?
- What can public copy safely say about identity control?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.
