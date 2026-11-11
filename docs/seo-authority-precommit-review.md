# Certifyd SEO authority phase — pre-commit review

Date: November 10, 2026. Status: local implementation for founder review; not committed, pushed, merged or deployed.

## Base and isolation

Repository: BEATiFYAUDIO/certifyd-me-site. Fetched base main: `9e9336500fe93dcebe9dc7e3ce3a005bdd766f07`. Remote main was checked again after implementation and still matches. Branch: `feature/seo-authority-phase-next`. Worktree: `/home/Darryl/Projects/certifyd-me-seo-authority`.

The original checkout and its uncommitted work are untouched. No Core, Fan or Browser application repository, installation or service was modified. The old hub commit `038cff4e9c1bb75f2b08e59740208ace404a37e0` was read as a behavior reference, not merged/cherry-picked. Its curation was reconciled against 112 current published articles.

## Start Here

The two practical guide links precede six featured editorial articles:

- [Music Metadata Checklist for Independent Artists](../content/guides/music-metadata-checklist.md)
- [How to Sell Music Directly to Fans](../content/guides/sell-music-directly-to-fans.md)
- [I Asked 100 Companies for My Data. I Got Deletion Notices Instead](https://certifyd.me/blog/i-asked-100-companies-for-my-data-i-got-deletion-notices-instead/)
- [Universal Has Sold a Chunk of Spotify Stock for Around $467M: Artists Will Likely Be Paid Over $100M](https://certifyd.me/blog/universal-has-sold-a-chunk-of-spotify-stock-for-around-467m-artists-will-likely-be-paid-ov/)
- [Vassal Benford: A Career Built for More Than One Generation](https://certifyd.me/blog/vassal-benford-career-ownership-technology-hip-hop/)
- [Certifyd Architecture: Creator Infrastructure Without the Central Platform](https://certifyd.me/blog/certifyd-architecture-creator-operated-infrastructure/)
- [“Creator-Owned” Is a Lie If Your Account Lives on Someone Else’s Server](https://certifyd.me/blog/creator-owned-lie-account-someone-elses-server/)
- [Digital Music News Shows Why Accurate Metadata Still May Not Get You Paid](https://certifyd.me/blog/digital-music-news-metadata-royalties-mistaken-identity/)

## Current topical mapping

All entries resolve to published sources. Navigation uses real `<a href="/blog/#…">` links and stable section IDs. The complete 112-article newest-first archive follows the hub; curated repetition does not remove items from the archive.

### Creator Ownership & Infrastructure — `creator-ownership`

- [Can It Run Core? Your Computer. Your Network.](https://certifyd.me/blog/can-it-run-core-your-computer-your-network/)
- [Certifyd Architecture: Creator Infrastructure Without the Central Platform](https://certifyd.me/blog/certifyd-architecture-creator-operated-infrastructure/)
- [“Creator-Owned” Is a Lie If Your Account Lives on Someone Else’s Server](https://certifyd.me/blog/creator-owned-lie-account-someone-elses-server/)
- [I Asked 100 Companies for My Data. I Got Deletion Notices Instead](https://certifyd.me/blog/i-asked-100-companies-for-my-data-i-got-deletion-notices-instead/)
- [What If Your Next Creator Platform Was a Computer You Owned?](https://certifyd.me/blog/what-if-your-next-creator-platform-was-a-computer-you-owned/)
- [Vassal Benford: A Career Built for More Than One Generation](https://certifyd.me/blog/vassal-benford-career-ownership-technology-hip-hop/)

### Music Rights, Royalties & Metadata — `music-rights`

- Evergreen guide: `/guides/music-metadata-checklist/`
- [Digital Music News Shows Why Accurate Metadata Still May Not Get You Paid](https://certifyd.me/blog/digital-music-news-metadata-royalties-mistaken-identity/)
- [The MLC’s 2027 Black-Box Distribution Turns Unmatched Royalties Into a Market-Share Question](https://certifyd.me/blog/mlc-2027-black-box-royalty-distribution-market-share/)
- [Musixmatch’s Music Reports Deal Makes Rights Data the New Operating Layer](https://certifyd.me/blog/musixmatch-music-reports-rights-data-operating-layer/)
- [QwantumRights Solutions: What Your Music Data Doesn’t Know Could Be Costing You Money](https://certifyd.me/blog/qwantumrights-music-data-royalties-creator-control/)
- [Spotify Bundling Ruling Shows Product Design Is Now a Royalty Lever](https://certifyd.me/blog/spotify-bundling-ruling-royalty-product-design/)
- [Universal Has Sold a Chunk of Spotify Stock for Around $467M: Artists Will Likely Be Paid Over $100M](https://certifyd.me/blog/universal-has-sold-a-chunk-of-spotify-stock-for-around-467m-artists-will-likely-be-paid-ov/)

### AI, Identity & Provenance — `ai-identity`

- [Jason Isbell Is Suing Suno Over Something Bigger Than Copyright: His Identity](https://certifyd.me/blog/jason-isbell-suno-ai-artist-identity/)
- [Suno Pulls Mary J. Blige Ad After Deal With Unauthorized Representative](https://certifyd.me/blog/suno-pulls-mary-j-blige-ad-unauthorized-representative/)
- [Voice-Swap Joins DDEX as AI Voice Rights Move Into the Music Supply Chain](https://certifyd.me/blog/voice-swap-ddex-ai-voice-rights-metadata/)
- [Sony Music’s 260,000 AI Deepfake Requests Show Why Takedowns Cannot Be the Whole System](https://certifyd.me/blog/sony-music-260000-ai-deepfake-takedown-requests/)
- [Reservoir’s Suno Lawsuit Puts AI Music’s Training Stack in the Rights Debate](https://certifyd.me/blog/reservoir-suno-lawsuit-ai-music-training-rights/)

### Direct Fan Relationships & Commerce — `direct-commerce`

- Evergreen guide: `/guides/sell-music-directly-to-fans/`
- [EVEN’s Josh Remsberg Hire Shows Direct-to-Fan Becoming an Operating Layer](https://certifyd.me/blog/even-josh-remsberg-direct-to-fan-operating-layer/)
- [SoundCloud Paid Downloads Let Artists Keep 100%. The 'One Platform' Pitch Is the Problem.](https://certifyd.me/blog/soundcloud-paid-downloads-artists-keep-100-one-platform-problem/)
- [Fanfare Launches Independent Music Charts Built Around Sales, Not Streams](https://certifyd.me/blog/fanfare-independent-music-charts-sales-not-streams/)
- [Spotify’s Paid Podcast Memberships Put More of the Creator Business Inside Spotify](https://certifyd.me/blog/spotify-paid-podcast-memberships-creator-infrastructure/)
- [Patreon Says the Internet Has Failed Creators. It’s Right. But Is Another Platform the Answer?](https://certifyd.me/blog/patreon-says-internet-failed-creators-is-another-platform-the-answer/)

## Sitemap correction

The main generator already allowed Downloads and Profile, but dashboard publishing staged only the homepage, blog sources/templates and images. During temporary generation the other public files were absent, so sitemap filtering silently omitted them. Core's maintained guide was also absent from the allowlist.

`public-pages.js` now supplies the shared explicit public-page allowlist. Dashboard staging copies those public documents and current cornerstone sources. It hydrates guide sources from the target repository when publishing with repository context, alongside the existing blog hydration. It does not publish private dashboard files or overwrite public static pages as a side effect of an article publish.

The sitemap grows from 114 to 124 URLs: Downloads, Profile, Core guide, Join, Network, Partners, Media Promotion, Services and the two guides. No URLs are removed. Static page checkout mtimes are no longer presented as editorial modification dates; dated article/guide sources retain their dates. The generator still excludes noindex pages.

## Historical installation clarification

The November 5 editorial article retains its URL, title, metadata, publication dates and original Beta 20 context. Its opening notice identifies it as historical, links prominently to `/core/guide/` and Downloads, and provides the actual archive path `/core/guide/archive/v0.1.0-beta.20/`. The pre-install paragraph explicitly directs newer packages to the maintained guide, rather than inviting readers to apply old commands.

The release-authoritative Beta 27 guide and download cards are unchanged. No release-version constant is duplicated in the new evergreen guides.

## Cornerstone drafts

The following Markdown files contain the complete proposed copy. Their rendered counterparts use the existing article layout with guide-specific labels, readable tables and Article/BreadcrumbList/Organization schema. Both guides are indexable, self-canonical, in the sitemap, linked from Start Here and their relevant topic, and reciprocally linked. They are intentionally separate from the chronological news RSS feed.

### `/guides/music-metadata-checklist/`

Full draft: [music-metadata-checklist.md](../content/guides/music-metadata-checklist.md). Rendered page: `guides/music-metadata-checklist/index.html`.

- Start with one authoritative release sheet
- Keep artist identity and credits separate
- ISRC identifies a recording; it is not a release barcode
- Record composition rights separately from the master
- Keep an approved master and a correction log
- Before you release: a five-minute consistency pass

### `/guides/sell-music-directly-to-fans/`

Full draft: [sell-music-directly-to-fans.md](../content/guides/sell-music-directly-to-fans.md). Rendered page: `guides/sell-music-directly-to-fans/index.html`.

- 1. Prepare the work and the offer
- 2. Publish a page somebody else can understand
- 3. Make the published work discoverable
- 4. Set the price and explain checkout
- 5. Confirm payment and access separately
- 6. Keep the customer relationship useful and consensual
- 7. Choose the operating work you can sustain

The metadata guide distinguishes recording identifiers from release identifiers and composition records, and avoids royalty/legal ownership guarantees. Primary references are IFPI, GS1 and The MLC. The sales guide uses the approved published V80 demonstration as evidence of that recorded Beta 27 workflow, qualifies availability/configuration, and separates invoice display, payment, buyer access and creator settlement. It makes no claims of universal receipt recovery, settlement times or payment methods. Neither guide initiates a transaction.

## Full contextual internal-link map

Exactly 12 existing articles receive an individually written body paragraph. Titles, excerpts, SEO titles/descriptions, dates and URLs are unchanged. Each also receives a small related-reading/topic block; there is no bulk/site-wide injection.

| Existing article | New destination | Contextual anchor |
| --- | --- | --- |
| [Digital Music News Shows Why Accurate Metadata Still May Not Get You Paid](https://certifyd.me/blog/digital-music-news-metadata-royalties-mistaken-identity/) | `/guides/music-metadata-checklist/` | music metadata checklist for independent artists |
| [QwantumRights Solutions: What Your Music Data Doesn’t Know Could Be Costing You Money](https://certifyd.me/blog/qwantumrights-music-data-royalties-creator-control/) | `/guides/music-metadata-checklist/` | release metadata checklist |
| [Musixmatch’s Music Reports Deal Makes Rights Data the New Operating Layer](https://certifyd.me/blog/musixmatch-music-reports-rights-data-operating-layer/) | `/guides/music-metadata-checklist/` | independent artist metadata checklist |
| [Voice-Swap Joins DDEX as AI Voice Rights Move Into the Music Supply Chain](https://certifyd.me/blog/voice-swap-ddex-ai-voice-rights-metadata/) | `/guides/music-metadata-checklist/` | checklist for credits, versions and rights context |
| [Notes.fm’s $5M Raise Signals That Royalty Data Is Moving Into the Creator Stack](https://certifyd.me/blog/notes-fm-5m-raise-royalty-data-creator-stack/) | `/guides/music-metadata-checklist/` | music metadata checklist |
| [PRS for Music and Soundtrack Put Playback Data Closer to Royalty Decisions](https://certifyd.me/blog/prs-for-music-soundtrack-playback-data-royalties/) | `/guides/music-metadata-checklist/` | consistent release metadata sheet |
| [SoundCloud Paid Downloads Let Artists Keep 100%. The 'One Platform' Pitch Is the Problem.](https://certifyd.me/blog/soundcloud-paid-downloads-artists-keep-100-one-platform-problem/) | `/guides/sell-music-directly-to-fans/` | direct-to-fan music selling guide |
| [EVEN’s Josh Remsberg Hire Shows Direct-to-Fan Becoming an Operating Layer](https://certifyd.me/blog/even-josh-remsberg-direct-to-fan-operating-layer/) | `/guides/sell-music-directly-to-fans/` | guide to selling music directly to fans |
| [Fanfare Launches Independent Music Charts Built Around Sales, Not Streams](https://certifyd.me/blog/fanfare-independent-music-charts-sales-not-streams/) | `/guides/sell-music-directly-to-fans/` | direct-to-fan selling checklist |
| [Patreon Says the Internet Has Failed Creators. It’s Right. But Is Another Platform the Answer?](https://certifyd.me/blog/patreon-says-internet-failed-creators-is-another-platform-the-answer/) | `/guides/sell-music-directly-to-fans/` | direct-to-fan music selling guide |
| [Spotify’s Paid Podcast Memberships Put More of the Creator Business Inside Spotify](https://certifyd.me/blog/spotify-paid-podcast-memberships-creator-infrastructure/) | `/guides/sell-music-directly-to-fans/` | guide to a complete direct-to-fan sale |
| [Digiday’s Creator Payments Warning: The Transaction Is Becoming the Relationship](https://certifyd.me/blog/digiday-creator-economy-payments-direct-commerce/) | `/guides/sell-music-directly-to-fans/` | steps from direct music checkout to confirmed access |

Both guides link back to selected source articles, each other and the maintained Core guide. The sales guide also links Downloads and Discovery. The metadata guide links the protected MLC article without modifying it. Exact links are in the full drafts above.

## Dashboard advisory behavior

Each article workspace shows a persistent SEO strategy assessment, with editable evidence/planning for article editors and a read-only report for viewers. New drafts show missing information rather than receiving an invented score. Saved assessments record reviewer, timestamp and a draft hash; a later draft change raises a review warning.

| Criterion | Maximum |
| --- | ---: |
| Clear topic-cluster fit | 20 |
| Specific audience/searcher problem | 20 |
| Original evidence, expertise or usefulness | 20 |
| Named cornerstone and internal-link plan | 15 |
| Distinct purpose versus existing content | 15 |
| Accurate claims, sources and next action | 10 |

Editors supply points and a rationale for each criterion. A criterion earns zero without its supporting planning fields and rationale. Scores are clamped to their allowed range. Recommendations: 80–100 indexed article recommended; 60–79 revise before indexing; 40–59 consider social/distribution instead; below 40 off-strategy.

The assessment reports audience, cluster, intent, evidence, cornerstone, internal-link plan, closest existing articles, duplication risk, justification for an indexed page, and claim/source review. Title similarity supplies up to three nearby published articles as a review aid; this is not a semantic duplication detector. Explicit editor flags and claim-ledger/older-version indicators produce prominent warnings for duplication, stale instructions and unsupported claims.

Saving a low or missing score does not change founder approval, publishing permissions, indexing directives, article Markdown or claim checks. The new POST action uses existing edit permission and CSRF checks and writes only advisory strategy/audit data. Existing claim blockers retain their previous behavior.

## Preservation validation

See [machine-readable results](seo-authority-validation.json). All 112 original articles remain. No existing title/meta/canonical changes or structured-data ID changes were found. All 20 protected source/rendered files checked (including Vassal pages, Universal/Spotify, data requests and both CTR experiments) are byte-identical to base main. Homepage metadata and the 112-item feed are unchanged. Core guide/download release files are unchanged.

The build preserves existing article navigation breakpoints/legacy shells and equivalent JSON-LD serialization to avoid incidental template migrations during this content change. New article content still regenerates normally.

## Measurement

[Measurement instructions](seo-cohort-measurement.md) define main-site, blog-index, qualified non-branded, creator-intent and noise cohorts; query-coverage caveats; equal-period comparisons; and 30-/90-day pilot reviews. Search Console itself was not changed.

## Validation results

- `npm test`: 395 passing, 0 failing (blog 14; dashboard/advisory 117; generation 157; trends 85; images 22).
- `python3 -B -m unittest discover -s test -p 'test_core_release_docs.py'`: 7 passing.
- `python3 -B scripts/sync-core-release.py`: Beta 27 documentation valid.
- `npm run seo:validate`: passes for all 112 published articles and the two guides.
- `node --check` on all 13 changed/new JavaScript files: passes.
- `git diff --check`: passes.
- Feed and sitemap parsed successfully as XML: 112 RSS items; 124 sitemap URLs; 10 additions and no removals.
- All curated mappings resolve to published sources; preservation checks are recorded in `seo-authority-validation.json`.
- Desktop hub (1440 px) and mobile guide (412 px) screenshots were inspected. Source UI and navigation remain readable; the guide's wide checklist scrolls within its table rather than overflowing the page. Review captures are local ignored files under `.tmp/seo-review/`.
- The publish-staging regression verifies that public static pages and cornerstone sitemap entries survive the real temporary dashboard build path. Other publisher tests use mocked GitHub operations; no remote publish occurred.

The initial test pass exposed fixture dependency omissions after splitting the generator into modules. Those fixture copies were updated; the full suite was then rerun successfully. The dashboard suite's previous hardcoded path into the Core checkout was replaced by a disposable temporary root, so testing does not touch an existing Core installation.

## Exact files changed

- `blog/digiday-creator-economy-payments-direct-commerce/index.html`
- `blog/digital-music-news-metadata-royalties-mistaken-identity/index.html`
- `blog/even-josh-remsberg-direct-to-fan-operating-layer/index.html`
- `blog/fanfare-independent-music-charts-sales-not-streams/index.html`
- `blog/index.html`
- `blog/install-certifyd-core-local-creator-infrastructure/index.html`
- `blog/musixmatch-music-reports-rights-data-operating-layer/index.html`
- `blog/notes-fm-5m-raise-royalty-data-creator-stack/index.html`
- `blog/patreon-says-internet-failed-creators-is-another-platform-the-answer/index.html`
- `blog/prs-for-music-soundtrack-playback-data-royalties/index.html`
- `blog/qwantumrights-music-data-royalties-creator-control/index.html`
- `blog/soundcloud-paid-downloads-artists-keep-100-one-platform-problem/index.html`
- `blog/spotify-paid-podcast-memberships-creator-infrastructure/index.html`
- `blog/voice-swap-ddex-ai-voice-rights-metadata/index.html`
- `content/blog/digiday-creator-economy-payments-direct-commerce.md`
- `content/blog/digital-music-news-metadata-royalties-mistaken-identity.md`
- `content/blog/even-josh-remsberg-direct-to-fan-operating-layer.md`
- `content/blog/fanfare-independent-music-charts-sales-not-streams.md`
- `content/blog/install-certifyd-core-local-creator-infrastructure.md`
- `content/blog/musixmatch-music-reports-rights-data-operating-layer.md`
- `content/blog/notes-fm-5m-raise-royalty-data-creator-stack.md`
- `content/blog/patreon-says-internet-failed-creators-is-another-platform-the-answer.md`
- `content/blog/prs-for-music-soundtrack-playback-data-royalties.md`
- `content/blog/qwantumrights-music-data-royalties-creator-control.md`
- `content/blog/soundcloud-paid-downloads-artists-keep-100-one-platform-problem.md`
- `content/blog/spotify-paid-podcast-memberships-creator-infrastructure.md`
- `content/blog/voice-swap-ddex-ai-voice-rights-metadata.md`
- `content/guides/music-metadata-checklist.md`
- `content/guides/sell-music-directly-to-fans.md`
- `docs/seo-authority-precommit-review.md`
- `docs/seo-authority-validation.json`
- `docs/seo-cohort-measurement.md`
- `guides/music-metadata-checklist/index.html`
- `guides/sell-music-directly-to-fans/index.html`
- `index.html`
- `package.json`
- `scripts/blog-topics.js`
- `scripts/build-blog.js`
- `scripts/build-guides.js`
- `scripts/content-dashboard/actions.js`
- `scripts/content-dashboard/publisher.js`
- `scripts/content-dashboard/repository.js`
- `scripts/content-dashboard/seo-strategy.js`
- `scripts/content-dashboard/server.js`
- `scripts/public-pages.js`
- `scripts/validate-seo.js`
- `sitemap.xml`
- `templates/blog-article.html`
- `templates/blog-index.html`
- `test/blog-build.test.js`
- `test/content-dashboard.test.js`
- `test/seo-strategy.test.js`

## Diff summary

```text
 .../index.html                                     |  10 +-
 .../index.html                                     |  15 +-
 .../index.html                                     |   9 +-
 .../index.html                                     |  10 +-
 blog/index.html                                    | 505 ++++++++-------------
 .../index.html                                     |   7 +-
 .../index.html                                     |  10 +-
 .../index.html                                     |  10 +-
 .../index.html                                     |  10 +-
 .../index.html                                     |  10 +-
 .../index.html                                     |   9 +-
 .../index.html                                     |   9 +-
 .../index.html                                     |  10 +-
 .../index.html                                     |  10 +-
 ...day-creator-economy-payments-direct-commerce.md |   2 +
 ...ic-news-metadata-royalties-mistaken-identity.md |   2 +
 ...-josh-remsberg-direct-to-fan-operating-layer.md |   2 +
 ...e-independent-music-charts-sales-not-streams.md |   2 +
 ...l-certifyd-core-local-creator-infrastructure.md |   4 +-
 ...ch-music-reports-rights-data-operating-layer.md |   2 +
 ...notes-fm-5m-raise-royalty-data-creator-stack.md |   2 +
 ...iled-creators-is-another-platform-the-answer.md |   2 +
 ...for-music-soundtrack-playback-data-royalties.md |   2 +
 ...mrights-music-data-royalties-creator-control.md |   2 +
 ...nloads-artists-keep-100-one-platform-problem.md |   2 +
 ...d-podcast-memberships-creator-infrastructure.md |   2 +
 .../voice-swap-ddex-ai-voice-rights-metadata.md    |   2 +
 index.html                                         |   1 +
 package.json                                       |   2 +-
 scripts/build-blog.js                              | 136 ++++--
 scripts/content-dashboard/actions.js               |  13 +
 scripts/content-dashboard/publisher.js             |  20 +-
 scripts/content-dashboard/repository.js            |   1 +
 scripts/content-dashboard/server.js                |   8 +-
 scripts/validate-seo.js                            |  37 +-
 sitemap.xml                                        |  43 +-
 templates/blog-article.html                        |   4 +-
 templates/blog-index.html                          |   3 +-
 test/blog-build.test.js                            |  51 +++
 test/content-dashboard.test.js                     |  21 +-
 40 files changed, 598 insertions(+), 404 deletions(-)
```

The tracked diff summary above excludes newly created files listed explicitly above. New files include the two guide sources and rendered pages, curation/public-page modules, guide renderer, advisory assessment, tests and review/measurement documentation.
