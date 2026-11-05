# Release Records


## Definition

Release records are structured records about a work or release. They may include title, creator, contributor, date, files, metadata, access context, payment context, or attribution context depending on implementation.

## Purpose

Connect a published work to the exact manifest, file and split context being asserted at publication.

## Current Status

`BETA`

The verified subset is beta implementation behavior; this is not a general-availability or legal-rights classification.

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core’s publication and split-proof structures bind a work to a manifest hash and, where present, a primary-file hash and locked split version.
- Canonical manifest serialization uses stable key ordering so a verifier can recompute the same hash from the same data.
- Core supports a portable proof-bundle structure combining publication and split anchors, with optional settlement context.
- Proof-bundle signatures are optional in the documented v1 format; a hash-bound record must not automatically be described as signed, blockchain-anchored or legally authoritative.
- Certifyd Core supports release records.
- Release records preserve work, release, and attribution context for creator workflows.

## Technical Mechanism

contentPublish normalizes schemaVersion/manifestVersion and hashes canonical JSON. ProofPayload binds contentId, splitVersion, lockedAt, manifestHash, primaryFileSha256 and creatorId. Portable proof bundles combine publish and split anchors; optional settlement lines and signatures are separate.

## Creator or Fan Workflow

The tested helpers construct canonical publication context and the existing verifier checks fixture publication/split anchors. This supports explaining reproducible records, without claiming the export interface or a production release was exercised.

## Current Behavior

Core models published content and its split versions, records canonical manifest hashes and constructs publication/proof payloads. These are technical anchors, not a blanket legal registry.

## Architectural Role

A later verifier can compare specific manifests and participant snapshots rather than relying only on a mutable presentation page. That does not make the underlying ownership claim legally authoritative.

## Why It Exists

Release records exist so works can carry clearer context into profiles, discovery, commerce, receipts, Awards, and partner surfaces.

## Product Surfaces

- Core
- Creator profiles
- Fan
- Awards
- Partner infrastructure

## Intended Users

- creators
- fans
- partners
- administrators
- investors

## Current Evidence

- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/facts/approved-public-claims.md
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/proof.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/proofs/proofBundle.ts`
- `/home/Darryl/Projects/contentbox/docs/proofs.md`
- `/home/Darryl/Projects/contentbox/apps/api/prisma/schema.prisma: SplitVersion.lockedManifestSha256, lockedFileSha256`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Technical hashes show consistency with supplied data, not independent truth of authorship, a legal copyright registration or guaranteed permanence. Optional v1 bundle signatures are distinct from mandatory Ed25519 AR-record signatures.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Release records are permanent or immutable.
- Release records are legal registrations.
- Release records are universally accepted proof of rights.

## Technical Verification Required

- Public export UI coverage, long-term independent retention, correction/dispute policy and legal authority remain unresolved.

## Legal or Policy Verification Required

- copyright
- rights ownership
- record disputes
- retention policy
- corrections and takedowns

## Commercial Status

unclear

## Dependencies

- Core record model
- creator profile integration
- legal policy

## Open Questions

- Public export UI coverage, long-term independent retention, correction/dispute policy and legal authority remain unresolved.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

Technical hashes show consistency with supplied data, not independent truth of authorship, a legal copyright registration or guaranteed permanence. Optional v1 bundle signatures are distinct from mandatory Ed25519 AR-record signatures.

## Historical Beta 20 Comparison

The older release-record implementation uncertainty is narrowed for these inspectable hash/proof structures. The guide itself does not establish a blockchain anchoring protocol.

## Verification Status

Verified on 2026-11-05. contentPublish canonicalization/receipt tests and the existing proof-bundle verifier script.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing canonicalization/receipt tests and the proof-bundle fixture script demonstrate reproducible manifest and split/publication bindings. They do not validate a production export UI or legal authority.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Production proof export, persistence/recovery guarantees and shipped-build parity remain unverified; legal authority is not established by a hash. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
