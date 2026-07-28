# Discovery

## Definition

Discovery is the capability for helping people find creators, works, profiles, or ecosystem activity. Discovery does not automatically mean algorithmic recommendation, guaranteed reach, or platform-scale distribution.

## Why It Exists

Discovery exists so creators and work can be found through Certifyd surfaces instead of relying only on centralized social or streaming platforms.

## Architectural Role

Discovery is exposed through Fan and connected to Network/investor positioning. Public surfaces are linked, but recommendation logic and scale are not verified.

## Product Surfaces

- Fan
- Network
- Creator profiles
- Core
- Awards

## Intended Users

- fans
- creators
- partners
- investors

## Current Status

`LIVE`

No component-status table required.

## Confidence

`MEDIUM`

Fan is publicly linked as Discover, and discovery is recurring public positioning. The exact feature scope is not verified.

## Current Evidence

- knowledge/brand.md
- knowledge/vision.md
- knowledge/vocabulary.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/investors/revenue-model.md

## Supported Current Claims

- Certifyd links to Fan as a discovery surface.

## Qualified Claims

- Certifyd is designed to support creator and work discovery.
- Discovery may be expanded through Network and AI/data systems where funded and implemented.

## Prohibited Claims

- Certifyd guarantees reach.
- Algorithmic recommendations are live.
- Discovery is platform-scale.
- Discovery outcomes are guaranteed.

## Technical Verification Required

- Fan discovery UI
- search/indexing model
- ranking/recommendation logic
- creator/work resolver
- Network data sources

## Legal or Policy Verification Required

- privacy
- ranking fairness
- advertising/promotional disclosures
- data rights

## Commercial Status

monetization enabled

## Dependencies

- Fan
- profiles
- Network data
- future analytics/AI systems

## Open Questions

- What discovery features are live?
- Is recommendation algorithmic or directory/search-based?
- How are promoted results identified?

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Scrape Update — 2026-07-28

Fan discovery is better supported than previously captured. The Fan PWA reads public discoverable content from creator origins and can load creator origins from a static registry and environment configuration. It has UI concepts for topic chips, search by title/creator/topic/type, watch routes, creator spotlights, network pulse, active creator ecosystems, recently published, top selling, top connected, fastest moving, free drops, and premium works.

- **Classification:** `LIVE` as Fan app/repository behavior, subject to deployment status.
- **Source:** `BEATiFYAUDIO/certifyd-fan-pwa README.md`; `src/routes/HomePage.tsx`; `docs/DISCOVERY_RANKING.md`; `docs/certifyd-player-mvp.md`.

### Discovery Authority Boundary

Fan discovery ranking is presentation-only. It must not decide entitlement, payment, payout, settlement, receipt validity, content access, or commerce authority. It only sorts already-discoverable public items returned to the Fan PWA.

- **Approved claim:** Certifyd Fan can rank and present public-safe discovery signals.
- **Prohibited claim:** Certifyd Fan determines payment, entitlement, settlement, receipt validity, payout, split, or proof authority.
