# Brain-driven SEO assessment — pre-commit review

Date: November 10, 2026. Status: implemented locally; not committed, pushed, merged or deployed.

Branch: `feature/brain-seo-assessment` in `/home/Darryl/Projects/certifyd-me-brain-seo`. Base production main: `b2b350b1fc9fe5e3a79de38f237816ece0b130dd`.

## Implementation and existing Brain reuse

The implementation reuses `createGenerationProvider()`, the existing configured OpenAI model/client, `createStructuredResponse()`, generation-slot controls, timeouts and request diagnostics. It adds one post-draft `seo-strategy-assessment` operation, not a second AI service or model configuration. Existing article generation, editorial reasoning and claim-validation behavior are unchanged.

Generated drafts, pasted drafts and changed saved Markdown request an automatic proposal. The server schedules this work through the existing background-job mechanism. The draft remains saved if analysis fails. GET article views only read saved proposals and accepted strategy; they do not issue model requests. Existing pre-deployment drafts can use Reassess without a bulk startup run.

The complete published article/guide corpus is scanned locally for body-based retrieval. The model receives relevant excerpts, the actual guides, topic definitions, draft/intake, stored research and claim context. Context is bounded by the existing provider budget; truncation is disclosed and reduces confidence where a complete draft matters. No new web crawler, search provider or GSC query is added.

## Proposal JSON schemas

- [Model response schema](schemas/seo-strategy-proposal-response.schema.json): strict structured-output schema used by the existing provider.
- [Stored proposal schema](schemas/seo-strategy-proposal.schema.json): server-normalized pending proposal and provenance envelope.

The model response has three top-level fields:

```json
{
  "plan": {
    "cluster": "one of the four current IDs, or empty",
    "audience": "...",
    "intent": "...",
    "evidence": "...",
    "cornerstone": "...",
    "internalLinks": "...",
    "closestArticles": "...",
    "duplicationRisk": "...",
    "indexReason": "...",
    "accuracyNotes": "...",
    "scores": {"topicFit": 20, "audienceProblem": 20, "usefulness": 20, "linkPlan": 15, "distinctPurpose": 15, "accuracy": 10},
    "notes": {"topicFit": "...", "audienceProblem": "...", "usefulness": "...", "linkPlan": "...", "distinctPurpose": "...", "accuracy": "..."},
    "substantialDuplication": false,
    "staleInstructions": false,
    "unsupportedClaims": false
  },
  "recommendations": {
    "cluster": {"clusterId": "music-rights", "confidence": "high", "reason": "...", "evidenceRefs": ["draft"]},
    "cornerstone": {"url": "exact published guide URL or empty", "confidence": "high", "reason": "...", "evidenceRefs": []},
    "duplication": {"risk": "low/medium/high/unknown", "closestUrls": [], "confidence": "medium", "reason": "...", "evidenceRefs": []},
    "indexing": {"confidence": "low", "reason": "...", "evidenceRefs": []},
    "hubPromotion": {"consider": false, "confidence": "medium", "reason": "...", "evidenceRefs": []},
    "socialOnly": {"consider": false, "confidence": "low", "reason": "...", "evidenceRefs": []}
  },
  "recommendedLinks": [{
    "sourceUrl": "https://certifyd.me/blog/example-draft/",
    "destinationUrl": "https://certifyd.me/guides/music-metadata-checklist/",
    "anchorText": "music metadata checklist",
    "reason": "A practical next step for the reader",
    "linkType": "article → cornerstone"
  }]
}
```

The scores shown above are maximum values, not defaults. The actual schema restricts each score to its rubric maximum and confidence to `high`, `medium`, `low` or `unknown`. All model-response object fields are required; unknown fields and invented evidence/destinations are rejected. A missing relevant cornerstone is allowed. The server derives the free-text cornerstone/link/closest-page summary from validated structured URLs so fabricated destinations cannot hide in those free-text fields.

The stored record adds proposal ID, generation time, provider/model, mode, full draft hash, corpus coverage, warnings/limitations, `advisoryOnly`, and the score/decision calculated by the existing deterministic scorer. It contains no credentials. The unchanged thresholds are 80/60/40; the model cannot supply an overriding decision or claim a measured GSC result.

## Actual generated example

[Full actual model assessment](examples/brain-seo-assessment.json).

