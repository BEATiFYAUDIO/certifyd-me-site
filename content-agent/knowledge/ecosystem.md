# Certifyd Ecosystem

## Source Scope

This file applies the founder-approved product hierarchy and keeps architecture, implementation status, commercial status, and roadmap status separate.

Evidence base:

- Founder-approved product-architecture decision.
- Investor site extraction in `content-agent/knowledge/investors/`.
- Public-site extraction in root `knowledge/`.
- `content-agent/knowledge/facts/approved-public-claims.md`.

## Official Product Hierarchy

### Certifyd

The overall brand and connected ecosystem.

- **Architecture status:** Approved.
- **Current public status:** `LIVE` as a public brand and connected public web presence.
- **Notes:** The corporate/legal entity should still be distinguished from the public brand where investment, contracts, ownership, or governance are discussed.

### Certifyd Core

The foundational engine at the centre of the ecosystem.

> Certifyd Core is the foundational engine that powers identity, publishing, provenance, creator profiles, release records, access, and direct commerce across the Certifyd ecosystem.

- **Architecture status:** Approved.
- **Implementation status:** Capability-specific.
- **Important distinction:** Core’s architectural role is approved, but each capability must still be classified separately.

### Certifyd Network

The distributed infrastructure layer through which creators, partners, and operators can run, extend, host, distribute, or connect Certifyd capabilities.

- **Architecture status:** Approved as a layer.
- **Implementation status:** `BETA` / `UNCLEAR` depending on specific capability.
- **Open technical issue:** The exact operational relationship between Core and individual nodes still requires confirmation.

### Certifyd Fan

The fan-facing application and experience for discovering, accessing, playing, collecting, and directly supporting creator work.

- **Architecture status:** Powered by or connected to Certifyd Core.
- **Current status:** `LIVE` as a public surface; specific features require verification.

### Certifyd Awards

The recognition layer for creators, works, partners, and infrastructure activity.

- **Architecture status:** Public ecosystem surface powered by or connected to the broader Certifyd system.
- **Current status:** `LIVE` as public Awards surface/program.
- **Roadmap distinction:** Planned voting, scoring, rewards, commerce, and Network integrations must remain separate from current Awards capabilities.

### Creator Profiles

Creator profiles are public creator-facing surfaces powered by Certifyd Core.

- **Architecture status:** Approved as Core-powered surface.
- **Product status:** Not currently a separate top-level product.
- **Current status:** `LIVE` as demonstrated public profile surface; full feature scope needs confirmation.

### Certifyd Creator

`Certifyd Creator` is legacy or inconsistent terminology unless a later founder decision restores it as a product name.

- **Writing rule:** Do not use `Certifyd Creator` as a top-level product in new content.

## Conceptual Product Hierarchy

```text
Certifyd
   |
   v
Certifyd Core
   |
   +-- Creator Profiles
   +-- Certifyd Fan
   +-- Certifyd Awards
   +-- Certifyd Network
   +-- Partner and commerce surfaces
```

This is a conceptual product hierarchy, not a complete technical deployment diagram.

## Architecture Versus Status

### Architecture

Core is the centre of the ecosystem and powers identity, publishing, provenance, creator profiles, release records, access, and direct commerce across the Certifyd ecosystem.

### Implementation Status

Individual Core capabilities may be live, beta, planned, funding-dependent, transaction-dependent, unclear, or available only in particular implementations.

### Commercial Status

Revenue streams and commercial services must be classified separately from product architecture. A capability being architecturally part of Core does not prove that it currently generates revenue.

### Roadmap Status

Enterprise readiness, broader partner programs, expanded Network participation, future Awards integrations, and some developer/service revenue streams remain planned, projected, or funding-dependent unless separately verified.

## Current Capabilities Supported By Sources

- Certifyd has public web presence. **Classification:** `LIVE`.
- Certifyd Fan is a public product surface linked from source material. **Classification:** `LIVE` as a surface; feature scope requires verification.
- Certifyd Awards is a public product surface linked from source material. **Classification:** `LIVE` as a surface/program; future integrations remain planned/unclear.
- Creator profiles are a public Core-powered surface by founder decision. **Classification:** `LIVE` as demonstrated surface; full capability scope requires confirmation.
- Certifyd Core is approved as the ecosystem engine. **Classification:** Architecture approved; deployment status capability-specific.
- The investment page presents a $20M investment structure. **Classification:** `TRANSACTION-DEPENDENT` as a claim; `LIVE` only as visible page content.

## Beta, Planned, Funding-Dependent, Or Unclear Areas

- Exact live Core capability list. **Classification:** `PENDING FOUNDER DECISION` / capability-specific.
- Exact Core-to-Network runtime architecture. **Classification:** `UNCLEAR`.
- Creator-owned infrastructure legal and operational boundaries. **Classification:** `UNCLEAR`.
- Current versus proposed revenue streams. **Classification:** `UNCLEAR` / stream-specific.
- Transaction and ownership details. **Classification:** `TRANSACTION-DEPENDENT`.
- Awards voting, scoring, rewards, commerce, and Network integrations. **Classification:** `PLANNED` / `UNCLEAR`.
- Partner integrations, enterprise services, and broader developer ecosystem. **Classification:** `PLANNED` / `FUNDING-DEPENDENT`.

## Remaining Contradictions Or Open Issues

- Public-site vocabulary still contains older or inconsistent terms such as `Certifyd Creator`.
- Network has an approved layer definition, but exact Core-to-node runtime behavior still needs technical confirmation.
- Core architecture is approved, but capability deployment status is not fully approved.
- Strong ownership language still requires legal and operational boundaries.
- Investor revenue model remains separate from verified current revenue.

## Writing Guidance

- Never omit Certifyd Core when explaining ecosystem architecture.
- Never describe Core as merely a node application.
- Never use the architectural Core definition as proof that every capability is live.
- Always distinguish architecture, implementation status, commercial status, and roadmap.
- Do not use `Certifyd Creator` as a top-level product name unless restored later.

## Open Questions

- Which Core capabilities are live today?
- What is the exact Core-to-Network runtime architecture?
- Which revenue streams are current versus proposed?
- What is the legally safe definition of creator-owned infrastructure?
