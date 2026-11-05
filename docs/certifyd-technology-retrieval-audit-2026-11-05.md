# Certifyd technology Brain retrieval — 2026-11-05

## Outcome and scope

All seven requested natural-language prompts now retrieve their intended existing technical records and send them through both existing mocked OpenAI stages. The shorter “How does Certifyd AR augment existing websites?” also works without IDs or special prompt syntax. The seven requests select one to three records each. The explainer budget remains eight records; source-backed industry selection remains three. No context/token setting increased.

This task changes retrieval, intent classification and evidence qualification only. No Brain record, application, article, dashboard UI, image/SEO/validation pipeline, model stage, review/publishing/distribution workflow or daemon was changed. Earlier uncommitted manual-writer and Brain-enrichment work was the task baseline and remains intact.

All verification here is deterministic/offline or uses injected mock model responses. This is not a claim that a live article was generated or that a Core/Fan/AR product workflow was certified end to end.

## Root cause and exact control flow

1. The existing manual form submits to `ContentDashboardActions.generateDraft`, which normalizes topic/audience/objective and passes them to `buildGroundedContext`. The seven requested topics fit the existing intake limits; intake was not the loss point.
2. The Brain walker successfully indexed every expected record in the baseline. Each prompt scanned 33 safe records out of 34 Markdown files. The internal consistency audit remains outside approved positive evidence. No expected record was lost to secret filtering, a missing file or the approval parser.
3. `selectRelevantSources` built a query from the topic plus the deterministic industry editorial brief/thesis. Broad rights/provenance/architecture theme scores overwhelmed specific technical relevance. The first 1,800 characters were the searchable excerpt; complete supported-claim metadata was loaded but not used by that ranking. Generic approved claims and Core architecture were also reserved first for explainers, leaving six slots for the other records. Publishing, Fan, AR and identity were omitted before the eight-record cutoff. The baseline context reported no removed source records during context trimming: the loss occurred at ranking/selection, not token compaction.
4. The existing technology classifier also required a narrow brand-led product/capability phrase. The social-account question and capability-led Bitcoin/Lightning question fell through to industry reasoning. AR was recognized as technology but its missing specific record caused the existing evidence preflight to stop before any mocked model stage.
5. Final technology evidence filtering previously accepted broad matching words inside generic facts. The fix requires approved, current/beta, explicit supported facts and a matching subject record, rather than using Core positioning as a substitute for a missing technology record.

## Exact retrieval change

- Reuse the existing manual technology-intent gate. It now recognizes an explicit brand-led functional question and an explicit capability-led question about Certifyd, without depending on one word order. Subject/capability aliases are a small deterministic vocabulary, not article-title rules or injected document IDs.
- In the existing scorer, explicit technology requests rank against the requested subject, document title/basename and actual supported claims, rather than synthesized industry themes. A directly named Fan/AR record or requested capability outranks secondary Core context. The same sort, deduplication and selection limit apply; unrelated generic documents no longer fill the technology set.
- Only approved records with an eligible current/beta status, non-low confidence and explicit publishable supported/safe wording can supply positive technology facts. Planned, historical, unclear, unapproved and unresolved-only records do not qualify. No excerpt fallback can turn an unresolved section into positive evidence.
- Carry the existing Current Availability and Unresolved Issues sections as silent qualified constraints for technology requests only. They do not become supported claims. The existing writer prompts, voice, validators, schemas and two-stage workflow are byte-identical to the task baseline.
- Keep industry/news classification guards and industry scoring/selection unchanged. Attached source IDs/opportunities always retain the existing source-backed path. A passing unit test is not converted into released-build availability.

## Baseline and final results

The scores below belong to their respective scoring modes and are not comparable as absolute magnitudes across modes. Rank is final selection order. A missing expected record was indexed but omitted from the selected set. Writer lists come from the actual production provider payload/diagnostics, with injected mock responses; the baseline probe stopped after capturing the writing request instead of generating an article.

