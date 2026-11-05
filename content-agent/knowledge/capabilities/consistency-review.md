# Capability Consistency Review

## Current Status

`UNCLEAR`

## Confidence

`LOW`

## Review State

NEEDS_REVIEW — internal audit and quarantined evidence only. This record has no supported public claims and is not an approved technology source.

## Source Scope

The original sections below record the July 2026 first-pass review. Their missing-evidence statements are historical. The dated November 5 technical audit at the end supplies the current verified subset and unresolved conflicts.

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


## Technical Knowledge Enrichment — 2026-11-05

### Task boundary

This is Brain/source documentation enrichment only. The already modified manual technology writer was frozen at task start. No application, writer, prompt, trend, SEO, image, validation, publishing, distribution, dashboard or scheduler code was edited. No model or production API was called and no article was generated. Tests used isolated fixtures and mocked transports; no live payment, key registration, publishing request or service restart was performed.

### Records reviewed and initial sufficiency

All 33 existing Brain Markdown records were inventoried. The Constitution, approved public-claim index and founder-approved Core hierarchy were read first and retained. Core and the identity/publishing/catalog/payment/access/split/network records were mainly July positioning/architecture notes. Fan/access already contained the useful Core-authority/playback boundary but not the newer precise access checks. Release records had valid direct capability wording but lacked the concrete hash and bundle mechanisms. No AR product/capability record existed.

Existing public profile and Fan discovery claims remain `LIVE` in their limited sense. The newly verified implementation subsets are `BETA`, not general availability. Identity, splits, release records and receipt structures now have evidence for a specific beta subset instead of an undifferentiated unknown. Legal identity, copyright ownership, guaranteed payouts, broad provenance authority, full decentralization and planned analytics/partner claims were not promoted.

### Evidence provenance

Repository roots are `/home/Darryl/Projects/<repository>`. Paths and named functions/test cases are listed in each enriched record. These are source snapshots, not claims that the same revision is deployed.

| Repository | HEAD at audit start | Working-tree qualification |
|---|---|---|
| `contentbox` | `6e33e114568f8ceeba9e7637d3c876eed71f5f7e` | Existing local modifications; not treated as a clean released artifact |
| `contentbox-beta27-release` | `e657c4f062e64551fd65a203d04bed8dc0ddb9ef` | Existing local modifications; not treated as a clean released artifact |
| `certifyd-extension` | `390c9e75a791826f738e303c0303b94aae592e0f` | Existing local modifications; not treated as a clean released artifact |
| `certifyd-ar-publish-service` | `16f8c9d561bd360dc42b10bf9e5f3193d56b4692` | Clean checkout at audit start |
| `certifyd-fan-pwa` | `419e0a93bb8b382cf19dd091db457a68b72270d4` | Clean checkout at audit start |

The Core checkout's pre-existing uncommitted AR authorization changes were included when running its tests and are not labelled a released fix. The extension checkout also has uncommitted popup, record, UI, YouTube-test and documentation changes. Pure signing/authorization/transport behavior has passing tests, while the full current popup suite does not. The AR publish-service and Fan checkouts were clean. All product source files remained byte-identical during this task.

The named Beta 27 Core release worktree is an available historical release source, not assumed newer than every current Core change: its HEAD is dated October 26; the current Core HEAD is dated October 30. Compared with the current checkout, `contentPublish.ts`, `splitAuthority.ts`, `publicLifecycle.ts`, `publicPlayback.ts`, `contentAccess.ts`, `purchaseFulfillment.ts`, `finalizePurchase.ts`, `proof.service.ts` and the dashboard creator-key hook are identical. `server.ts` differs. The Beta 27 tree lacks `participationMode.ts`, so mode semantics cannot be assigned to all shipped releases from a guide banner or a directory name.

Guide source: `https://certifyd.me/core/guide/`, with install, proof, works, named, provider, lightning, splits, release and library-first anchors. The previously retrieved November 5 HTML is labelled `v0.1.0-beta.20`; SHA-256 `e0693285954095675eb9e7ebafda4ea33bfb22dda632090fed22b702fe523ba9`. Candidate notes at `/tmp/certifyd-core-guide-brain-notes.txt` were reviewed against that cached HTML and current code. The live HTML and checked-out guide HTML differ. Neither was silently treated as the current product specification, and no network request was needed in this task.

### Beta 20 comparison and conflicts

