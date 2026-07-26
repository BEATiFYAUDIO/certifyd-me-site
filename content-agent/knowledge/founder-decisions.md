# Founder Decisions

## Evidence Base

This file uses only the existing extracted knowledge files and investor-site knowledge files:

- `content-agent/knowledge/ecosystem.md`
- `content-agent/knowledge/products/core.md`
- `content-agent/knowledge/investors/investment-thesis.md`
- `content-agent/knowledge/investors/business-model.md`
- `content-agent/knowledge/investors/transaction.md`
- `content-agent/knowledge/investors/revenue-model.md`
- `content-agent/knowledge/investors/investor-claims-review.md`
- `knowledge/brand.md`
- `knowledge/mission.md`
- `knowledge/vision.md`
- `knowledge/philosophy.md`
- `knowledge/vocabulary.md`
- `knowledge/faq.md`
- `content-agent/knowledge/facts/approved-public-claims.md`

This document records founder decisions that have been approved and decisions that remain pending. The first approved product-architecture decision is the definition and hierarchy role of Certifyd Core.

## Priority Decision List

| Priority | Decision | Reason |
|---|---|---|
| Approved | Decision 2: What is Certifyd Core? | Approved as the foundational engine at the centre of the ecosystem. Capability status remains separate. |
| Critical | Decision 3: What capabilities are live in Core? | Public content cannot safely describe capabilities until live/beta/planned boundaries are approved. |
| Critical | Decision 4: What is the relationship between Core and Network? | The ecosystem architecture depends on whether Network distributes, connects, or depends on Core. |
| Critical | Decision 9: What does creator-owned infrastructure mean? | Ownership language carries legal, technical, and trust implications. |
| Critical | Decision 12: What revenue streams are live? | Investor copy lists revenue streams, but current revenue versus projected model is unresolved. |
| Critical | Decision 13: What is the transaction? | The $20M structure and $3M Core Technology & IP claim require legal/ownership clarity. |
| High | Decision 1: What is Certifyd? | Brand, company, ecosystem, and product-family language must be consistent. |
| High | Decision 5: What is Certifyd Fan? | Fan is a visible public surface and needs clear current/future boundaries. |
| High | Decision 6: What is Certifyd Awards? | Awards is live publicly, but proof/scoring/network claims need separation. |
| Approved | Decision 7: What are creator profiles? | Approved as Core-powered public creator-facing surfaces, not a separate top-level product. |
| High | Decision 10: What does “own your audience” mean? | Strong public phrase with privacy, consent, and legal risk. |
| High | Decision 11: What does provenance mean in Certifyd? | Provenance/proof language must distinguish evidence from legal proof. |
| High | Decision 14: What claims can the content agent publish? | Needed before automated public content generation. |
| Approved | Decision 8: Should “Certifyd Creator” be retired? | Treat as legacy or inconsistent terminology unless restored by a later founder decision. |

## Decision 1: What is Certifyd?

### The Question

Should `Certifyd` officially mean the company, the public brand, the ecosystem, the complete product family, or some approved combination? How should the corporate entity be distinguished from the public brand?

### Why The Decision Matters

Public writing needs to distinguish company, brand, ecosystem, products, and infrastructure. Without this, content may claim the company, network, Core, Fan, and Awards all perform the same functions.

### What The Current Sources Say

- `knowledge/brand.md` presents Certifyd as the public brand and links to Fan, public profiles, Awards, nominations, and Network join paths.
- `content-agent/knowledge/facts/approved-public-claims.md` defines Certifyd as the overall brand and ecosystem for creator publishing, discovery, ownership, direct commerce, profiles, network participation, and recognition surfaces, with limits.
- `content-agent/knowledge/ecosystem.md` says the investor site presents Certifyd as the umbrella brand connecting Core, Network, Fan, Awards, profiles, and direct commerce positioning.

### Contradictions Between Sources

- The public site alternates between `Certifyd`, `Certifyd Creator`, `Certifyd Network`, and `The Independent Creator Network`.
- Investor material uses Certifyd as the ecosystem/company/product family, while approved public claims are more cautious.

### Available Options