| Request | Baseline intent | Baseline primary technical record rank | Final primary rank | Final records reaching both writer stages |
|---|---|---|---|---|
| Core | Technology | Not selected | 1 | `capabilities/publishing`, `products/core` |
| Fan | Technology | Not selected | 1 | `capabilities/fan`, `capabilities/network-distribution` |
| AR | Technology; preflight blocked | Not selected | 1 | `products/ar`, `capabilities/identity` |
| Identity | Industry fallback | Not selected | 1 | `capabilities/identity` |
| Lightning | Industry fallback | 3 | 1 | `capabilities/payments`, `capabilities/commerce`, `products/core` |
| Entitlements | Technology | 3 | 1 | `capabilities/access`, `capabilities/payments`, `products/core` |
| Splits | Technology | 4 | 1 | `capabilities/splits`, `products/core` |

### Exact seven prompts, ranked selections and writer evidence

**1. Core**

> How does Certifyd Core let creators publish directly from their own computers?

Baseline selected: 1. `facts/approved-public-claims` (21), 2. `products/core` (20), 3. `capabilities/payments` (30), 4. `capabilities/provenance` (30), 5. `capabilities/access` (29), 6. `capabilities/readme` (29), 7. `capabilities/receipts` (29), 8. `capabilities/awards` (28).

Baseline writer: `facts/approved-public-claims`, `products/core`, `capabilities/payments`, `capabilities/access`, `capabilities/receipts`, `capabilities/awards`

Final selected: 1. `capabilities/publishing` (32), 2. `products/core` (11).

Final writer: `capabilities/publishing`, `products/core`

**2. Fan**

> How does Certifyd Fan discover and play content from creator-operated infrastructure?

Baseline selected: 1. `facts/approved-public-claims` (25), 2. `products/core` (18), 3. `capabilities/access` (28), 4. `capabilities/network-distribution` (28), 5. `capabilities/catalog-management` (27), 6. `capabilities/partner-integrations` (27), 7. `capabilities/provenance` (27), 8. `capabilities/readme` (27).

Baseline writer: `facts/approved-public-claims`, `products/core`, `capabilities/access`, `capabilities/network-distribution`, `capabilities/catalog-management`

Final selected: 1. `capabilities/fan` (33), 2. `capabilities/network-distribution` (14).

Final writer: `capabilities/fan`, `capabilities/network-distribution`

**3. AR**

> How does Certifyd AR augment existing websites with verified creator identity?

Baseline selected: 1. `facts/approved-public-claims` (24), 2. `products/core` (24), 3. `capabilities/payments` (36), 4. `capabilities/splits` (35), 5. `capabilities/network-distribution` (34), 6. `capabilities/provenance` (34), 7. `capabilities/readme` (33), 8. `capabilities/awards` (32).

Baseline writer: None; stopped before writing.

Final selected: 1. `products/ar` (32), 2. `capabilities/identity` (12).

Final writer: `products/ar`, `capabilities/identity`

**4. Identity**

> How does Certifyd verify that a social media account belongs to a creator?

Baseline selected: 1. `facts/approved-public-claims` (18), 2. `products/core` (17), 3. `capabilities/access` (29), 4. `capabilities/payments` (29), 5. `capabilities/receipts` (28), 6. `capabilities/splits` (28), 7. `capabilities/provenance` (27), 8. `capabilities/awards` (26).

Baseline writer: `capabilities/access`

Final selected: 1. `capabilities/identity` (33).

Final writer: `capabilities/identity`

**5. Lightning**

> How do Bitcoin and Lightning purchases work in Certifyd Core?

Baseline selected: 1. `facts/approved-public-claims` (20), 2. `products/core` (18), 3. `capabilities/payments` (32), 4. `capabilities/access` (30), 5. `capabilities/provenance` (30), 6. `capabilities/awards` (29), 7. `capabilities/receipts` (29), 8. `capabilities/network-distribution` (28).

