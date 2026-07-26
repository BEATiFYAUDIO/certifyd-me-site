# Capability Consistency Review

## Source Scope

This review compares the newly created capability files against:

- `content-agent/knowledge/products/core.md`
- `content-agent/knowledge/ecosystem.md`
- `content-agent/knowledge/vocabulary.md`
- `content-agent/knowledge/facts/approved-public-claims.md`
- `content-agent/knowledge/founder-decisions.md`

No existing source files were modified for this review.

## Contradictions Found

### Core definition: approved architecture versus older investor extraction

- `content-agent/knowledge/products/core.md` and `content-agent/knowledge/ecosystem.md` now apply the founder-approved definition of Core as the foundational engine.
- `content-agent/knowledge/investors/investor-claims-review.md` still contains older language saying the investor-site definition of Core needs founder decision.
- **Impact:** Later normalization should update investor claim-review notes so they do not treat the Core definition as unresolved.

### Network role: architecture approved, technical relationship unresolved

- `content-agent/knowledge/ecosystem.md` defines Network as the distributed infrastructure layer.
- `content-agent/knowledge/founder-decisions.md` still keeps the exact Core-to-Network technical relationship pending.
- **Impact:** Capability files can describe Network architecturally, but must not claim implementation details such as federation, replication, portability, uptime, or independence.

### Creator profile status: live surface versus undefined full scope

- `content-agent/knowledge/ecosystem.md` treats creator profiles as Core-powered public surfaces.
- `content-agent/knowledge/facts/approved-public-claims.md` supports live public profile surfaces but says full scope needs confirmation.
- **Impact:** `profiles.md` can be `LIVE`, but only for public profile surfaces, not every profile-related capability.

### Revenue language: investor model versus current revenue

- Investor files describe transaction revenue, subscriptions, promotion fees, registration fees, service fees, and usage fees.
- Approved public claims do not verify active revenue by stream.
- **Impact:** Capability commercial status must distinguish monetization enabled, pricing proposed, investor-model revenue, and active verified revenue.

### Ownership language: brand philosophy versus legal meaning

- Root knowledge files use strong language such as ownership, own your audience, retain rights, and creator-owned infrastructure.
- Approved public claims and founder decisions caution against legal ownership, customer-data ownership, or rights guarantees.
- **Impact:** Capability files prohibit absolute ownership claims unless legally and technically verified.

## Missing Definitions

- `creator ownership`
- `creator-controlled`
- `creator-owned infrastructure`
- `direct fan relationship`
- `node`
- `sovereign node`
- `provenance`
- `proof-backed`
- `source-of-truth profile`
- `publisher identity`
- `release record`
- `receipt` as commerce record versus proof record versus payment record
- `split` as attribution versus payment instruction versus legal royalty split
- `payout` timing, custody, and participant scope

## Duplicate Terms

- `Certifyd Creator`, `Certifyd`, and `Certifyd Network` appear as overlapping public labels in older root knowledge.
- `profile`, `storefront`, and `source of truth` overlap but are not identical.
- `node`, `sovereign node`, `creator node`, and `operator node` appear related but are not normalized.
- `receipts`, `records`, `proof`, and `provenance` overlap but require separate definitions.
- `direct commerce`, `creator commerce`, `support`, `payments`, and `payouts` overlap but are not interchangeable.

## Capability Claims Stronger Than Approved Public Claims

The capability files avoid approving the following as current public claims because existing approved claims do not support them:

- Core capabilities are generally available.
- Provenance legally proves authorship or ownership.
- Receipts are permanent or immutable.
- Splits automatically enforce royalties.
- Payouts are instant, guaranteed, or non-custodial.
- Network is fully decentralized or company-independent.
- Creator profiles prove legal ownership of displayed work.
- Fan includes every described feature as live.
- Awards voting, scoring, rewards, payment, or proof-backed ranking are live.
- Analytics and catalog performance tracking are comprehensive and live.

## Approved Architectural Statements Lacking Implementation Evidence

- Core powers identity, publishing, provenance, creator profiles, release records, access, and direct commerce.
- Creator profiles are Core-powered public surfaces.
- Fan is powered by or connected to Core.
- Awards is powered by or connected to the broader ecosystem.
- Network is the distributed infrastructure layer.

These statements are approved architecturally but still require implementation evidence before making detailed capability claims.

## Terms Requiring Founder Clarification

- Creator ownership.
- Creator-controlled infrastructure.
- Direct fan relationship.
- Node and sovereign node.
- Provenance and proof-backed.
- Source-of-truth profile.
- Public versus investor use of Core terminology.
- Which commerce capabilities are live.
- Which revenue streams are active.
- Whether Awards is currently connected to records, fan activity, commerce, or Network data.

## Files Recommended For Later Normalization

- `knowledge/brand.md`: remove or clarify older `Certifyd Creator logo` naming if it implies a product.
- `knowledge/mission.md`: separate live capabilities from broad chatbot claims about royalties, catalog performance, and ownership.
- `knowledge/vision.md`: soften or define `own your audience`, `distributed`, and company-independence language.
- `knowledge/philosophy.md`: align ownership philosophy with legal/technical caution.
- `knowledge/vocabulary.md`: update product hierarchy and replace ambiguous terms with approved vocabulary.
- `knowledge/faq.md`: revise receipts, splits, payouts, royalties, and ownership answers to match approved claim limits.
- `content-agent/knowledge/investors/investor-claims-review.md`: update older Core decision notes after the approved Core definition.
- `content-agent/knowledge/facts/approved-public-claims.md`: later incorporate capability-file findings once founder and technical verification are complete.
- `content-agent/knowledge/founder-decisions.md`: close or refine decisions as founder approvals arrive.

## Summary

The new capability files are intentionally conservative. They preserve the approved Core architecture while preventing architecture from being mistaken for live implementation, legal proof, active revenue, or governance guarantees.

## Update History

- 2026-07-26: Initial consistency review created from existing knowledge base and new capability files. Approval status: internal knowledge draft, not public claim approval.
