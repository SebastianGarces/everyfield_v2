# Memory Context Pack

Token-efficient context for AI agents working in this repository.

## Purpose

This directory contains summarized architecture, flows, contracts, and invariants. Agents should load this context **before** opening source files to minimize token usage.

## Structure

```
memory/
├── README.md          # This file
├── index.md           # TOC + decision guide
├── entrypoints.md     # Flow entrypoints with file:symbol references
├── invariants.md      # Stable truths enforced across codebase
├── contracts/
│   ├── api.md         # API routes summary
│   ├── db.md          # Database schema summary
│   └── config.md      # Environment and configuration
└── flows/
    ├── auth.mmd       # Authentication flow
    ├── wiki-article.mmd   # Wiki article retrieval
    └── request-lifecycle.mmd  # Dashboard request lifecycle
```

## Usage

1. Read `entrypoints.md` first to understand where flows start
2. Load relevant `flows/*.mmd` for visual understanding
3. Check `contracts/*.md` for interface details
4. Consult `invariants.md` for rules that must not be violated

## Size Budget

Target: **≤50 KB total** across all memory files.

## Maintenance

Memory is updated during feature implementation when changes affect:
- Entrypoints (new routes, actions, triggers)
- Flows (control flow changes)
- Contracts (schema, API, config changes)
- Invariants (security, tenancy, auth rules)

See `.agents/memory-first.md` for the memory-first skill specification.
