# Capabilities

## Purpose

Capability files describe what Certifyd does or intends to do at the functional level. They are not product pages, marketing copy, or implementation documentation.

## Capability Files Versus Product Files

Product files describe product surfaces such as Certifyd Core, Certifyd Fan, Certifyd Awards, Certifyd Network, and creator profiles. Capability files describe functional areas such as identity, publishing, receipts, access, discovery, commerce, and payments.

One capability may appear through multiple products. For example, access may involve Core, Fan, creator profiles, and commerce surfaces. One product may expose multiple capabilities. For example, Fan may involve discovery, playback, access, library, support, and commerce.

## Architectural Role Versus Capability Status

A capability can be part of Certifyd Core's approved architecture while its implementation status remains `UNCLEAR`, `BETA`, `PLANNED`, `FUNDING-DEPENDENT`, or `TRANSACTION-DEPENDENT`.

Agents must not treat architectural inclusion as proof of live product behaviour.

## Status System

- `LIVE`: Publicly demonstrated or currently available in at least one supported surface.
- `BETA`: Exists in an early, limited, or still-being-hardened form.
- `PLANNED`: Intended future capability, not currently delivered.
- `FUNDING-DEPENDENT`: Depends on future financing, hiring, infrastructure, or commercial execution.
- `TRANSACTION-DEPENDENT`: Depends on a transaction, acquisition, assignment, consolidation, or legal structure.
- `VISION`: Strategic direction or philosophy, not a committed implementation.
- `UNCLEAR`: Insufficient evidence to classify safely.

## Confidence Values

- `HIGH`: Supported by clear extracted source material and no material contradiction.
- `MEDIUM`: Supported by source material but limited, broad, or partially ambiguous.
- `LOW`: Mentioned or implied, but evidence is thin, inconsistent, or investor-only.

Status and confidence are different. A capability may be `PLANNED` with `HIGH` confidence. A capability may appear `LIVE` with only `LOW` confidence. An architectural role may be approved while implementation status remains `UNCLEAR`.

## Agent Use Rules

1. Read `content-agent/knowledge/constitution.md` first.
2. Read `content-agent/knowledge/facts/approved-public-claims.md`.
3. Read the relevant product file and capability file.
4. Check both status and confidence.
5. Do not make capability-specific public claims unless listed as supported current claims or approved elsewhere.
6. Use qualified wording for beta, planned, funding-dependent, transaction-dependent, vision, or unclear claims.
7. Preserve open questions rather than resolving them by inference.

## Claim Approval

Capability claims become approved when they are supported by extracted evidence, technical verification where needed, and founder/legal approval where the claim affects public truth, product architecture, legal meaning, governance, or financial statements.

## Technical Verification

Technical verification should later update these files with implementation evidence such as source files, API routes, data models, cryptographic design, runtime behaviour, permissions, storage models, node behaviour, payment integrations, deployment evidence, and production usage.

## Initial Source Set

Initial capability files use only the current public and investor knowledge base. They do not inspect application code or additional repositories.

## Update History

- 2026-07-26: Created first-pass capability structure from existing public and investor knowledge. Approval status: first-pass internal knowledge, not public claim approval.
