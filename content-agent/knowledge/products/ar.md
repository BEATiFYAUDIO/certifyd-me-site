# Certifyd AR Browser and Extension


## Definition

Certifyd AR is browser augmentation technology that adds signed creator context to supported Web2 profiles. Signature verification checks the contextual record; Core controls the creator and device publishing permissions. Registry discovery locates a record but cannot grant those permissions.

## Purpose

Let creators present signed, verified context alongside supported existing Web2 profiles without asking the outside site to become the authority for that context.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies only to the cryptographic, authorization, adapter and transport mechanisms covered by passing offline tests. It does not classify a complete editor workflow or establish deployment/build parity.

## Review State

APPROVED technical wording is limited to the supported claims below. Unresolved UI behavior, production availability and unverified platform-build equivalence are not approved by this record. Normal founder article review remains required.

## Supported Current Claims

- Certifyd AR binds a signed record to a canonical creator profile URL and a specific provider/account, using Ed25519 signatures over a domain-separated, canonical JSON payload.
- The extension verifies the signed record and checks that its AR device key is currently authorized by the creator’s live Core proof bundle; registry discovery alone is not identity authority.
- Creator identity and browser authorization are separate: a locally generated AR device key needs a creator-key-signed Core authorization, and revoking that authorization removes its authority.
- The AR device signing key is generated as a non-extractable WebCrypto key and stored in the extension’s local IndexedDB; that AR device key is distinct from the creator’s dashboard signing key.
- The inspected extension has Spotify, YouTube, GitHub and TikTok page adapters, with shared proof/authorization checks and Reveal, Support and Action record slots.
- The publish service validates record signatures, live Core authorization and increasing record sequence before updating the GitHub-backed public registry; the registry stores/discovers records but does not replace Core proof authority.

## Technical Mechanism

The extension’s record signing text is the fixed domain `Certifyd AR Record v1`, a newline, and canonical JSON with sorted object keys. The payload binds version, creator profile/node/handle, provider/account, timestamp, positive sequence and slots. Changing signed data fails verification. The AR authorization has a separate `Certifyd AR authorization v1` domain, creator identity/key, AR public key, purpose and challenge. Core validates the creator signature before authorizing the AR key; consumers verify that authorization against the live Core witness key. The record and authorization signatures have different jobs.

The publish service checks the record again, fetches live Core proofs, checks account and device authority, then enforces a newer sequence when writing registry data. Cached or copied registry entries cannot substitute for current Core authorization. This is not a blockchain or automatic peer-replication system.

## Creator or Fan Workflow

In the tested protocol, the creator signs an authorization for a separate AR device key. That key signs context for the matching profile/provider/account. The consumer checks both the record signature and current Core authorization before accepting the context. Passing adapter and panel fixtures also check the fan-facing context on the supported page shapes. This describes the verified contract, not an end-to-end creator editor walkthrough.

## Current Behavior

The passing offline adapter, authorization, transport and panel fixtures cover provider/account discovery, account-control matching, record signature checks, live-Core authorization checks against mocked responses, and fan-facing context rendering. They do not establish live-site or released-build equivalence.

## Architectural Significance

The outside profile helps locate the creator, while Core supplies the live proof/authorization authority and the creator-authorized device signs the extra context. The registry transports that context; it cannot authorize itself. Creators do not need to supply their own GitHub publishing credentials to view registry-backed records.

## Qualified Claims

- Describe the audited beta mechanism, not universal availability across every extension, Android, iOS or Safari build.
- A valid signature establishes consistency with an authorized key and signed context; it does not independently establish legal identity, authorship, endorsement or copyright ownership.
- Live Core reachability, supported browser crypto/storage, page adapters and registry/publish infrastructure remain dependencies.
- The AR browser’s bundled extension is pinned separately; desktop checkout behavior must not be assumed identical to every distributed APK or Apple build.

## Prohibited Claims

- An AR registry entry is sufficient proof of creator identity or authorization.
- Every social account or every Web2 site is supported.
- The extension’s key is the same as the creator’s Core key.
- AR signatures prove copyright ownership or cannot ever be revoked.
- The GitHub registry makes AR fully decentralized or removes Core availability dependencies.
- All popup/editor, mobile and store-distribution flows passed this audit.

## Current Evidence

- `/home/Darryl/Projects/certifyd-extension/src/ar-record.js`: signingText, signPayload, verifySignedRecord, saveRecord.
- `/home/Darryl/Projects/certifyd-extension/src/ar.js`: authorizationFields, verifyConnection, modeForPage.
- `/home/Darryl/Projects/certifyd-extension/src/ar-key.js`: createKey, local IndexedDB and non-extractable WebCrypto generation.
- `/home/Darryl/Projects/certifyd-extension/src/social-proof-contract.js` and `src/adapters/{spotify,youtube,github,tiktok}.js`.
- `/home/Darryl/Projects/certifyd-extension/src/ar-transport-static.js` and `docs/ARCHITECTURE.md`.
- `/home/Darryl/Projects/certifyd-extension/tests/ar-record.test.js`, `tests/ar.test.js`, `tests/ar-transport-static.test.js`, `tests/social-proof-contract.test.js`.
- `/home/Darryl/Projects/contentbox/apps/api/src/modules/witness/certifydAr.routes.ts` and its test file.
- `/home/Darryl/Projects/certifyd-ar-publish-service/src/record.ts`, `src/core.ts`, `src/canonical.ts`, `src/github.ts`.
- `/home/Darryl/Projects/certifyd-ar-publish-service/tests/publish.test.ts`.
- `content-agent/knowledge/capabilities/consistency-review.md` — pinned revisions, dirty-tree scope, test failures and release gaps.

## Historical Beta 20 Comparison

The Core guide explains platform-account verification and the prerequisites for public profiles. It does not document the AR signing algorithm or authorization protocol. The Ed25519/canonicalization/registry claims above come from the separate implementation and tests, not an inference from that guide.

## Missing Technical Evidence

- Exact equality of the audited desktop code with every shipped Android/Safari/iOS build and store-approved binary.
- Complete creator-editor and physical-device/browser verification is outside the supported subset. Defect evidence is recorded only in the separate consistency audit.
- Production deployment revision, operational availability, registry retention/recovery guarantees and broader third-party site coverage.

## Verification Status

Tested source behavior: the beta signing, authorization, adapter and transport subset passed isolated tests on 2026-11-05 at the revisions recorded in the consistency audit. Core and extension checkouts include pre-existing uncommitted work. Confirmed released functionality: no new release claim is established by this enrichment; no shipped binary, store build or production deployment was verified. Editor failures and unresolved observations are quarantined in the audit rather than approved here.

## Verified Mechanism

Passing tests demonstrate non-extractable Ed25519 key generation with simulated IndexedDB persistence, canonical record signing/tamper rejection, scoped/revocable authorization, mocked live-Core checks, adapter/panel fixtures and mocked registry sequence enforcement. These do not demonstrate a complete editor or production browser session.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

The complete creator popup/editor flow, physical browser/device behavior, live publishing and parity across distributed desktop/mobile/Apple builds are unverified. The separate audit records the failing popup assertions and their evidence. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