Baseline writer: `capabilities/payments`

Final selected: 1. `capabilities/payments` (34), 2. `capabilities/commerce` (33), 3. `products/core` (12).

Final writer: `capabilities/payments`, `capabilities/commerce`, `products/core`

**6. Entitlements**

> How does Certifyd Core give fans access to content after payment?

Baseline selected: 1. `facts/approved-public-claims` (25), 2. `products/core` (19), 3. `capabilities/access` (33), 4. `capabilities/payments` (30), 5. `capabilities/payouts` (28), 6. `capabilities/catalog-management` (27), 7. `capabilities/network-distribution` (27), 8. `capabilities/readme` (27).

Baseline writer: `facts/approved-public-claims`, `products/core`, `capabilities/access`, `capabilities/payments`, `capabilities/catalog-management`, `capabilities/network-distribution`

Final selected: 1. `capabilities/access` (35), 2. `capabilities/payments` (35), 3. `products/core` (13).

Final writer: `capabilities/access`, `capabilities/payments`, `products/core`

**7. Splits**

> How does Certifyd Core manage collaborators and royalty splits?

Baseline selected: 1. `products/core` (13), 2. `facts/approved-public-claims` (6), 3. `capabilities/access` (20), 4. `capabilities/splits` (20), 5. `capabilities/catalog-management` (19), 6. `capabilities/identity` (19), 7. `capabilities/provenance` (19), 8. `products/ar` (19).

Baseline writer: `products/core`, `facts/approved-public-claims`, `capabilities/access`, `capabilities/splits`, `capabilities/catalog-management`, `capabilities/identity`, `products/ar`

Final selected: 1. `capabilities/splits` (33), 2. `products/core` (11).

Final writer: `capabilities/splits`, `products/core`

## Evidence and claim safety

- All 34 Brain records are byte-identical to the task-start snapshot, including the quarantined 12 AR popup-test failures. Nothing was approved or enriched by this task.
- Positive facts come only from the record's explicit supported/safe wording. The audit, historical/planned/unclear records, low-confidence records and records containing only unresolved observations cannot act as technical evidence.
- AR reaches the writer as BETA. Its released-build uncertainty and incomplete editor/browser verification reach the writer as constraints; no failing popup assertion is supplied as a successful capability.
- Fan's pre-existing LIVE discovery designation remains accompanied by its limited availability and beta mechanism qualifications. It is not promoted into a claim that every player/access workflow is released.
- Relevant availability/unresolved constraints reach both provider stages; internal governance sections and failure evidence do not become positive article facts. Existing validation against governance leakage, unsupported source IDs, invented provenance and publication state remains in place.
- Missing specific AR evidence still stops before any mock model request, even when generic Core text mentions AR. No default/fallback article is generated to fill that evidence gap.

## Regression and validation results

| Check | Result |
|---|---|
| Generation-provider suite, including 14 new retrieval tests | 146 passed, 0 failed |
| Existing content-dashboard suite | 120 passed, 0 failed |
| Existing LinkedIn OAuth dashboard suite | 3 passed, 0 failed |
| Total required test suites | 269 passed, 0 failed |
| Before/after industry-context comparison against the snapshotted production provider | Four signatures exactly match: incidental mention, ambiguous request, source-backed brand-led request, ordinary industry story |
| Industry comparison scope | Identical selected IDs/scores, approved knowledge, external evidence, editorial brief and context limit; external-news guard also unchanged |
| Brain validation | 34 readable records; audit NEEDS_REVIEW; all seven expected technical evidence sets selected within eight records |
| Preservation | 760 pre-existing site files compared; only the provider and its test file changed; all Brain/article/UI/unrelated files retained |
| Protected production functions | 17 writer/prompt/thesis/validator/compaction/reader/persistence functions checked unchanged; record limits remain 8/3/20 |
| Whitespace | `git diff --check` passed |