This was generated with the existing locally configured `gpt-5.6-terra` provider against an isolated sample draft about release sheets. The model scanned the real 112 published articles and two guides through retrieval. No production draft was created or modified, and no recommendation was applied. The example's all-zero-style UUID is a documentation placeholder, not a production run ID.

Result: **70/100 — Revise before indexing**. Recommended cluster: **Music Rights, Royalties & Metadata**. Supports `/guides/music-metadata-checklist/`.

| Recommendation area | Confidence | Result |
| --- | --- | --- |
| Topic cluster | high | music-rights |
| Cornerstone | high | https://certifyd.me/guides/music-metadata-checklist/ |
| Duplication/cannibalization | high | high |
| Indexing recommendation | low | Revise before indexing |
| Hub promotion | medium | Not specifically recommended |
| Social/distribution only | low | Not specifically recommended |

The Brain found strong semantic overlap with the existing metadata cornerstone and did not recommend hub promotion. It explicitly distinguished semantic overlap from proven search cannibalization. Unresolved claim review lowered indexing confidence. Confidence ratings are qualitative editorial estimates, not measured probabilities or search evidence.

| Type | Source | Exact destination | Proposed anchor | Relevance |
| --- | --- | --- | --- | --- |
| article → cornerstone | `https://certifyd.me/blog/example-release-sheet-for-musicians/` | `https://certifyd.me/guides/music-metadata-checklist/` | Music Metadata Checklist for Independent Artists | The supplied cornerstone is the more complete operational checklist for the exact release-sheet, credits, identifier, rights-record and correction-log workflow introduced in this draft. |
| article → article | `https://certifyd.me/blog/example-release-sheet-for-musicians/` | `https://certifyd.me/blog/digital-music-news-metadata-royalties-mistaken-identity/` | consistent metadata does not guarantee royalties | This supplied article provides supporting context for the draft's caution that accurate fields alone may not resolve identity or payment problems. |
| article → article | `https://certifyd.me/blog/example-release-sheet-for-musicians/` | `https://certifyd.me/blog/qwantumrights-music-data-royalties-creator-control/` | Keep recording-owner and composition-administrator records separately | This related article can provide broader context on maintaining rights and repertoire records as an ongoing creator-control practice. |

## Human controls and staleness

| Control | Behavior |
| --- | --- |
| Accept | Requires edit permission, CSRF, the current proposal identity, an unreviewed proposal and matching draft hash. Explicitly copies the proposal to accepted strategy. |
| Edit | Opens the existing strategy editor prefilled with the proposal. Saving records a human-edited assessment. It does not retain model confidence claims as if they describe changed human recommendations. |
| Reject | Records rejection only. It does not reject the article, clear accepted strategy, alter indexing or affect founder approval. |
| Reassess | Starts a new pending proposal using the current draft/corpus. Accepted strategy remains byte-identical until an explicit human action changes it. |

Per-area confidence is visible beside each summary recommendation; detailed reasoning and supplied evidence references are available in an expandable section. The initial view shows proposed cluster, cornerstone, deterministic decision, hub/social recommendations and actionable links. A low-confidence lexical fallback is explicitly labelled; missing/invalid model output is never presented as a successful semantic assessment.

A draft change keeps the existing accepted-assessment hash warning and requests a fresh proposal. Old proposals cannot be accepted/edited against the new hash. Accepted-assessment hash warnings remain visible outside the collapsed editor. Duplicate same-hash requests are deduplicated while running. A superseded model completion cannot overwrite the newer proposal; tested both for a changed draft and for two overlapping requests. Proposal review is serialized per run, and reviewed proposal IDs cannot be replayed to overwrite later human decisions.

`seo/proposal.json`, its status/review records and model diagnostics are separate from `seo/strategy.json`. Automatic generation never writes `seo/strategy.json`. The latter changes only through Accept or the existing explicit editor save action. New pending proposals never silently replace accepted strategy.

## Safeguards verified

