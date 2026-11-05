# Publishing


## Definition

Publishing is the capability for making a work, release, profile, record, or content context available through Certifyd. Creating content, uploading content, publishing a record, hosting media, distributing media, and publishing from a creator-controlled origin are separate actions.

## Purpose

Turn a creator’s private work draft into a deliberate public publication, preserving manifest/proof verification and the applicable public-access permissions.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core’s schema distinguishes work state, metadata and media-file records; a stored file is not itself a publication receipt.
- Core computes a canonical manifest hash with stable object-key ordering and explicit schema versions so the same manifest can be checked reproducibly.
- Core’s publication receipt payload binds the content ID, manifest hash, publication time and creator/provider node identifiers.
- The delegated-publication response helper distinguishes relationship-required responses from other conflicts and upstream failures.
- Certifyd public copy describes publishing as part of the product direction.
- Certifyd presents live public surfaces connected to creator work.

## Technical Mechanism

normalizeManifestForPublish fixes schema/manifest versions and computeCanonicalManifestHash uses deterministic canonical JSON hashing. buildContentPublishReceiptPayload binds content ID, manifest hash, publication time and node identifiers. The wider handler/UI paths are source-reviewed observations in the audit, rather than exercised publication workflows.

## Creator or Fan Workflow

For the tested helper contract, normalize the work’s manifest, compute its canonical hash, and bind that hash to content and node identifiers in a publication receipt. This supports explaining reproducible publication context without claiming a complete creator click-through was tested.

## Current Behavior

Passing helper tests verify manifest normalization, key-order-independent hashing, receipt bindings and delegated-response classification. The wider publication handler was source-reviewed, not exercised end to end.

## Architectural Role

Publication context originates from the creator’s Core installation rather than being only an entry inside an outside media platform. A hash anchors particular data; it does not establish legal rights or make hosting permanent.

## Why It Exists

Publishing exists so creators can establish official work context outside a single centralized platform and connect that context to profiles, commerce, access, receipts, and discovery.

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

## Current Evidence

- knowledge/mission.md
- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/ecosystem.md
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/proof.ts: stableStringify, computeManifestHash`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/publishGate.ts: assertCanPublish`
- `/home/Darryl/Projects/contentbox/apps/api/src/server.ts: content publication handler and lockedManifestSha256 update`
- `/home/Darryl/Projects/contentbox/apps/dashboard/src/pages/LibraryPage.tsx`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Available publish kinds depend on mode and readiness. A public link is not payment readiness. Hashes are not copyright proof, unchangeable hosting, or a promise that every publication is cryptographically signed.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Every creator can publish from a creator-controlled origin today.
- Uploading a file is the same as publishing a trusted record.
- Published records are permanent or legally authoritative.

## Technical Verification Required

- Every mode’s end-to-end publication experience, correction/takedown policy and third-party hosting guarantees remain unverified.

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

- Every mode’s end-to-end publication experience, correction/takedown policy and third-party hosting guarantees remain unverified.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

Available publish kinds depend on mode and readiness. A public link is not payment readiness. Hashes are not copyright proof, unchangeable hosting, or a promise that every publication is cryptographically signed.

## Historical Beta 20 Comparison

The Beta 20 draft → file/details → readiness → publish sequence remains consistent with current source. Split completion applies to collaborative commerce; the current Basic path can create the solo owner allocation automatically.

## Verification Status

Verified on 2026-11-05. contentPublish and contentPublishDelegation helper tests. Source-only UI/readiness observations are separated in the audit.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing helper tests demonstrate manifest version normalization, key-order-independent hashing, publication receipt bindings and delegated response classification. They do not run the complete publication handler or dashboard.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Full publishing/readiness UI, profile inclusion, per-build participation policy and production publication remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