1. Certifyd = company only.
2. Certifyd = public brand only.
3. Certifyd = ecosystem and product family.
4. Certifyd = company, brand, and ecosystem, with corporate entity named separately where needed.

### Risks Of Each Option

- Company only: too narrow for public product writing.
- Brand only: weak for investor and architecture explanation.
- Ecosystem/product family only: may blur legal entity and product boundaries.
- Combined definition: usable, but requires careful style rules.

### Codex’s Evidence-Based Recommendation

Use Certifyd as the public brand and ecosystem/product family. Distinguish the corporate/legal entity only when discussing investment, ownership, contracts, or governance.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 2: What is Certifyd Core?

### The Question

What is the approved architectural definition of Certifyd Core, and how should it sit inside the Certifyd ecosystem?

### Why The Decision Matters

Core is the centre of the product architecture. Public, investor, and content-agent writing needs a stable definition before it can explain the ecosystem without treating Fan, Awards, profiles, Network, and commerce as unrelated products.

### Approved Founder Decision

`APPROVED`

Certifyd Core is the engine at the centre of the Certifyd ecosystem. Core is not merely software for running creator or operator nodes.

### Final Approved Wording

> Certifyd Core is the foundational engine that powers identity, publishing, provenance, creator profiles, release records, access, and direct commerce across the Certifyd ecosystem.

### Approved Structural Implications

- `Certifyd` is the overall brand and connected ecosystem.
- `Certifyd Core` is the foundational engine at the centre of the ecosystem.
- `Creator Profiles` are public creator-facing surfaces powered by Core, not a separate top-level product.
- `Certifyd Fan` is a fan-facing product surface powered by or connected to Core.
- `Certifyd Awards` is a recognition product surface powered by or connected to the broader Certifyd ecosystem.
- `Certifyd Network` is the distributed infrastructure layer through which creators, partners, and operators can run, extend, host, distribute, or connect Certifyd capabilities.
- `Certifyd Creator` is legacy or inconsistent terminology unless a later founder decision restores it as a product name.

### Capability Status Rule

The approved Core definition is architectural. It does not automatically make every listed capability live. Individual capabilities must still be classified separately as `LIVE`, `BETA`, `PLANNED`, `FUNDING-DEPENDENT`, `TRANSACTION-DEPENDENT`, or `UNCLEAR`.

### Remaining Open Questions

- Which Core capabilities are live today versus beta, planned, funding-dependent, or transaction-dependent.
- The exact technical relationship between Core, nodes, and Certifyd Network.
- Which provenance, receipt, release-record, commerce, payout, and access claims can be safely published as current capabilities.

## Decision 3: What Capabilities Are Live In Core?

### The Question

Which Core capabilities are `LIVE`, `BETA`, `PLANNED`, `FUNDING-DEPENDENT`, `TRANSACTION-DEPENDENT`, or `UNCLEAR`?

### Why The Decision Matters

Capability status determines what the content agent can publish directly versus what must be qualified.

### What The Current Sources Say

- `content-agent/knowledge/products/core.md` classifies most Core capabilities as `UNCLEAR` until founder approval.
- Existing public knowledge supports profiles, publishing/direct-commerce concepts, Join Network, Register Node, Fan, and Awards, but not all as Core capabilities.

### Capability Matrix

