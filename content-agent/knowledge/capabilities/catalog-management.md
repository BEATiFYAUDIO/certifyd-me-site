# Catalog Management


## Definition

Catalog management is the capability for organizing work, release, profile, and metadata records. It is separate from media hosting, rights administration, royalties, analytics, and discovery.

## Purpose

Keep the work, file, credit and external-reference context needed for publishing and visitor-facing discovery.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Core’s catalog schema defines work metadata, media-file references, external identifiers, source references and contributor credits as distinct records.
- Core’s publication helper computes a canonical manifest hash that can reproducibly bind work metadata to publication context.
- The schema separates outside-work references from local work and credit records; a reference does not itself establish copyright ownership or transfer rights.
- Certifyd Core maintains catalog context for works and releases.
- Catalog records can inform profiles, discovery, commerce, and Awards surfaces.

## Technical Mechanism

The Prisma schema separates work metadata, file objects, external codes/references and contributor credits. The publication helper binds a canonical manifest. Source-reference fields represent outside-work context; they do not transfer rights or media ownership.

## Creator or Fan Workflow

The verified data relationship is work → media and descriptive records → canonical publication metadata. This describes the schema and tested manifest helper; named dashboard controls and a full catalog-editing walkthrough are not newly approved by this audit.

## Current Behavior

Static inspection confirms ContentItem, ContentFile, external-identifier, source-reference and credit records in the schema. Passing manifest-helper tests confirm stable hashing and publication receipt bindings. No new catalog UI behavior is approved.

## Architectural Role

Creators keep their own structured work context and can expose it through supported public surfaces. Catalog records remain separate from legal rights administration or guaranteed royalties.

## Why It Exists

Catalog management exists so creators can maintain structured context around works and releases that can appear across profiles, Fan, Awards, commerce, and partner surfaces.

## Product Surfaces

- Core
- Creator profiles
- Fan
- Awards
- Partner infrastructure

## Intended Users

- creators
- partners
- administrators
- fans
- investors

## Current Evidence

- knowledge/mission.md
- knowledge/faq.md
- knowledge/vocabulary.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/products/core.md
- `/home/Darryl/Projects/contentbox/apps/api/prisma/schema.prisma: ContentItem, ContentSourceReference, ContentExternalIdentifier, ContentCredit, ContentFile`
- `/home/Darryl/Projects/contentbox/apps/dashboard/src/pages/ContentLibraryPage.tsx`
- `/home/Darryl/Projects/contentbox/apps/dashboard/src/pages/LibraryPage.tsx`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/contentPublish.ts`
- `https://certifyd.me/core/guide/#works-tab`
- `https://certifyd.me/core/guide/#rights`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- The audit verifies record structure and selected workflows, not complete industry-code coverage, rights administration, automated catalog valuation or an external platform’s content licence.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Certifyd fully manages royalties.
- Catalog performance tracking is live.
- Catalog records prove rights ownership.

## Technical Verification Required

- Bulk import, every external lookup provider, takedown handling and rights/royalty administration coverage remain unverified.

## Legal or Policy Verification Required

- rights administration
- copyright
- royalties
- metadata disputes
- takedowns

## Commercial Status

unclear

## Dependencies

- publishing
- release records
- profiles
- technical schema
- rights policy

## Open Questions

- Bulk import, every external lookup provider, takedown handling and rights/royalty administration coverage remain unverified.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

The audit verifies record structure and selected workflows, not complete industry-code coverage, rights administration, automated catalog valuation or an external platform’s content licence.

## Historical Beta 20 Comparison

The guide’s Works/Library distinction is retained. Legacy route prerequisites are setup-dependent and are not rewritten as universal entitlement or legal ownership rules.

## Verification Status

Verified on 2026-11-05. Static inspection of the Prisma catalog schema; passing contentPublish helper tests. Catalog UI was source-reviewed only.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Static schema inspection confirms separate work, media, credit, identifier and reference records. Passing publication-helper tests demonstrate stable hashes and receipt bindings only; no catalog-editing workflow was executed.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Works/Library/Legacy UI, bulk import, external lookups and full catalog-editing behavior were not exercised. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
