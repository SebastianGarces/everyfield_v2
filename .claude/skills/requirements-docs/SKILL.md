---
name: requirements-docs
description: Rules for writing and editing EveryField requirements documentation. Use when working with FRDs, Product Brief, System Architecture, or any files in product-docs/.
---

# EveryField — Requirements Documentation Rules

This repo uses a **context-sharded requirements system**: documents are context boundaries,
not convenience bundles. Each document type has strict allowed/forbidden content so any one
of them can be loaded alone.

## The document types (one line each — full rules in `references/document-types.md`)

| Document | Holds | Never holds |
|----------|-------|-------------|
| `product-brief.md` | Why the product exists, success, non-goals | Requirements, UX, data models |
| Domain references (`launch-playbook.md`) | Source material the product implements | Requirements (reference, don't duplicate) |
| `system-architecture.md` | System-wide constraints, the sandbox | Feature behavior, canonical feature schemas |
| FRDs (`features/<name>/frd.md`) | One feature's behavior, Must/Should/Nice | Other FRDs' behavior, architecture, implementation |
| Implementation plans | One execution strategy per FRD | New requirements |

## Status lives on the board, never in a file

No `checklist.md` exists (all deleted 2026-07-26 — they went stale twice in one day). A
`feature` parent issue per FRD, requirement sub-issues titled with FRD IDs, closed by
`Closes #<n>` in PRs. `gh issue list --label feature` finds them. If you catch yourself
writing `- [ ] W-0xx` into markdown, the answer is an issue. Full rules:
`references/document-types.md` §6.

## Editing

Surgical, in-place, minimal diff, no duplication — and load the minimum context (never all
FRDs). The loading policy, refactor protocol, and prohibited actions:
`references/editing-rules.md`.
