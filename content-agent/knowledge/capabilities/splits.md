# Splits


## Definition

Splits describe how revenue or credit may be allocated among contributors or participants. Declared contribution splits, royalty splits, payment splits, revenue-sharing instructions, and legal ownership percentages are separate concepts.

## Purpose

Record agreed participant allocations and preserve the exact participant/version context used for a work’s supported commerce accounting.

## Current Status

`BETA`

The verified subset is beta implementation behavior; this is not a general-availability or legal-rights classification.

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core’s schema records collaborator splits as versioned participant allocations with invitation, acceptance and verification state.
- Core’s participant-authority helpers require a bound identity, acceptance and verification before including a participant in commerce authority.
- The commerce selector uses the applicable locked split rather than silently replacing it with a newer draft.
- Derivative settlement logic requires the exact parent split snapshot rather than inferring authority from the latest available version.
- Supported purchase finalization checks allocation totals and records participant amounts; this does not guarantee that every participant payout has already succeeded.
- A split can describe how revenue from a sale may be allocated among contributors or participants.

## Technical Mechanism

SplitVersion and SplitParticipant define basis points, percentages and acceptance/verification fields. The verified splitAuthority helpers select eligible participants and locked versions, and require an explicit parent split snapshot for derivative allocations. The full lock handler is outside the exercised subset.

## Creator or Fan Workflow

The tested authority flow checks participant identity, acceptance and verification, selects the appropriate locked version, and uses an explicit parent snapshot for a derivative. Purchase fixtures then check allocation totals. The full invite/accept/lock interface and live contributor payments were not exercised.

## Current Behavior

Schema inspection confirms versioned participant and invitation state. Passing authority/identity-gate tests check participant eligibility, locked-version selection and explicit derivative snapshots. Purchase fixtures verify allocations; the lock route itself was not exercised.

## Architectural Role

Collaborators and later accounting refer to the same explicit participant snapshot. The arithmetic is not a legal ruling about authorship, royalty entitlement or contract enforceability.

## Why It Exists

Splits exist so collaboration and revenue participation can be represented more clearly in creator commerce and attribution contexts.

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

## Current Evidence

- knowledge/vocabulary.md
- knowledge/faq.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/products/core.md
- `/home/Darryl/Projects/contentbox/apps/api/prisma/schema.prisma: SplitVersion, SplitParticipant`
- `/home/Darryl/Projects/contentbox/apps/api/src/server.ts: lockSplitVersionForOwner, /content/:id/splits, /split-versions/:id/lock`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/splitAuthority.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/splitAuthority.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/participantIdentityGate.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/finalizePurchase.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/payments/purchaseFulfillment.test.ts`
- `/home/Darryl/Projects/contentbox/docs/proofs.md`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Basic solo publication is separate from multi-party split editing. Tests do not establish tax treatment, legal copyright percentages, automatic dispute resolution or guaranteed payout timing. The database is not claimed to be an immutable blockchain.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Certifyd automatically enforces legal royalty splits.
- Declared splits are legal ownership percentages.
- All payouts are instant or guaranteed.

## Technical Verification Required

- Every invitation transport and cross-node recovery path, collaborator disputes, legal agreement semantics and live multi-wallet payouts remain unverified.

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

- Every invitation transport and cross-node recovery path, collaborator disputes, legal agreement semantics and live multi-wallet payouts remain unverified.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

Basic solo publication is separate from multi-party split editing. Tests do not establish tax treatment, legal copyright percentages, automatic dispute resolution or guaranteed payout timing. The database is not claimed to be an immutable blockchain.

## Historical Beta 20 Comparison

The guide’s accept → active total 100% → lock sequence is corroborated. Do not generalize the collaborative workflow into a requirement for every free solo Basic publication; that path can generate its owner allocation.

## Verification Status

Verified on 2026-11-05. splitAuthority, participantIdentityGate, finalization and isolated fulfilment tests; schema inspection for versioned records. No direct lock-route runtime test.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing tests demonstrate participant identity/acceptance/verification filtering, locked-version selection, explicit derivative-parent snapshots and purchase-allocation arithmetic. They do not exercise the complete invitation/acceptance/lock route or live multi-wallet payouts.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Complete collaborator invitation/lock UX, cross-node recovery, live payouts and legal agreement semantics remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