- Founder approval, publishing permissions, existing claim blockers, publication manifests and founder-review records retain their prior behavior. Existing protected-flow tests pass.
- No automatic robots/noindex decisions, internal-link insertion, hub membership changes or edits to `scripts/blog-topics.js`.
- All published articles, guide content/rendered pages, sitemap, feed, assets, branding, homepage, release documentation, permission configuration and publishing adapter remain byte-identical to base main.
- Every assessment explicitly says editorial inference and that Search Console evidence was not supplied. There is no invented search-demand dataset or automatic GSC access.
- Exact URL membership/type validation rejects nonexistent guides, unrelated destinations, wrong link directions and fabricated evidence references.
- Model transport uses the existing strict structured-response support. [Official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs) informed the response schema; server-side corpus/evidence validation is still required.
- No production service was restarted and no production run was written. The isolated live model example used existing configuration in memory; no credentials were copied into this worktree or documentation.

## Validation results

- Full `npm test`: **405 passed, 0 failed** (blog 14; dashboard/advisory 126; generation 158; trends 85; images 22).
- Release-documentation Python suite: **7 passed, 0 failed**.
- `scripts/sync-core-release.py`: production Beta 27 documentation valid.
- `npm run seo:validate`: passes for the unchanged 112 articles and two guides.
- `node --check`: all 8 changed JavaScript files pass.
- Both Draft 2020-12 JSON Schemas are valid. The actual model example validates against the stored schema, and its model-response portion validates against the response schema.
- Feed and sitemap parse as XML and remain byte-identical to base: 112 RSS articles; 124 sitemap URLs.
- `git diff --check` and trailing-whitespace inspection of all changed/new files pass, including untracked artifacts.
- Actual configured-model call succeeded. Provider transport/unit tests also use injected clients to verify schema, current model configuration, timeout, shared concurrency slot, stage metadata and source/GSC boundaries without additional live requests.
- Dashboard integration tests cover automatic background assessment, no generation on article GET, CSRF, role restrictions, Accept/Reject/Reassess and unchanged founder-review state. Proposal tests cover editing, all link directions (including incoming article links), nonexistent guides, invalid URLs, fabricated evidence, missing confidence, stale hashes, replayed review actions, same-hash deduplication and superseded completions.
- Desktop preview inspected using the real generated example: per-area confidence, compact links and review controls are visible without opening the full editorial form. The screenshot is a local ignored review artifact at `.tmp/brain-seo-review/dashboard-desktop.png`.

The initial test run exposed an incorrect test fixture for viewer CSRF (read-only pages intentionally have no writable form). The fixture now supplies a valid viewer-session token to verify permission denial independently of CSRF. The complete suite was rerun successfully afterward.

Limits: semantic model assessment is implemented through the existing configured OpenAI provider. Legacy/deterministic draft providers can use that configured analysis path; when semantic analysis is unavailable, the system produces a labelled low-confidence fallback. Retrieval uses selected excerpts after scanning the complete corpus, not an exhaustive semantic audit or measured search-demand study. Existing drafts are reassessed on demand, and an interrupted background job can be recovered with Reassess.

## Exact files changed

- `docs/brain-seo-precommit-review.md`
- `docs/content-dashboard.md`
- `docs/examples/brain-seo-assessment.json`
- `docs/schemas/seo-strategy-proposal-response.schema.json`
- `docs/schemas/seo-strategy-proposal.schema.json`
- `docs/seo-cohort-measurement.md`
- `scripts/content-dashboard/actions.js`
- `scripts/content-dashboard/generation-provider.js`
- `scripts/content-dashboard/repository.js`
- `scripts/content-dashboard/seo-strategy.js`
- `scripts/content-dashboard/server.js`
- `test/content-dashboard.test.js`
- `test/content-generation-provider.test.js`
- `test/seo-strategy.test.js`

## Diff summary

```text
 docs/content-dashboard.md                        |  30 +++
 docs/seo-cohort-measurement.md                   |  10 +-
 scripts/content-dashboard/actions.js             | 116 +++++++++++-
 scripts/content-dashboard/generation-provider.js |  18 ++
 scripts/content-dashboard/repository.js          |   3 +
 scripts/content-dashboard/seo-strategy.js        | 227 +++++++++++++++++++++--
 scripts/content-dashboard/server.js              |  20 +-
 test/content-dashboard.test.js                   |  48 ++++-
 test/content-generation-provider.test.js         |  28 +++
 test/seo-strategy.test.js                        | 168 ++++++++++++++++-
 10 files changed, 633 insertions(+), 35 deletions(-)
```

The tracked diff excludes the new review report, two JSON Schema documents and actual generated example. Those four artifacts are included in the exact file list. Local preview screenshots/scripts are ignored under `.tmp/brain-seo-review/`.
