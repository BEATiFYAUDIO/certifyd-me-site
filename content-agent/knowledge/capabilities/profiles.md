# Profiles


## Definition

Profiles are public creator-facing surfaces powered by Certifyd Core. A profile can present identity and work context, but it is not the same as identity, an account, a domain, a catalog, or a storefront.

## Purpose

Give a creator a public presentation surface while keeping private account administration and public visibility separate.

## Current Status

`LIVE`

No component-status table required.

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core separates private dashboard routes from public creator routes; its public route policy includes the canonical /u/:handle profile and /u/:handle/proofs.json verification surface.
- Core’s public AR proof response can expose current creator-authorized AR keys separately from private creator administration.
- Core’s public-sharing lifecycle requires consent and distinguishes listener startup from public routing; configuring a connector alone does not establish reachability.
- Certifyd presents live public creator profile surfaces.
- Creator Profiles are public creator-facing surfaces powered by Certifyd Core.

## Technical Mechanism

The Core runtime has a private API/dashboard and an allowlisted public server. Canonical creator profiles use /u/:handle and publish a proofs.json bundle for account-control and AR authorization checks.

## Creator or Fan Workflow

A public client requests the creator profile or proof surface. Private creator administration remains behind the separate listener/route boundary. The tested sharing lifecycle obtains consent and starts its listener before routing.

## Current Behavior

Passing public server, host guard and route policy tests verify representative public/private boundaries. The AR route test verifies a public authorized-key proof response. Presentation editing and profile-inclusion UI were not tested.

## Architectural Role

The creator operates the page and selects its public contents. A public route and a profile are not the same as legal identity, proof of rights or a guarantee of discovery.

## Why It Exists

Profiles exist so creators have an official public context for identity, work, catalog, publishing, and direct relationships that is not limited to social channels.

## Product Surfaces

- Core
- Creator profiles
- Fan
- Network
- Partner infrastructure

## Intended Users

- creators
- fans
- partners
- businesses
- investors

## Current Evidence

- knowledge/brand.md
- knowledge/mission.md
- knowledge/vision.md
- knowledge/vocabulary.md
- content-agent/knowledge/ecosystem.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/founder-decisions.md
- `/home/Darryl/Projects/contentbox/apps/api/src/publicServer.ts: DEFAULT_PUBLIC_PORT, createPublicServer`
- `/home/Darryl/Projects/contentbox/apps/api/src/security/publicRoutePolicy.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/server.ts: /u/:handle and /u/:handle/proofs.json handlers`
- `/home/Darryl/Projects/contentbox/apps/dashboard/src/pages/LibraryPage.tsx`
- `/home/Darryl/Projects/contentbox/apps/dashboard/src/modules/witness/VerificationProofsCard.tsx`
- `https://certifyd.me/core/guide/#library-first`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.
- `/home/Darryl/Projects/contentbox/apps/api/src/security/publicRoutePolicy.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/security/privateHostGuard.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/publicServer.test.ts`

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- LIVE still refers to the already documented public profile surface. Newly inspected controls and proof behavior are beta implementation evidence, not a claim of uniform production rollout. Third-party availability, consent and routing affect visibility.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Every creator profile is legally verified.
- A profile proves ownership of all work shown.
- Profile control equals ownership of customer data.

## Technical Verification Required

- Uniform rollout, all presentation/upload constraints, profile takedown policy and custom-domain recovery need separate validation.

## Legal or Policy Verification Required

- identity claims
- privacy
- impersonation
- rights disputes
- customer data ownership

## Commercial Status

monetization enabled

## Dependencies

- Core profile implementation
- public URL routing
- creator account/control model

## Open Questions

- Uniform rollout, all presentation/upload constraints, profile takedown policy and custom-domain recovery need separate validation.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

LIVE still refers to the already documented public profile surface. Newly inspected controls and proof behavior are beta implementation evidence, not a claim of uniform production rollout. Third-party availability, consent and routing affect visibility.

## Historical Beta 20 Comparison

The Beta 20 distinction between Publish and Add to Profile remains supported by the current Library implementation. The guide’s profile-image upload limit was not independently revalidated for every newer release; it is not a universal current limit.

## Verification Status

Verified on 2026-11-05. Public route policy, private host guard, public server/lifecycle and scoped AR proof route tests.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing route, host-guard and listener tests exercise representative public/private boundaries and sharing startup/rollback. The AR route test verifies a public authorized-key response. Profile editing and inclusion controls were not exercised.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. The pre-existing LIVE designation remains limited to the previously evidenced public discovery/profile surface; it does not extend to every mechanism described here.

## Unresolved Issues

Profile presentation editing, publication/inclusion click-through and production route availability were not verified here. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
