# Canonical Document Types — full rules

## 1. Product Brief (`product-brief.md`)

**Purpose:** *why* the product exists and *what success means*.

**Allowed:** problem statement, product vision, target users, core concepts & domain language,
phase structure (high-level only), success metrics, explicit non-goals, product-level open questions.

**Forbidden:** feature requirements, screens/workflows/UX details, data models, integrations,
architecture details.

**Rules:** safe to load into any LLM prompt; implementation-agnostic; features referenced by
name only.

## 2. Domain Reference (e.g. `launch-playbook.md`)

Authoritative source material the product implements. Not a requirements document; do not
rewrite unless explicitly requested; requirements *reference* it, never duplicate it.

## 3. System Architecture (`system-architecture.md`)

**Purpose:** system-wide constraints and invariants — the *sandbox* all features operate in.

**Allowed:** high-level architecture, tech stack constraints, conceptual data ownership
boundaries, cross-cutting services (auth, phase engine, search, observability), integration
boundaries, system-wide non-functional requirements.

**Conditionally allowed (reference-only):** shared/core entities at a conceptual level;
example schemas clearly marked non-prescriptive.

**Forbidden:** feature-specific workflows or behavior, screens or UX flows, feature entities
as canonical schemas, step-by-step logic.

**Rules:** architecture defines **constraints, not feature behavior**; field-level schemas
live in the owning feature's FRD; schemas here must be labeled *reference-only*.

## 4. Feature Requirements Documents (FRDs)

**Location:** `product-docs/features/<feature-name>/frd.md`

**Rules:** one feature per FRD; independently understandable; may reference Product Brief and
System Architecture only; must not reference other FRDs.

**Required sections:** feature overview, user-visible behavior, screens and workflows,
functional requirements, acceptance criteria, feature-owned data entities, integration points,
feature-scoped non-functional requirements, success metrics, open questions.

**Requirement levels (mandatory):** **Must Have** (initial release) / **Should Have**
(important, deferrable) / **Nice to Have** (optional/future). Ambiguous levels must be
explicitly labeled.

**Forbidden:** system-wide architecture, product vision/philosophy, implementation strategy
or code.

## 5. Implementation Plans (per FRD)

One valid execution strategy for an FRD. May change without changing the FRD; must conform to
Architecture + FRD; must not introduce new requirements.

## 6. Implementation status — on the board, not in a file

**There is no `checklist.md`.** All eleven were deleted 2026-07-26; status lives on GitHub.
The live contract is `ops/agent-os/labels.md` (`product-docs/board-design-2026-07.md` is the
historical design log).

```
Feature issue (label: feature)   ← links to the FRD, renders the progress bar
  └─ requirement sub-issue       ← one per OPEN requirement, titled with its FRD ID
       └─ unit sub-issue         ← only where a requirement needs slicing
```

Find a feature's board entry with `gh issue list --label feature`.

**Rules:**

- **Never recreate a checklist file.** It went stale twice in one day. If you catch yourself
  writing `- [ ] W-0xx` into a markdown file, the answer is an issue.
- **The FRD requirement tables stay.** They carry no status — Must/Should/Nice states what the
  feature *is*, not what is built.
- **Only open requirements get issues.** Shipped ones are recorded by their closed issue and
  git history; never create an issue just to close it.
- **Nice-to-Have requirements stay in the FRD** and get no issue. They are spec, not backlog.
- Requirement issues are titled with the FRD ID (`W-010 — Template linking`) so doc and board
  share one vocabulary.
- Two requirements may share one issue when they are a single vertical slice
  (`W-018 + W-020`) — say so in the title, explain the merge in the body.

**When a requirement's status changes:** nothing to edit — a PR carrying `Closes #<n>` closes
the issue, which moves the parent's progress bar.

**When a requirement is added to an FRD:** add the row. Create an issue only if it is Must or
Should *and* actually intended — otherwise the row is enough.
