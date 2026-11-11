# Search intent and authority measurement

Strategic KPI: more useful creator-intent searches landing on the right evergreen pages and producing clicks. Raw impression growth is a diagnostic, not the objective.

## Consistent reporting windows

Use finalized Web Search data for `sc-domain:certifyd.me`. Record the extraction date and exact inclusive dates. Compare equal 30-day periods and retain a rolling 90-day view. Search Console dates use Pacific time. Allow for reporting lag; do not compare incomplete days against complete ones.

Filter main-site pages with `^https?://certifyd\.me/`. Report subdomains separately. Keep search type, country/device filters, aggregation and date windows identical across comparisons. Do not add property-aggregated totals to page-aggregated totals.

## Five cohorts

| Cohort | Definition | Report |
| --- | --- | --- |
| Overall main site | All apex-domain pages, including query-unattributed traffic | Clicks, impressions, CTR, impression-weighted position |
| Blog index | Exact canonical `https://certifyd.me/blog/` | The same metrics, plus its share of main-site impressions |
| Qualified non-branded | Query + page pairs excluding Certifyd/associated entity names; at least 10 impressions and position 1–10 over the fixed 90-day window | Pair count, clicks, impressions, CTR, weighted position, landing-page types |
| Creator intent | Human-reviewed queries seeking a practical creator task or decision | All visible creator-intent pairs AND the stricter qualified subset; report separately |
| Irrelevant/noise | Off-target, ambiguous or unrelated query intent, reviewed explicitly | Impressions and examples; exclude from creator-acquisition priorities |

Also classify editorial/news and useful-adjacent queries so every visible pair has one category. Certifyd's own entities are branded; third-party brands are classified by query intent. Keep a versioned classification sheet, rationale and an ambiguity flag. Do not label operator-heavy queries as bots without evidence.

Google omits anonymized queries from query tables. Report visible-query impressions divided by all main-site impressions and leave the remainder unattributed. Do not assign hidden traffic to a category, infer zero market demand from zero qualifying rows, or label headline searches as product leads.

## Cornerstone pilot tracking

Track `/guides/music-metadata-checklist/` and `/guides/sell-music-directly-to-fans/` individually. Record deployment date after approval, indexation status, supporting links and substantive revisions. Review at 30 and 90 days; do not promise a ranking timetable.

For each pilot report:

- Practical queries and their exact landing pages; creator-intent clicks are the principal search outcome.
- Impressions, clicks, CTR and position for the whole guide, plus visible-query coverage.
- New versus returning query/page pairs, and a fixed cohort of the same pairs across periods.
- Whether the blog index still ranks instead of the purpose-built guide.
- Contextual links placed, crawl/index observations and useful next-action traffic if consented analytics already supports it. GSC cannot measure purchases or unique fans.

## Diagnose declines before changing metadata

Decompose CTR and average position into blog-index versus other-page mix; then inspect unchanged query/page pairs. Segment branded traffic and news exposure. A falling aggregate can result from more low-CTR impressions even if clicks are flat and other pages improve.

Keep the November 1 Stella Lefty/MLC experiment isolated. Do not alter its metadata, article opening or controls while evaluating it. Do not mass-rewrite titles or noindex old articles because of noisy queries.

## Advisory dashboard review

The six criteria total 100 points: topic fit 20, audience problem 20, evidence/usefulness 20, cornerstone/link plan 15, distinct purpose 15, accuracy/sources/next action 10. The existing Brain proposes the planning fields, points and rationales after the draft exists. The same deterministic scorer computes the result. Editors accept, edit or reject the proposal rather than starting with a blank form. Missing supporting fields still earn zero for their criterion.

Decisions remain: 80–100 indexed article recommended; 60–79 revise before indexing; 40–59 consider social/distribution instead; below 40 off-strategy. These are recommendations only. No score or proposal changes founder approval, publication/indexing status, actual internal links or hub membership.

Automatic proposals are stored separately from accepted strategy. Confidence is qualitative and separate for cluster, cornerstone, duplication/cannibalization, indexing, hub promotion and social-only suitability. Every link recommendation includes exact source/destination URLs, an anchor, relevance and direction. See [dashboard behavior](content-dashboard.md#brain-driven-seo-proposals).

The assessment uses the completed draft, stored sources/claims and relevant corpus/guide excerpts. These establish editorial fit, not observed search demand. Search Console evidence is not currently supplied to this stage; the dashboard labels that absence explicitly. Do not count an AI-selected cluster or a high confidence rating as a GSC-validated search opportunity.

Warnings retain stale-instruction and unsupported-claim checks. Body-based retrieval finds related pages, but semantic overlap remains an editorial judgment and actual search cannibalization requires search evidence. Draft-hash changes make old proposals unusable and keep accepted-assessment warnings visible until an editor explicitly reassesses/accepts the current draft. Model failures are labelled low-confidence lexical fallbacks rather than factual assessments. Existing publishing claim checks retain their prior behavior.

Sources: [Google: performance data limitations](https://developers.google.com/search/blog/2022/10/performance-data-deep-dive), [Search Analytics API aggregation and dates](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
