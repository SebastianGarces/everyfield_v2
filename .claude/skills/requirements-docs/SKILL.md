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
  (Two allowed refs: the board-parent link in the header, and a document-level scope
  statement — cut/deferred/post-beta — citing its `decisions.md` row.)
- **No status, in any tense.** Not "not yet built", not "currently", not "already exists",
  not "the shipped code does X instead", and not the future-perfect form either (asserting a
  post-migration world in the present tense). A sentence describing the repo or the running
  app is a future lie: the board owns what is built.
- **No banners that patch the body.** If a section is wrong, fix the section. A banner
  saying "trust the code over this document" or "disregard the entity below" makes the FRD
  state two incompatible things and bets the reader notices the override.

When a change to code adds or alters a rule agents must not break, that goes to
`memory/invariants.md` (`ops/agent-os/dod.md` § Memory) — also not the FRD.

## Two naming idioms, one rule behind them

Both fix the same failure: a sentence that only parses if you already know what the repo
contains today, or which document a filing code stands for.

### Reuse — "the same X that <capability> owns"

An FRD often needs to say *use this, do not build a second one*. Written as **"the existing X"**
that is a status claim — the thing this document is forbidden to make — and it goes stale the day
the thing is renamed or rebuilt.

**State reuse as sameness, never as history:** `the same <thing> that <capability> owns`. Where
the no-duplication constraint *is* the requirement, close with the fixed clause
**"one implementation, not a second copy."**

| Instead of | Write |
|---|---|
| Step 4 surfaces the existing CSV import wizard | Step 4 opens **the same CSV import wizard People/CRM owns** — one implementation, not a second copy |
| the existing contextual guide config | **the same contextual guide config the wiki owns** |
| the existing transactional email pipeline | **the same transactional email pipeline the Communication Hub owns** |
| the existing team/role templates | **the same team/role template initialization Ministry Teams owns** |

Prohibited in requirement, contract, workflow and acceptance text: `existing`, `already exists`,
`already ships`, `currently`, `reuse the current`. The one honest use of "existing" is the
**user's own data** — and rewrite those too ("search the people directory", not "search existing
contacts"), because the reader cannot tell the two senses apart and neither can a grep.

### Cross-feature references — name the capability, never the feature code

`F5`, `F9`, `F11` are filing codes. They name a *document* where the sentence means a
*capability*, and they mean nothing without the index open in another tab.

**A feature code belongs in exactly two places: the FRD's own title / `Feature Code` line, and its
board link.** Everywhere else — requirement rows, integration-point tables, data-contract tables,
workflow diagrams, wireframes — name the capability. The model is the Financial Tracking FRD: *the
document-templates catalog*, *the stored receipt document*.

The capability names in use: the wiki · People/CRM (the people directory) · Meetings · Task
Management · the document-templates catalog · Financial Tracking · Ministry Teams · the
Communication Hub · the notification service · the Phase Engine · Planter Onboarding · Launch ·
Oversight.

**Event names are contracts and do not change.** `meeting.attendance.finalized` stays
`meeting.attendance.finalized`; only the prose label describing who emits or subscribes to it
changes.

Both rules stop at the archive line: an FRD marked **cut** or **archived**, and every dated
historical document, keeps its original wording — it is a record, not a spec.

The canonical word for each domain term these rules make you pick is in
[`CONTEXT.md`](../../../CONTEXT.md) at the repo root, together with the deprecated synonyms it
replaces.

### Checking your edit

Three greps. Each should return only the exclusions named beside it — nothing else.

```sh
# 1. Reuse idiom — no status-reading hits at all.
grep -rniE '\bexisting\b|already (ships|exists|computable)' product-docs/features/*/frd.md

# 2. Feature codes — hits only on a doc's own title, its `Feature Code:` line, and its board link.
grep -rnE '\bF[0-9]+\b' product-docs/features/*/frd.md

# 3. "coach" — hits only the role used precisely, plus the two content titles CONTEXT.md §1 names.
grep -rni 'coach' product-docs/features/*/frd.md
```

Exclude `features/progress-dashboard` (archived) and `features/facility-management` (cut) from
all three.

## Editing

Surgical, in-place, minimal diff, no duplication — and load the minimum context (never all
FRDs). The loading policy, refactor protocol, and prohibited actions:
`references/editing-rules.md`.