| Guide description | Current evidence | Knowledge treatment |
|---|---|---|
| Private dashboard on loopback 4000; separate public pages | Core public/private server and boundary source | Retained, with public port 4010/default configuration scope. |
| Explicit Enable sharing; configured connector is not reachability | Public lifecycle and isolated tests | Retained. Startup checks, consent and routing remain distinct. |
| Publish then separately add work to profile | Static Library/work handler inspection | Retained as historical/source-reviewed workflow only; not newly approved as an exercised UI flow. |
| Social-account proof is optional to first free publication | Current social proof and publication paths exist, but mode/server revisions differ | Historical guide/source observation; not a newly approved eligibility claim. |
| Lightning Address alone does not enable priced work | LND readiness, capability/publish gates and provider records | Retained distinction; no real-funds transaction was exercised. |
| Collaborative invitations, active total 100%, locking | Static split schema/lock handler; passing participant and snapshot authority tests | Approve only schema/participant/snapshot facts covered by those checks. Complete invitation/lock flow and Basic solo handler were not exercised. |
| Three onboarding path labels and mode prerequisites | Current checkout and release worktree differ | Conflicting per-build policy remains unresolved, not promoted as universal current behavior. |
| Old download version, 2 MB profile-image limit, fixed example preview length | Not established uniformly for newer releases | Historical documentation only; not added as universal current restrictions. |
| Fan README says discovery/routing only; newer player docs/code implement playback/access clients | Current canonical-offer/access/receipt regressions | New client behavior supported; commerce authority remains with Core. README conflict remains explicit. |
| AR mechanics inferred from the guide | Guide does not describe the signing protocol | Rejected inference. Use actual AR/Core/publish-service source and tests instead. |

### Verified technical foundations and authority boundaries

- Local Core: packaged local SQLite/state, private administration versus allowlisted public routes, explicit sharing and readiness.
- Identity: browser/origin-local Ed25519 creator keys, public-key registration/fingerprint, separate platform-control challenges and AR authorization. The Noble fallback prevents a universal non-exportable creator-key claim.
- Publishing/catalog: schema-defined work, files, credits and external references; passing canonical-manifest/hash and publication-receipt helpers. Dashboard publication and profile-inclusion controls were not exercised.
- Fan: multi-origin public discovery, progressive reconciliation, canonical offer/playback, matching receipt context and Core-bound full-playback trust.
- Purchases/access: paid-intent checkpoint, deterministic allocations, idempotent fulfilment, matching entitlements/receipt state; payout and access completion remain separate.
- Splits: schema-defined versioned participation; passing identity/acceptance/verification filters, locked-version selection, explicit derivative parent authority and purchase-allocation tests. The full invitation/lock route remains unexercised.
- AR: Ed25519 domain-separated canonical records, distinct device and creator keys, live Core authorization, tamper rejection, contextual provider/account/profile bindings and increasing registry sequence.
- Network: configured creator HTTPS origins and provider records are verified mechanisms; automatic peer discovery, replication, consensus and independent governance are not established.

### Missing or unapproved technical claims

No live-funds provider transaction or payout was tested. Tax, custody, refunds, legal identity, copyright ownership and dispute policy remain separate. No universal browser/device recovery or receipt portability claim is added. The Android source tree pins a separate extension commit; its inspected `app/build.gradle` names 0.2.24-browser and is dirty. That is insufficient to identify the latest distributed APK or establish equality with the audited desktop checkout. Safari/iOS and app-store deployment revision were not queried. AR popup/editor coverage is incomplete due to the failures below; cryptographic primitives passing is not a complete UX certification.

### Quarantined failures and unverified observations — not approved knowledge

**EXT-POPUP-2026-11-05:** the existing full extension suite exited with 123 passes and 12 failures. All failures are in `tests/reset-popup.test.js`; the observed error is `app.ui.supportAmountSats is not a function`. The test's UI stub at line 106 only supplies `renderButtonArPanel`, whereas `src/ui.js` defines `supportAmountSats` at line 79 and exports it at line 317. This is evidence of an incomplete test fixture, not proof that the same error occurs in a released browser. The failed tests cannot establish the creator editor, preview, publish-enablement, save-sequence recovery or post-publish refresh behavior. No affected claim was promoted; no application or test fix was made. Raw local evidence: `/tmp/certifyd-brain-extension-tests.log`.

**Source-reviewed, not end-to-end verified:** Core installer/owner onboarding; Works versus Library controls; publication versus profile-inclusion controls; Legacy connection UI; creator browser key creation/recovery UX; the complete collaborative invite/accept/100%-lock route; provider handshake and live payment flow; Fan dock/navigation continuity; AR Save/Preview/Publish controls. These are historical guide or static UI/handler observations, not newly approved functional claims. Schema definitions and narrower passing helpers remain distinguishable from those workflows. Source references remain in the relevant product/capability record for investigation, not permission to claim the complete flow works.

