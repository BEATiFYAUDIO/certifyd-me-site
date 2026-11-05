# Network Distribution


## Definition

Network distribution is the capability for Certifyd infrastructure to connect, route, distribute, host, or expose content, identity, catalog, or commerce context across participating infrastructure. Nodes, federation, distributed hosting, portability, replication, uptime, fault tolerance, governance, independence, and decentralization are separate claims.

## Purpose

Connect creator-operated public origins, fan discovery and optional provider services while preserving identity verification and public/private permission boundaries. Transport, proof authority and payment readiness remain distinct.

## Current Status

`BETA`

## Confidence

`HIGH`

Confidence applies to the specifically evidenced technical subset below; deployment and unresolved product behavior are not inferred.

## Review State

APPROVED only for the successfully verified technical facts in Supported Current Claims, at the source/fixture scope below. Static schema or implementation statements describe source structure only. No complete workflow, unresolved observation or released-build claim is approved by inference. Existing claim approvals are preserved; article publication still requires founder review.

## Supported Current Claims

- Certifyd Fan’s discovery client aggregates public discoverable content from configured creator Core origins rather than owning the authoritative creator catalog.
- Core’s participation resolver separates selected creator/node mode from named routing and local service readiness; a public link alone does not make a node payment-ready.
- Configured origins and tunnel routing supply transport; discovery and lifecycle mechanisms do not establish automatic peer-to-peer content replication or fully decentralized governance.
- Certifyd provides a Register Node page for existing infrastructure operators.
- Certifyd Network is the distributed infrastructure layer in the approved hierarchy.

## Technical Mechanism

Fan merges/deduplicates origins from its static registry and environment configuration and requests each origin’s public discovery endpoint. Core distinguishes Basic Creator, Sovereign Creator and Sovereign Node participation from temporary/permanent route and payment capability. Public transport may use a tunnel; that is not a peer-replication protocol.

## Creator or Fan Workflow

The verified mechanisms distinguish configured public origins, explicit sharing consent and selected participation mode. Fan’s mocked discovery tests fetch and reconcile work from configured origins. Provider handshake and production node operation remain separate evidence gaps.

## Current Behavior

Passing tests verify configured-origin discovery, public lifecycle and current-checkout participation-mode separation. Source inspection identifies provider/delegation records but does not confirm an operational provider handshake.

## Architectural Role

A fan-facing client can consume multiple creator-operated origins rather than requiring every work to be held by one discovery application. Configured origin aggregation and delegated services are narrower than full decentralization.

## Why It Exists

Network distribution exists to reduce dependency on a single centralized platform model and expand creator/operator participation.

## Product Surfaces

- Network
- Core
- Creator profiles
- Partner infrastructure
- Fan
- Awards

## Intended Users

- node operators
- creators
- partners
- businesses
- administrators
- investors

## Current Evidence

- knowledge/brand.md
- knowledge/vision.md
- knowledge/vocabulary.md
- content-agent/knowledge/ecosystem.md
- content-agent/knowledge/facts/approved-public-claims.md
- content-agent/knowledge/investors/investor-claims-review.md
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/config.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/api.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/progressiveDiscovery.ts`
- `/home/Darryl/Projects/certifyd-fan-pwa/src/lib/progressiveDiscovery.regression.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/participationMode.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/participationMode.test.ts`
- `/home/Darryl/Projects/contentbox/apps/api/src/server.ts: provider handshake and delegated records`
- `/home/Darryl/Projects/contentbox/apps/api/src/lib/publicLifecycle.ts`
- `content-agent/knowledge/capabilities/consistency-review.md` — November 5 audit provenance and test limits.

## Qualified Claims

- New technical details describe the inspected beta source and passing fixture subset, not confirmed functionality of a particular shipped binary or production deployment.
- Automatic peer discovery, DHT, consensus, redundant content replication, federation guarantees, operator independence and universal uptime were not established. A static registry, Cloudflare tunnel, GitHub-backed AR registry and a creator Core have different authority and dependency boundaries.
- Availability is limited to the supported beta implementation and applicable setup; audited source and test behavior do not prove every installed/released build behaves identically.

## Prohibited Claims

- Certifyd Network is fully decentralized.
- No company controls the Network.
- Network participation guarantees uptime, portability, replication, or fault tolerance.
- Nodes are independent in a governance sense without evidence.

## Technical Verification Required

- The mode-resolver release mapping, production provider delegation, automatic peer discovery/replication and network governance remain unresolved.

## Legal or Policy Verification Required

- governance
- operator agreements
- data protection
- content liability
- availability obligations
- decentralization claims

## Commercial Status

unclear

## Dependencies

- technical architecture
- operator onboarding
- governance/legal model
- Core relationship

## Open Questions

- The mode-resolver release mapping, production provider delegation, automatic peer discovery/replication and network governance remain unresolved.

## Update History

- 2026-07-26: First-pass capability file created from existing public and investor knowledge. Approval status: internal knowledge draft, not public claim approval.

## Limitations

Automatic peer discovery, DHT, consensus, redundant content replication, federation guarantees, operator independence and universal uptime were not established. A static registry, Cloudflare tunnel, GitHub-backed AR registry and a creator Core have different authority and dependency boundaries.

## Historical Beta 20 Comparison

The guide’s three walkthrough choices are historical onboarding labels, not proof that every release uses the same mode resolver. The inspected Beta 27 release worktree lacks participationMode.ts, while the current Core checkout has it; only the current-checkout mode distinction is asserted.

## Verification Status

Verified on 2026-11-05. Fan discovery regressions and Core participationMode/publicLifecycle tests. Provider source inspection does not verify a live handshake.

Tested source behavior and confirmed released functionality are separate: no new release or deployment claim was confirmed. Pre-existing LIVE/architectural claims retain their original limited approval. Repository revisions, quarantined observations and exact test evidence are in the separate consistency audit; failures are not approved product knowledge.

## Technical Update History

- 2026-11-05: Enriched from implementation and offline tests. Existing supported claims and prohibited legal/financial/availability claims retained; status narrowed to the evidenced subset.

## Verified Mechanism

Passing fixtures demonstrate multi-origin discovery/reconciliation, explicit sharing lifecycle and current-checkout participation-mode separation. They do not test production provider handshake or content replication.

## Current Availability

No released binary or production deployment was verified for the newly enriched technical subset. Source/fixture verification alone does not confirm released availability. BETA describes the inspected implementation scope, not confirmation that every distributed build contains it.

## Unresolved Issues

Deployed mode mapping, live provider operation, automatic discovery/replication and governance guarantees remain unresolved. Exact failure evidence and source-only observations remain in the unapproved consistency audit; they are not supported public claims.