The new tests use copies of the actual enriched Brain through production `buildGroundedContext` and `OpenAIGenerationProvider`, with injected mock responses. They check both reasoning and writing payloads, approval/status filtering, missing evidence, ambiguous/incidental brand mentions, source-backed override, current versus historical availability, duplicate suppression and an over-eight-subject request within the existing eight-record budget. Successful cases use exactly the existing two mocked stages and no repair request.

Existing general provider tests now request a generic “Core explainer” fixture rather than inadvertently asking for a specific technology article without any approved technical records. The existing Network allowed-ID test receives a copy of the actual approved Network capability record instead of relying on generic positioning. Missing-evidence assertions continue to require a configuration failure and zero model calls.

Test execution blocked external requests and existing local application/model ports. Existing suites may use ephemeral local test listeners and mocked transports; no running application/model service was contacted. No trend scan, live generation, image call, deployment or restart occurred. Tests produced temporary fixtures only.

## Files changed and task-relative diff

Git's ordinary HEAD diff also includes earlier authorized work. These counts compare against the protected snapshot made immediately before this retrieval task.

| File | Added lines | Removed lines |
|---|---:|---:|
| `scripts/content-dashboard/generation-provider.js` | 75 | 11 |
| `test/content-generation-provider.test.js` | 202 | 2 |
| `docs/certifyd-technology-retrieval-audit-2026-11-05.md` | 256 | 0 |

Two additional SoundCloud/ElevenLabs image assets appeared in `images/blog/2026/11/` during the task. They were not produced or modified by the retrieval work and were left untouched; they are excluded from the task-relative diff.

The provider and its tests were already modified at task start; this task adds only the retrieval changes described above. Brain enrichment and other unrelated modifications remain uncommitted and unchanged. No commit, push, deployment, daemon restart, model/API call or product application fix was performed.

## Git status at completion

All changes remain local. The task adds the audit below and modifies only the two existing files listed above; the other entries are unrelated work and were left untouched.