**PROMPT-GATE-2026-11-05:** the read-only grounding call for “How Certifyd Lightning purchases use payment intents and settlement allocations” throws “Cannot generate news article — attach at least one original article URL with a source summary before generation.” The exact prompt fails against both the pre-task and enriched Brain. `looksLikeExternalNewsArticle` in `scripts/content-dashboard/generation-provider.js:1729` treats “settlement” as a news marker. This is an existing writer limitation, not a failed payment test or evidence that Lightning is unavailable. No model request or article generation occurred, and no writer fix was made. The nine positive grounding probes below use the separately listed “participant allocations” topic; that successful probe does not erase this failure.

**No released-artifact confirmation:** five pinned source checkouts were inspected; some are dirty. No installed binary, signed artifact, production deployment, store release or live-funds transaction was verified. Passing tests establish only their fixture/source scope. Existing LIVE profile/discovery statements were retained from their earlier evidence, not re-certified as complete products.

### Deterministic validation results

| Check | Result | Limits |
|---|---|---|
| Existing site generation/image/trend/blog suites | 249 passed, 0 failed | Existing mocked fixtures; no real article/model/publishing call. |
| Selected Core identity, AR authorization, publication, split, playback, participation, Lightning and purchase suites | 81 passed, 0 failed | SQLite purchase tests use a fresh temporary database; no creator database or real funds. |
| Additional Core social-proof and public/private boundary suites | 44 passed, 0 failed | Mocked external responses and isolated local listeners; no existing service exercised. |
| Existing Core proof-bundle verifier script | Passed | Existing fixture and arithmetic checks; no live record exported. |
| Fan access, entitlement, progressive discovery, AR eligibility, API discovery and receipt handoff regressions | 6 regression files passed | Existing offline/mocked assertions, not production browser QA. |
| AR publish-service suite | 15 passed, 0 failed | Mock store/fetch and ephemeral local test servers. |
| Full extension suite | 123 passed, 12 failed (135 total) | Failures are current popup/reset tests missing `app.ui.supportAmountSats` in their UI stub; no product/test fix made. |
| Brain read/grounding checks | 34 Markdown records readable; 9/9 explicit evidence references load the intended approved technical record, with 4+ supported facts and no external source | This checks loading and facts, not generated article quality. |
| Plain-prompt retrieval check | 6/9 intended records selected; baseline 5/9 | Same nine exact topics and audience/objective for current and pre-task Brain. Input documentation changed; selector/writer did not. |

External network requests and requests to existing local application ports were blocked during the deterministic runs. A separate source-protection comparison checks unchanged product code, writer, original articles, non-Brain files and existing unrelated changes. No new test article was requested.

### Evidence scope for newly supported facts

| Records | Successfully verified evidence | Not established by that evidence |
|---|---|---|
| Core, profiles | Public listener/lifecycle, private host guard and route policy tests; default ports and SQLite configuration inspected in source | Installer/owner setup, profile editing, production routing or every deployed configuration |
| Catalog, publishing | Catalog schema inspection; contentPublish canonicalization/hash/receipt and delegated-response tests | Catalog UI, full publish handler, profile inclusion or Legacy import |
| Identity | Witness key registration/recovery, social-proof and AR authorization tests; dashboard storage source inspection | Browser recovery experience, cross-device keys or non-exportability of the Noble fallback |
| Fan, network | Six Fan regression files; Core participation/lifecycle tests | Full browser navigation, live provider handshake, automatic replication or node governance |
| Payments, commerce, access, receipts | LND readiness/credential-role assertions; isolated SQLite paid-intent/fulfilment/allocation tests; receipt/access regressions | Real payment, invoice delivery, provider availability, payout timing or full checkout |
| Splits, release records | Participant/snapshot authority and allocation tests; canonical hash helpers and proof-bundle verifier fixtures | Full collaborator invitation/lock route, legal royalty enforcement or production proof export |
| AR | Passing key, Ed25519 record, live-authorization-with-mocked-Core, adapter, transport, panel and publish-service assertions | Failed creator-popup assertions, physical browsers, store build parity or live publishing |

Static verification approves a statement about the schema or source definition only. Passing tests approve only the behavior and inputs actually asserted. Neither category confirms a released artifact. All 60 pre-existing supported/prohibited claim bullets were retained verbatim; retaining an old approval does not expand it or newly verify its release scope.

### Topics with a substantive evidence foundation

The following subjects have enough source-backed facts for a scoped technical article when the relevant record is supplied. This is not a promise that the default selector will select it.