| Capability | Classification | Source Support | Notes |
|---|---|---|---|
| identity | `UNCLEAR` | `content-agent/knowledge/ecosystem.md`; `knowledge/vocabulary.md` | Identity appears in ecosystem/profile language; Core boundary unresolved. |
| creator profiles | `LIVE` as public surface / `UNCLEAR` as Core | `knowledge/brand.md`; `knowledge/vision.md`; `content-agent/knowledge/products/core.md` | Public profile exists; architecture pending. |
| publishing | `BETA` / `UNCLEAR` | `knowledge/mission.md`; `knowledge/faq.md`; `content-agent/knowledge/products/core.md` | Public copy references publishing; exact live scope needs confirmation. |
| provenance | `UNCLEAR` | `knowledge/vocabulary.md`; `approved-public-claims.md` | Term not defined. |
| work or release records | `UNCLEAR` | `knowledge/faq.md`; `approved-public-claims.md` | Records are implied; durability/status unclear. |
| receipts | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Receipt definition approved with limits; Core status unclear. |
| splits | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Concept described; live/Core scope unclear. |
| access control | `BETA` / `UNCLEAR` | `knowledge/faq.md`; `content-agent/knowledge/products/core.md` | Unlock/access appears in product context; public claim needs verification. |
| direct commerce | `BETA` / `UNCLEAR` | `knowledge/mission.md`; `knowledge/faq.md`; `content-agent/knowledge/investors/business-model.md` | Direct commerce model supported; exact live scope unresolved. |
| payments | `BETA` / `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Bitcoin Lightning supported where available; Core status unclear. |
| payouts | `UNCLEAR` | `knowledge/vocabulary.md`; `knowledge/faq.md`; `approved-public-claims.md` | Defined with limits; live status unclear. |
| catalog management | `UNCLEAR` | `knowledge/mission.md`; `approved-public-claims.md` | Catalog performance claims need documentation. |
| analytics | `PLANNED` / `FUNDING-DEPENDENT` | `content-agent/knowledge/investors/transaction.md` | AI/data/reporting funded in investment plan. |
| royalty management | `UNCLEAR` | `knowledge/mission.md`; `approved-public-claims.md` | Risky claim until defined. |
| network distribution | `BETA` / `UNCLEAR` | `content-agent/knowledge/ecosystem.md`; `knowledge/vocabulary.md` | Network exists as concept; operational details pending. |
| partner integrations | `PLANNED` / `FUNDING-DEPENDENT` | `content-agent/knowledge/investors/transaction.md`; `business-model.md` | Services/integrations are in model/funding plan. |

### Contradictions Between Sources

- Public copy describes several capabilities broadly, but approved claims mark many as ambiguous or risky.
- Investor copy funds analytics, AI, enterprise, and integrations, implying they are not fully built/scaled.

### Available Options

1. Publish only profile/Fan/Awards surface facts as live.
2. Treat Core as beta with selected verified live capabilities.
3. Treat all listed Core capabilities as live.

### Risks Of Each Option

- Option 1 is safe but undersells product reality.
- Option 2 is likely accurate but requires founder confirmation.
- Option 3 is unsafe without technical/product evidence.

### Codex’s Evidence-Based Recommendation

Use capability-specific language: Core has an approved architectural role, but each capability still needs its own live, beta, planned, funding-dependent, transaction-dependent, or unclear classification.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 4: What Is The Relationship Between Core And Network?

### The Question

Does Core run on the Network, does the Network distribute Core services, does Core provide services to Network nodes, do nodes run independent Core instances, is Network a separate infrastructure layer, or is the relationship a combination?

### Why The Decision Matters

The architecture controls how public content explains nodes, distribution, discovery, routing, identity, and commerce.

### What The Current Sources Say

- Investor ecosystem files present Core as the foundation and Network as the layer connecting creator/operator nodes.
- Older investor/source material described Core narrowly as software for running a creator node; the approved definition is broader.
- Recent investor source extraction says Network connects nodes so content, identity and commerce can move across the open web.
- Existing approved claims warn that Core-Network relationship needs founder decision.

### Contradictions Between Sources

- Investor copy sometimes associates Network with identity and commerce, while the latest founder direction in conversation says identity and commerce sit with Core and Network is discovery, routing, and distribution.
- Public-site knowledge does not define the Core-Network boundary.

### Available Options

1. Core runs independent creator/operator nodes; Network provides discovery, routing, and distribution.
2. Network distributes Core services across nodes.
3. Core provides services to Network nodes.
4. Core and Network are separate layers with shared public products above them.
5. Some combination of the above.

### Risks Of Each Option

- Option 1 is clear and matches the latest founder correction, but needs technical confirmation.
- Option 2 can imply centralized or distributed service architecture without proof.
- Option 3 can blur infrastructure boundaries.
- Option 4 is understandable but may be too abstract.
- Option 5 is accurate only if documented precisely.

### Codex’s Evidence-Based Recommendation

Define Core as the local creator/operator software layer and Network as discovery, routing, and distribution connecting Core-powered nodes. Confirm technically before publishing.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 5: What Is Certifyd Fan?

### The Question

Is Fan an application powered by Core, a discovery/playback surface, a commerce surface, a separate product, a reference client for the Network, or some combination?

### Why The Decision Matters

Fan is a visible product surface and will appear in public content, investor material, and product explanations.

### What The Current Sources Say

- `knowledge/vocabulary.md` says Certifyd Fan is linked as `Discover` and chatbot copy says fans can browse, discover, unlock premium releases, and support creators.
- `approved-public-claims.md` says Fan is fan-facing discovery linked from the public website, but specific features should be verified.
- Investor files call Fan a public product surface and describe discovery, playback, and support.

### Contradictions Between Sources

- Fan is safely proven as a linked public surface, but exact commerce/support/unlock scope is not approved in the knowledge base.

### Available Options

1. Fan = discovery and playback application.
2. Fan = discovery, playback, and commerce/support application.
3. Fan = reference client for the Network.
4. Fan = separate standalone product.
5. Combination with current/future separation.

### Risks Of Each Option

- Narrow definition may undersell current product.
- Broad definition risks claiming unverified commerce features.
- Reference-client wording may be too technical for public writing.
- Standalone wording weakens the ecosystem story.

### Codex’s Evidence-Based Recommendation

Define Fan as the fan-facing discovery and playback application, with commerce/support described only where verified and qualified.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 6: What Is Certifyd Awards?

### The Question

Is Awards an independent program, public application powered by Core, recognition layer using Certifyd proof/activity, future Network application, or some combination?

### Why The Decision Matters

Awards is public and brand-visible, but proof, scoring, voting, rewards, and Network integrations can become risky if described as live prematurely.

### What The Current Sources Say

- `knowledge/brand.md` and `knowledge/vocabulary.md` support Awards as public awards/recognition surface.
- `approved-public-claims.md` supports Awards as public recognition surface but warns against claiming voting, scoring, rewards, or Network integrations as current.
- Investor revenue model ties Recognition to registration fees.

### Contradictions Between Sources

- Awards as a website/program is supported; proof-backed/network-integrated Awards is not established as live.

### Available Options

1. Awards = independent public awards program.
2. Awards = public application powered by Core.
3. Awards = recognition layer using proof/activity.
4. Awards = future Network application.
5. Current program now, future Core/Network layer later.

### Risks Of Each Option

- Independent program weakens ecosystem integration.
- Powered-by-Core claim needs technical confirmation.
- Proof/activity language needs verified mechanisms.
- Future Network app language must be marked planned.

### Codex’s Evidence-Based Recommendation

Define Awards as a live public recognition program/application today. Treat proof-backed, scoring, commerce, rewards, and Network integrations as planned or unclear until confirmed.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 7: What Are Creator Profiles?

### The Question

Are creator profiles a separate product, a Core capability, or a public surface powered by Core?

### Why The Decision Matters

Creator profiles are central to public identity, work context, catalog presentation, and creator relationship language. The content agent needs to avoid treating them as an unrelated top-level product.

### Approved Founder Decision

`APPROVED`

Creator Profiles are a public creator-facing surface powered by Certifyd Core. They are not a separate top-level product in the approved hierarchy.

### Final Approved Wording

Creator Profiles are public creator-facing surfaces powered by Certifyd Core. They can present creator identity, work context, catalog context, publishing context, and relationship surfaces. They are not a separate top-level product.

### Capability Status Rule

The hierarchy decision is approved, but the scope and rollout status of individual profile capabilities still require capability-specific classification.

### Remaining Open Questions

- Which profile capabilities are live for all creators versus limited to specific implementations.
- Whether `source-of-truth profile` is approved public language and what authority it implies.
- How creator-controlled domains and public profile URLs should be described.

## Decision 8: Should “Certifyd Creator” Be Retired?

### The Question

Should `Certifyd Creator` be retained, redefined, or retired?

### Why The Decision Matters

Ambiguous naming creates product confusion and weakens automated content consistency.

### What The Current Sources Say

- `knowledge/brand.md` says the logo uses `Certifyd Creator logo` alt text.
- `knowledge/vocabulary.md` says `Certifyd Creator` appears in logo alt text and homepage metadata but is not separately defined.
- `approved-public-claims.md` now treats Certifyd Creator as legacy or inconsistent terminology unless restored by a later founder decision.

### Contradictions Between Sources

- The term appears in metadata/alt text but not as a clearly defined product.

### Available Options

1. Retain as current product name.
2. Redefine as creator-facing product suite.
3. Treat as descriptive legacy wording.
4. Retire from public naming.

### Risks Of Each Option

- Retain: requires definition and hierarchy.
- Redefine: adds another product layer.
- Legacy/descriptive: may leave old metadata inconsistent.
- Retire: requires cleanup but improves clarity.

### Codex’s Evidence-Based Recommendation

Retire or avoid `Certifyd Creator` as a product name unless Darryl wants a separate creator-facing suite. Use `Certifyd`, `Certifyd Core`, `Certifyd Network`, `Certifyd Fan`, and `Certifyd Awards` instead.

### Founder Decision

`APPROVED`

### Final Approved Wording

`Certifyd Creator` is legacy or inconsistent terminology unless a later founder decision restores it as a product name. Do not use `Certifyd Creator` as a top-level product in new content.

## Decision 9: What Does Creator-Owned Infrastructure Mean?

### The Question

Which specific meanings are intended by `creator-owned infrastructure`?

### Why The Decision Matters

Ownership claims can imply legal, technical, financial, data, and operational guarantees. These cannot be interchangeable.

### What The Current Sources Say

- Public knowledge supports reducing platform dependency and giving creators more control.
- Investor files use creator-owned infrastructure as central positioning.
- `approved-public-claims.md` says creator-owned infrastructure needs founder decision.

### Meaning Matrix

| Possible meaning | Status | Evidence | Notes |
|---|---|---|---|
| creators own their intellectual property | `UNCLEAR` / legal claim | `knowledge/faq.md`; `approved-public-claims.md` | Needs legal boundary; do not guarantee rights. |
| creators control their identity | philosophical / `UNCLEAR` | `knowledge/vision.md`; investor hero | Needs product definition. |
| creators control their profiles | `LIVE` as public surface / `UNCLEAR` control scope | `knowledge/brand.md`; `vocabulary.md` | Control model not defined. |
| creators control publishing origins | `UNCLEAR` | `knowledge/vocabulary.md`; investor ecosystem | Needs technical confirmation. |
| creators retain direct customer relationships | philosophical / `UNCLEAR` | investment opportunity; `approved-public-claims.md` | Privacy/consent/legal concerns. |
| creators choose infrastructure providers | `PLANNED` / `UNCLEAR` | Network/operator language | Needs product/governance confirmation. |
| creators can move between nodes/services | future direction / `UNCLEAR` | inferred from portability language | Not directly established. |
| creators operate infrastructure | `BETA` / `UNCLEAR` | investor node language | Needs deployment confirmation. |
| creators financially participate in infrastructure | `VISION` / `UNCLEAR` | investor model/revenue language | Not approved as current. |
| Certifyd does not take custody of creator rights | `UNCLEAR` | ownership philosophy | Needs legal confirmation. |
| creators reduce platform dependency | supported philosophical positioning | `mission.md`; `vision.md`; `approved-public-claims.md` | Safest current framing. |

### Contradictions Between Sources

- Marketing uses strong ownership language; approved public claims recommend cautious dependency-reduction wording.

### Available Options

1. Define creator-owned as legal/IP ownership.
2. Define creator-owned as technical control and portability.
3. Define creator-owned as reduced platform dependency and direct commerce.
4. Use a layered definition with specific claims separated.

### Risks Of Each Option

- Legal/IP: high legal risk.
- Technical control: needs architecture proof.
- Dependency reduction: safe but less bold.
- Layered: strongest if carefully approved.

### Codex’s Evidence-Based Recommendation

Use a layered definition. Public default should be: Certifyd reduces platform dependency by giving creators more control over public presence, publishing context, and direct commerce. Stronger legal/technical ownership claims require founder/legal approval.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 10: What Does “Own Your Audience” Mean?

### The Question

Does “own your audience” mean direct access to fan relationships, customer records, data portability, communication without intermediary, profile control, ownership of personal information, or marketing metaphor only?

### Why The Decision Matters

Audience ownership language intersects with privacy, consent, personal data, platform policies, and legal risk.

### What The Current Sources Say

- `knowledge/brand.md`, `vision.md`, and `philosophy.md` identify `Own Your Audience` as major marketing language.
- `approved-public-claims.md` says ownership of audiences/audience relationships is risky and needs operational definition.

### Contradictions Between Sources

- Public marketing uses absolute ownership language; approved claims advise safer dependency-reduction language.

### Available Options

1. Marketing metaphor only.
2. Direct customer/fan relationship access.
3. Customer record access where consented.
4. Audience data portability.
5. Profile/channel control.
6. Combination with privacy limits.

### Risks Of Each Option

- Metaphor only: safest legally but may weaken message.
- Direct relationships/customer records: requires privacy/consent policy.
- Data portability: needs product capability.
- Profile control: safer but narrower.
- Combination: requires precise wording.

### Codex’s Evidence-Based Recommendation

Treat “own your audience” as marketing shorthand. Approved explanatory wording should focus on reducing platform dependency, building direct customer relationships where users consent, and keeping the creator profile closer to the source of commerce.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 11: What Does Provenance Mean In Certifyd?

### The Question

Does provenance establish publisher, signer, timestamp, origin, authorship, ownership, contribution history, release history, transaction history, evidentiary record, or immutable record?

### Why The Decision Matters

Provenance can be technical, factual, evidentiary, legal, or marketing language. These are different claims.

### What The Current Sources Say

- `approved-public-claims.md` marks provenance as `NEEDS FOUNDER DECISION`.
- `knowledge/vocabulary.md` says proof/provenance terms appear but are not defined.
- Investor copy references trusted identity and ownership, and public product framing references proof/activity at a high level.

### Contradictions Between Sources

- Proof-backed language appears in some contexts, but permanent/immutable/legal proof is explicitly risky in approved claims.

### Available Options

1. Provenance = who published a record.
2. Provenance = who signed a record.
3. Provenance = where/when a record originated.
4. Provenance = authorship/contribution context.
5. Provenance = legal ownership proof.
6. Provenance = immutable evidentiary record.

### Risks Of Each Option

- Publisher/signer/origin: technically supportable if implemented.
- Authorship/contribution: requires contributor model and correction process.
- Legal ownership proof: high legal risk.
- Immutable record: high technical/legal risk unless verified.

### Codex’s Evidence-Based Recommendation

Define provenance initially as public context around who published or signed a record, when it was created, and what work or contributors it references. Do not claim legal ownership proof or immutable records unless technically and legally verified.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 12: What Revenue Streams Are Live?

### The Question

Which identified revenue streams are enabled monetization, actual current revenue, proposed pricing, forecasts, or investor-model assumptions?

### Why The Decision Matters

Investor copy can discuss revenue model assumptions, but public/company claims must not imply current revenue where none is verified.

### What The Current Sources Say

- `content-agent/knowledge/investors/revenue-model.md` lists Promotion, Discovery, Recognition, Commerce, Services, and Developer Ecosystem.
- `content-agent/knowledge/investors/transaction.md` lists funding for commercial operations, enterprise operations, AI/data systems, legal readiness, and operating reserve.
- Existing public knowledge supports direct commerce as a concept and Lightning where supported, but does not verify revenue by stream.

### Revenue Matrix

| Stream | Product/layer | Payer | Charge | Current status | Evidence | Dependencies | Publicly describe as current revenue? |
|---|---|---|---|---|---|---|---|
| Promotion | Marketing/campaigns | creators/partners/brands | promotion fees | `PLANNED` / `PROJECTED` | `revenue-model.md` | campaign product, sales, reporting | No |
| Discovery | Fan/discovery | fans/creators/partners | subscriptions | `PLANNED` / `PROJECTED` | `revenue-model.md` | subscription product, pricing, billing | No |
| Recognition | Awards | nominees/partners/sponsors | registration fees | `PLANNED` / `PROJECTED` | `revenue-model.md` | awards program pricing/payment flow | No unless verified |
| Commerce | Core/Fan/profiles | fans/customers | transaction revenue | `BETA` / `UNCLEAR` | `mission.md`; `faq.md`; `revenue-model.md` | live payments, entitlement, receipts | Only as enabled/direct commerce if verified, not revenue scale |
| Services | partner/business services | creators/partners/institutions | service fees | `PLANNED` / `FUNDING-DEPENDENT` | `revenue-model.md`; `transaction.md` | managed services, support org | No |
| Developer ecosystem | developer/API layer | developers/operators | usage fees | `VISION` / `PLANNED` | `revenue-model.md` | APIs, SDKs, developer billing | No |
| Enterprise/white-label | enterprise services | agencies/labels/brands/institutions | contracts/services | `FUNDING-DEPENDENT` | `transaction.md`; `business-model.md` | sales, packaging, legal, support | No |
| Bitcoin/Lightning commerce | commerce/payment layer | fans/customers | transaction/payment fees where applicable | `BETA` / `UNCLEAR` | `faq.md`; `vocabulary.md`; `revenue-model.md` | rail availability, compliance, payment integration | Only qualified as supported where available |

### Contradictions Between Sources

- Investor model lists revenue streams; public knowledge does not establish which are live.
- The investment page asks for funds to build commercial organization and market expansion, suggesting many revenue streams are future/funding-dependent.

### Available Options

1. Publish only revenue model as strategy.
2. Publish live commerce as current if transaction data confirms it.
3. Publish all streams as active revenue.

### Risks Of Each Option

- Option 1 is safest.
- Option 2 requires evidence.
- Option 3 is unsupported and risky.

### Codex’s Evidence-Based Recommendation

Classify all revenue streams as model/strategy unless founder verifies actual current revenue. Commerce may be described as enabled/live only where specific product flows are verified.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 13: What Is The Transaction?

### The Question

What exists today, who owns it, what assets would be acquired, which entity receives investment, what does `$3M Core Technology & IP` represent, what does remaining capital fund, and which capabilities depend on closing the transaction?

### Why The Decision Matters

Investor and public documents must not confuse proposed transaction structure with completed ownership, current capitalization, or live capabilities.

### What The Current Sources Say

- `content-agent/knowledge/investors/transaction.md` says investor page presents a `$20M Investment Structure`.
- The Ask section says $3M is for acquisition of existing Certifyd IP and $17M is growth capital retained by the company.
- Use of funds includes engineering, security/reliability, growth/partnerships, enterprise operations, AI/discovery/data, legal/corporate/international readiness, and operating reserve.

### Contradictions Between Sources

- Some recent copy requests collapsed the framing under a full $20M ask, while the live investment page still describes $3M IP acquisition plus $17M growth capital in the Ask section.
- `approved-public-claims.md` does not verify Core ownership or transaction structure.

### Available Options

1. Describe as `$20M investment structure` only.
2. Describe as `$20M investment and acquisition transaction`.
3. Describe as `$3M IP acquisition + $17M growth capital`.
4. Avoid public transaction details until legal documents exist.

### Risks Of Each Option

- Investment structure only: simplest, but may hide IP acquisition detail.
- Investment/acquisition: sounds like M&A and needs legal accuracy.
- 3M+17M: precise but requires legal certainty.
- Avoid: safest publicly but weak for investor materials.

### Codex’s Evidence-Based Recommendation

Use `$20M investment structure` for high-level copy. Keep the `$3M Core Technology & IP` detail only in investor materials after legal confirmation. Mark every ownership and acquisition statement as transaction-dependent.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decision 14: What Claims Can The Content Agent Publish?

### The Question

Which claims belong in Class A, B, C, or D for automated content generation?

### Why The Decision Matters

The content agent needs clear publication boundaries before generating public pages, articles, FAQs, investor pages, or product copy.

### What The Current Sources Say

- `approved-public-claims.md` already separates safe current claims, beta claims, vision claims, and risky claims.
- Investor files add more specific Core, revenue, transaction, and scaling claims that require caution.

### Class A — Approved Public Facts

Can be stated directly if wording remains within current limits.

- Certifyd is the public brand and ecosystem.
- Certifyd Fan is linked from the public website as a fan-facing surface.
- Certifyd Awards is linked from the public website as an awards/recognition surface.
- The public website includes a Join Network path.
- The public website includes a Register Node page.
- Certifyd launched a technical beta in 2026.
- The investor site exists.
- The investment ask page exists.

### Class B — Qualified Claims

Can be stated only with words such as beta, designed to, intended to, helps, can, where supported, or public surface.

- Certifyd is designed to reduce platform dependency.
- Certifyd connects publishing, discovery, and direct creator-to-fan commerce as a model.
- Bitcoin Lightning can be supported where available.
- Creator profiles can present creator identity and work/catalog context.
- Fan can be described as a discovery/playback surface if verified.
- Core can be described as investor-site-defined foundational software, not yet final approved product definition.

### Class C — Investor Or Vision Claims

Can appear only as strategy, roadmap, projection, investment thesis, or investor model.

- Certifyd sells the business of being a creator.
- One creator, multiple revenue streams.
- Promotion fees, subscriptions, registration fees, service fees, usage fees.
- Shared operating model lowers centralized cost structure.
- AI lowers onboarding/support cost.
- Enterprise, white-label, international expansion.
- 36-month execution roadmap.
- $20M investment structure.
- `$3M — Core Technology & IP`.

### Class D — Prohibited Until Verified

Must not be published as fact.

- Certifyd guarantees complete creator ownership.
- Creators legally own their audience through Certifyd.
- Certifyd creates permanent or immutable records.
- Certifyd guarantees provenance, attribution, or legal authorship.
- Certifyd Network is fully decentralized or company-independent.
- Certifyd automatically manages royalties.
- Certifyd provides complete catalog performance tracking.
- All listed revenue streams are currently active.
- The $20M transaction is closed or committed.
- Enterprise/white-label deployments are live unless verified.

### Contradictions Between Sources

- Investor site uses strong claims for Core, ownership, revenue, and transaction; approved public claims still mark many as unresolved.

### Available Options

1. Use existing `approved-public-claims.md` as the strict rulebook until founder decisions are completed.
2. Promote investor-site claims into approved claims immediately.
3. Create separate public, investor, and internal claim classes.

### Risks Of Each Option

- Option 1 is safest and usable now.
- Option 2 risks unsupported public claims.
- Option 3 is best long-term but requires maintenance.

### Codex’s Evidence-Based Recommendation

Use Option 3 after founder approval. Until then, use Option 1 as the strict default and treat investor claims as source material, not approved facts.

### Founder Decision

`PENDING`

### Final Approved Wording

`PENDING`

## Decisions That Must Be Answered Before Public Content Generation

- What Certifyd Core is.
- Which Core capabilities are live today.
- How Core relates to Certifyd Network.
- What creator-owned infrastructure means.
- Which revenue streams are current versus proposed.
- What the transaction is and who owns Core technology.
- Which claims are approved for Class A, B, C, and D publication.

## Decisions That Can Be Deferred

- The exact replacement wording for any legacy `Certifyd Creator` references that remain in older public assets.
- Whether Awards becomes a future proof/activity layer, as long as current copy describes only the live public recognition surface.
- Whether Fan is a reference client for Network, as long as current copy describes it as fan-facing discovery/playback.
- Exact long-form definition of provenance, as long as public content avoids strong proof/legal/immutable claims.

## Recommended Approval Order

1. Approve the one-sentence definition of Certifyd Core.
2. Approve the live/beta/planned Core capability matrix.
3. Approve the Core-Network architecture boundary.
4. Approve the safe definition of creator-owned infrastructure.
5. Approve current versus proposed revenue streams.
6. Approve transaction/IP ownership wording with legal-document confirmation.
7. Approve product definitions for Fan, Awards, and creator profiles.
8. Approve the content-agent claim classes.
9. Clean up older public assets that still use `Certifyd Creator` inconsistently.

## Proposed Next Action

After Darryl approves the critical decisions, update `content-agent/knowledge/facts/approved-public-claims.md` so the content agent has one authoritative rulebook for public writing.