```text
 M .gitignore
 M blog/mlc-2027-black-box-royalty-distribution-market-share/index.html
 M blog/stella-lefty-organic-discovery-release-records/index.html
 M content-agent/knowledge/capabilities/README.md
 M content-agent/knowledge/capabilities/access.md
 M content-agent/knowledge/capabilities/catalog-management.md
 M content-agent/knowledge/capabilities/commerce.md
 M content-agent/knowledge/capabilities/consistency-review.md
 M content-agent/knowledge/capabilities/fan.md
 M content-agent/knowledge/capabilities/identity.md
 M content-agent/knowledge/capabilities/network-distribution.md
 M content-agent/knowledge/capabilities/payments.md
 M content-agent/knowledge/capabilities/profiles.md
 M content-agent/knowledge/capabilities/publishing.md
 M content-agent/knowledge/capabilities/receipts.md
 M content-agent/knowledge/capabilities/release-records.md
 M content-agent/knowledge/capabilities/splits.md
 M content-agent/knowledge/products/core.md
 M content/blog/mlc-2027-black-box-royalty-distribution-market-share.md
 M content/blog/stella-lefty-organic-discovery-release-records.md
 M deploy/admin/env.example
 M docs/content-dashboard.md
 M index.html
 M package.json
 M scripts/content-dashboard/actions.js
 M scripts/content-dashboard/blogger-oauth.js
 M scripts/content-dashboard/distribution-adapters.js
 M scripts/content-dashboard/distribution-package.js
 M scripts/content-dashboard/generation-provider.js
 M scripts/content-dashboard/server.js
 M test/content-dashboard.test.js
 M test/content-generation-provider.test.js
?? ar/privacy/
?? browser/
?? content-agent/dashboard/distribution-connections.json
?? content-agent/dashboard/distribution-defaults.json
?? content-agent/knowledge/products/ar.md
?? content-distribution/
?? docs/certifyd-technology-retrieval-audit-2026-11-05.md
?? images/blog/2026/09/digital-music-news-metadata-royalties-mistaken-identity-r1.png
?? images/blog/2026/09/even-josh-remsberg-direct-to-fan-operating-layer-r1.png
?? images/blog/2026/09/michael-smith-streaming-fraud-real-customer-activity-r1.png
?? images/blog/2026/09/music-ai-2-0-creator-controlled-identity-r1.png
?? images/blog/2026/09/openai-patreon-hires-creator-control-r1.png
?? images/blog/2026/09/robert-palmer-estate-primary-wave-catalog-identity-r1.png
?? images/blog/2026/09/submithub-ai-music-ban-streaming-rules-discovery-r1.png
?? images/blog/2026/09/voice-swap-ddex-ai-voice-rights-metadata-r1.png
?? images/blog/2026/10/chris-brown-producer-sony-lawsuit-royalty-routing-r1.png
?? images/blog/2026/10/digiday-creator-economy-payments-direct-commerce-r1-logo.svg
?? images/blog/2026/10/digiday-creator-economy-payments-direct-commerce-r1.png
?? images/blog/2026/10/elvis-presley-anthropic-copyright-lawsuit-ai-permissions-r1-logo.svg
?? images/blog/2026/10/elvis-presley-anthropic-copyright-lawsuit-ai-permissions-r1.png
?? images/blog/2026/10/elvis-presley-anthropic-copyright-lawsuit-ai-permissions-r2-logo.svg
?? images/blog/2026/10/elvis-presley-anthropic-copyright-lawsuit-ai-permissions-r2.png
?? images/blog/2026/10/india-independent-artists-infrastructure-royalty-transparency-r1.png
?? images/blog/2026/10/meta-scraping-terms-creator-control-certifyd-ar-r2.png
?? images/blog/2026/10/meta-scraping-terms-publisher-account-access-r1.png
?? images/blog/2026/10/mlc-2027-black-box-royalty-distribution-market-share-r1.png
?? images/blog/2026/10/musixmatch-music-reports-rights-data-operating-layer-r1.png
?? images/blog/2026/10/prs-for-music-soundtrack-playback-data-royalties-r1-logo.svg
?? images/blog/2026/10/prs-for-music-soundtrack-playback-data-royalties-r1.png
?? images/blog/2026/10/qwantumrights-music-data-royalties-creator-control-r1.png
?? images/blog/2026/10/reservoir-suno-lawsuit-ai-music-training-rights-r1.png
?? images/blog/2026/10/sony-music-260000-ai-deepfake-takedown-requests-r1.png
?? images/blog/2026/10/sportspro-athlete-voices-fan-relationships-r1.png
?? images/blog/2026/10/spotify-amazon-music-mffa-michael-smith-streaming-fraud-sentencing-r1.png
?? images/blog/2026/10/spotify-audiobook-bundle-music-royalties-certifyd-r1.png
?? images/blog/2026/10/spotify-paid-podcast-memberships-creator-infrastructure-r1.png
?? images/blog/2026/10/suno-apple-music-subpoena-catalog-power-ai-litigation-r1-logo.svg
?? images/blog/2026/10/suno-apple-music-subpoena-catalog-power-ai-litigation-r1.png
?? images/blog/2026/10/suno-live-experiences-ai-music-live-economy-r1-logo.svg
?? images/blog/2026/10/suno-live-experiences-ai-music-live-economy-r1.png
?? images/blog/2026/10/suno-live-experiences-ai-music-live-economy-r2.png
?? images/blog/2026/10/utopai-ai-film-studio-rights-permissions-r1-logo.svg
?? images/blog/2026/10/utopai-ai-film-studio-rights-permissions-r1.png
?? images/blog/2026/10/warner-music-ray-ban-luxottica-social-media-music-lawsuit-r1.png
?? images/blog/2026/11/
?? policies/
?? scripts/content-dashboard/linkedin-oauth.js
?? test/linkedin-oauth.test.js
```
