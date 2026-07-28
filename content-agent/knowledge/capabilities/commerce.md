# Commerce

## Definition

Commerce is the capability for creators, partners, or Certifyd surfaces to support paid or value-bearing activity. Direct sale, creator storefront, access purchase, supporter payment, marketplace, checkout, payment settlement, and creator-customer relationship are separate concepts.

## Why It Exists

Commerce exists so creator work, access, support, and related services can generate economic activity closer to the creator and connected to official context.

## Architectural Role

Direct commerce is included in the approved Core architecture and appears across public and investor knowledge. The breadth of live commerce support remains partially unverified.

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

## Current Status

`BETA`

No component-status table required.

## Confidence

`MEDIUM`

Public knowledge says fans can purchase content directly and investor knowledge describes commerce; exact live scope and revenue status require verification.

## Current Evidence

- knowledge/mission.md
- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/investors/business-model.md
- content-agent/knowledge/investors/revenue-model.md
- content-agent/knowledge/products/core.md

## Supported Current Claims

- Certifyd public knowledge supports direct commerce as a model and says fans can purchase content directly.

## Qualified Claims

- Certifyd is designed to support direct creator commerce.
- Commerce may include access purchases, supporter payments, or creator storefront flows where implemented.

## Prohibited Claims

- All commerce models are live.
- Creators own all customer data.
- Certifyd guarantees creator earnings.
- Marketplace-scale distribution is live.

## Technical Verification Required

- checkout flow
- commerce data model
- payment integrations
- entitlement and receipt linkage
- storefront/profile behaviour
- transaction logging

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

- Which commerce flows are live today?
- What does direct creator-customer relationship mean legally?
- What revenue does Certifyd currently take, if any?

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
