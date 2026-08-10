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

## An FRD states the end state — rulings land in the ledger

An FRD describes what the feature IS when it is right (`product-docs/product-values.md`
§What this means for FRDs). The 2026-08-10 audit found the drift concentrates in three
forms; all three are prohibited:

- **No ruling provenance in requirement text.** No ruling dates, no `#NNN` issue citations,
  no `decision #N` references, no supersession banners ("supersedes/amends the ruling
  above"). A ruling is recorded once, in `product-docs/decisions.md`; the FRD absorbs it by
  **the requirement text becoming correct**. At most, a requirement carries one line of
  *why* — the rationale that stops the question being reopened — with no date and no number.
  (The one allowed ref is the board-parent link in the header.)
- **No status, in any tense.** Not "not yet built", not "currently", not "already exists",
  not "the shipped code does X instead", and not the future-perfect form either (asserting a
  post-migration world in the present tense). A sentence describing the repo or the running
  app is a future lie: the board owns what is built.
- **No banners that patch the body.** If a section is wrong, fix the section. A banner
  saying "trust the code over this document" or "disregard the entity below" makes the FRD
  state two incompatible things and bets the reader notices the override.

When a change to code adds or alters a rule agents must not break, that goes to
`memory/invariants.md` (see the `memory-maintenance` skill) — also not the FRD.

## Editing

Surgical, in-place, minimal diff, no duplication — and load the minimum context (never all
FRDs). The loading policy, refactor protocol, and prohibited actions:
`references/editing-rules.md`.
