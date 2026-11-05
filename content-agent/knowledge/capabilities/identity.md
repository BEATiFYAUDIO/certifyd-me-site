# Identity


## Definition

Identity is the capability for representing who a creator, account, profile, publisher, or participant is within Certifyd contexts. Creator identity, account identity, cryptographic identity, profile identity, legal identity, and login/authentication are separate concepts.

## Purpose

Explain creator identity verification and signing permissions: connect a creator’s public profile and external accounts to a locally held signing identity, while keeping login, account-control proof and legal identity distinct.

## Current Status

`BETA`

The verified subset is beta implementation behavior; this is not a general-availability or legal-rights classification.

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Certifyd Core separates registered creator signing identity, outside-account control challenges and creator-signed AR device authorization.
- The dashboard key-storage implementation defines browser-local IndexedDB storage; Core’s registration service stores the public key and fingerprint separately.
- The dashboard key-storage implementation defines an Ed25519 WebCrypto path and a separate local Noble fallback; key storage and recovery are distinct concerns.
- Core’s social-proof service checks provider/account/challenge context; a public profile locator supplies discovery metadata rather than independent proof.
- An AR device key requires a separate authorization signed by the active creator key and can be revoked. Creator verification alone does not authorize an AR browser.
- Certifyd positions creator identity as an important part of its ecosystem.

## Technical Mechanism

The secure-context path generates a non-extractable Ed25519 CryptoKey and stores it in the browser origin’s IndexedDB. The implementation also contains a Noble fallback storing raw private-key material locally when WebCrypto cannot be used; therefore “all creator keys are hardware-backed/non-exportable” is false. Core stores the public key, a SHA-256 fingerprint and active-key/recovery records. Canonical social markers bind provider, account, nonce and profile locator; profile= aids discovery, not proof authority.

## Creator or Fan Workflow

In the tested service flow, Core registers the creator’s public key, verifies an outside-account challenge and separately checks a creator-signed authorization for an AR device key. The dashboard storage source defines where the creator key resides; a complete browser creation/recovery walkthrough was not exercised.

## Current Behavior

Passing service tests verify public-key registration/recovery, platform-specific proof checks and scoped/revocable AR authorization. Dashboard key storage and fallback are confirmed source definitions, not a browser-runtime test.

## Architectural Role

A creator can present independently checkable signed context instead of treating a social username or one application login as the sole identity. The creator still depends on the browser’s key storage and the availability of the relevant Core verification surface.

## Why It Exists

Certifyd needs identity so creator work, public profiles, release context, records, payments, and relationships can be connected to a recognizable source rather than only to a third-party platform account.

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

## Current Evidence

- knowledge/vision.md
- knowledge/philosophy.md
- knowledge/vocabulary.md
- content-agent/knowledge/products/core.md
- content-agent/knowledge/facts/approved-public-claims.md
- `/home/Darryl/Projects/contentbox/apps/dashboard/src/modules/witness/useWitnessIdentity.ts: generateWithWebCrypto, generateWithNoble, signWithLocalWitnessKey`
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/witness.service.ts: computeWitnessFingerprint, active-key and legacy-recovery functions`
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/proof.service.ts: buildSocialProofEnvelope, createSocialChallenge`
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/certifydAr.routes.ts: challenge/authorize/revoke handlers`
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/witness.service.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/certifydAr.routes.test.ts`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/proof.service.social.test.ts`

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Browser/origin storage can be lost or inaccessible; keys are not automatically synchronized across devices. Password-based recovery is a particular legacy recovery path, not proof that every original key is recoverable. Do not equate signatures, account-control challenges or profile identity with legal identity, authorship or copyright ownership.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Certifyd legally verifies every creator identity.
- Certifyd identity is equivalent to legal identity.
- Cryptographic identity, login identity, profile identity, and creator identity are interchangeable.

## Technical Verification Required

- Cross-device key portability, every supported-browser recovery edge case, and legal identity or ownership verification remain outside the verified subset.

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

- Cross-device key portability, every supported-browser recovery edge case, and legal identity or ownership verification remain outside the verified subset.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

Browser/origin storage can be lost or inaccessible; keys are not automatically synchronized across devices. Password-based recovery is a particular legacy recovery path, not proof that every original key is recoverable. Do not equate signatures, account-control challenges or profile identity with legal identity, authorship or copyright ownership.

## Historical Beta 20 Comparison

The guide’s optional social-proof workflow remains documented. Its short “prove an identity” wording does not establish a legal identity or automatic browser-key transfer.

## Verification Status

Verified on 2026-11-05. Witness registration/recovery, proof.service.social and certifydAr.routes tests; static inspection of useWitnessIdentity.ts for dashboard storage and fallback.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing service tests demonstrate Ed25519 public-key validation, registered-key recovery behavior, exact provider/account/challenge checks and creator-signed, scoped/revocable AR authorization. Browser key storage/fallback is statically inspected source, not a browser-runtime test.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Browser creation/recovery UX, cross-device key custody and exact released-build mapping remain unverified. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