| Subject / exact topic | Evidence record | Baseline plain selection | Enriched plain selection | Existing explicit reference |
|---|---|---|---|---|
| Core local: How Certifyd Core operates locally | `brain:products/core` | Selected | Selected | Selected, BETA, 6 supported facts |
| Publishing: How Certifyd Core publishes works using canonical manifests | `brain:capabilities/publishing` | Not selected | Selected | Selected, BETA, 6 supported facts |
| Identity: How Certifyd creator identity uses browser-held signing keys | `brain:capabilities/identity` | Not selected | Not selected | Selected, BETA, 6 supported facts |
| Fan: How Certifyd Fan discovers and plays creator work | `brain:capabilities/fan` | Not selected | Not selected | Selected, LIVE, 7 supported facts |
| AR: How Certifyd AR uses cryptographic signatures to augment existing Web2 profiles | `brain:products/ar` | Not selected | Not selected | Selected, BETA, 6 supported facts |
| Purchases: How Certifyd Lightning purchases use payment intents and participant allocations | `brain:capabilities/payments` | Selected | Selected | Selected, BETA, 6 supported facts |
| Access: How Certifyd entitlements control paid access | `brain:capabilities/access` | Selected | Selected | Selected, BETA, 6 supported facts |
| Splits: How Certifyd royalty splits preserve collaborator snapshots | `brain:capabilities/splits` | Selected | Selected | Selected, BETA, 6 supported facts |
| Nodes: How Certifyd nodes expose public origins for network discovery | `brain:capabilities/network-distribution` | Selected | Selected | Selected, BETA, 5 supported facts |

These final probes use audience “Creators”, objective “Explain the specific technology and supported workflow accurately.” and content type “article”. Baseline and final plain prompts use no explicit Brain IDs. The reference check adds only the existing `trendBrainRecordIds` field. This is an internal grounding check, not a new UI or article-generation path. The same final probes select 5/9 intended records before enrichment and 6/9 afterward. Identity, Fan and AR remain absent from the default selected set. No model or deterministic article was generated. Raw local results: `/tmp/certifyd-brain-grounding-checks.json`.

The exact AR example now has an Ed25519/authorization technical foundation. However, the plain manual prompt still does not reliably retrieve its new AR record in this real Brain. Changing the writer or Brain ranking is explicitly outside this task. Do not claim that documentation enrichment alone completed the one-prompt experience, and do not pad a draft from generic Core positioning when its actual source record was omitted. A separate, narrowly authorized retrieval correction is needed for that remaining behavior.

### Exact Brain files changed

- `content-agent/knowledge/capabilities/README.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/access.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/catalog-management.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/commerce.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/consistency-review.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/fan.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/identity.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/network-distribution.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/payments.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/profiles.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/publishing.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/receipts.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/release-records.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/capabilities/splits.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/products/core.md` — existing record enriched or source guidance updated.
- `content-agent/knowledge/products/ar.md` — new; AR had no suitable existing record.

Only `products/ar.md` is new. Existing capability records were expanded rather than duplicated. Their original supported-current-claim and prohibited-claim text is retained; the Core architectural definition is unchanged. Technical mechanisms and workflows sit with their capability facts; private evidence paths, historical classifications, tests and conflicts are kept outside the publishable Supported Current Claims sections.

### Final preservation and diff checks

- All 759 pre-existing site files were compared with task-start SHA-256 values. Only the 15 listed existing Brain files changed; the one new file is `products/ar.md`.
- Five product worktrees retained their task-start file hashes and Git status. Application code, writer/prompts, tests, published articles and unrelated local work are unchanged by this task.
- Existing Core definition and 60 supported/prohibited claim bullets were preserved. All changed records have unique section headings; no new supported fact contains internal test/audit paths or approval metadata.
- Every enriched technical record has separate Verified Mechanism, Current Availability and Unresolved Issues sections. Passing helper/fixture assertions are not promoted to complete workflow claims.
- The audit record is explicitly `UNCLEAR` / `LOW` / `NEEDS_REVIEW` with no supported public claims. The real Brain repository reader confirms its review state; if the generation safety filter excludes it entirely, it likewise cannot become an approved technology source. The final validation checks either exclusion or NEEDS_REVIEW. An initial validation assertion incorrectly required it to remain in the generation scan; that checker assumption was corrected without changing application code.
- `git diff --check` passed. Brain enrichment remains uncommitted; no push, deployment, model call, article generation or existing-service restart occurred.
- Final tracked diff and new-file size are reported separately because Git's normal diff excludes untracked AR documentation.
- Final task diff: 15 files changed, 1333 insertions(+), 390 deletions(-); plus new untracked `content-agent/knowledge/products/ar.md` (106 lines). These are task-local Brain changes; unrelated worktree changes remain as found.
