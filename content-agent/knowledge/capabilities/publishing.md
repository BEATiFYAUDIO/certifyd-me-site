# Publishing

## Definition

Publishing is the capability for making a work, release, profile, record, or content context available through Certifyd. Creating content, uploading content, publishing a record, hosting media, distributing media, and publishing from a creator-controlled origin are separate actions.

## Why It Exists

Publishing exists so creators can establish official work context outside a single centralized platform and connect that context to profiles, commerce, access, receipts, and discovery.

## Architectural Role

Publishing is included in the approved Core architecture. Public sources support publishing as a direction and current product theme, but the exact live scope of Core publishing is not technically verified.

## Product Surfaces

- Core
- Creator profiles
- Fan
- Network
- Partner infrastructure

## Intended Users

- creators
- partners
- node operators
- fans
- administrators

## Current Status

`BETA`

No component-status table required.

## Confidence

`MEDIUM`

Public knowledge repeatedly describes publishing and live public surfaces, but implementation scope and controlled-origin semantics are not verified.

## Current Evidence

- knowledge/mission.md
- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/ecosystem.md

## Supported Current Claims

- Certifyd public copy describes publishing as part of the product direction.
- Certifyd presents live public surfaces connected to creator work.

## Qualified Claims

- Certifyd Core is designed to support publishing.
- Publishing may include records, profile context, media context, or creator-controlled origins depending on implementation.

## Prohibited Claims

- Every creator can publish from a creator-controlled origin today.
- Uploading a file is the same as publishing a trusted record.
- Published records are permanent or legally authoritative.

## Technical Verification Required

- publishing data model
- media upload and hosting routes
- record creation flow
- public URL generation
- origin/domain model
- distribution behaviour

## Legal or Policy Verification Required

- content moderation
- copyright
- rights ownership
- record correction and takedown policy
- consumer disclosure

## Commercial Status

monetization enabled

## Dependencies

- Core implementation
- storage/origin model
- profile/catalog surfaces
- rights and moderation policies

## Open Questions

- What publishing actions are live today?
- What does creator-controlled origin mean operationally?
- What records are created when a creator publishes?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.
