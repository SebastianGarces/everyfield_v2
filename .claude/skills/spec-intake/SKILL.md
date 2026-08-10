---
name: spec-intake
description: Turn one PM list item (a sentence + maybe a spec) into a rigorous, DoD-shaped GitHub Issue ready for autonomous build. Use when the user hands you a list of things to build, or says "deliver"/"add to the backlog". Produces issues with testable acceptance criteria, a declared validation plan, a risk classification, and a file-ownership guess.
---

# spec-intake

The front door of the factory. A loop is only as good as the target it's pointed at — this skill
converts a fuzzy PM ask into a target the `build-until-done` loop can actually verify against.

Follow the EveryField `requirements-docs` conventions for wording. Size an issue to its **outcome**,
then cut that outcome into **workstreams** inside the body. What has to stay small and file-disjoint
is a *workstream*, not an issue: a track runs its workstreams in parallel stages and pays the build,
the suite, the preview deploy, the CI wait and the human-facing PR **once** for all of them
(`ops/agent-os/dod.md`, *Scoped vs integration*). Splitting an outcome into four issues to keep them
small buys nothing and costs that fixed price four times over — which is how 12 one-file fixes ended
up on the board (`product-docs/board-design-2026-07.md` §13).

## Procedure (per list item)

1. **Clarify only if blocking.** If the item is ambiguous in a way that changes *what gets built*, ask
   one sharp question. Otherwise pick the sensible default and note it in the issue.
2. **Write the issue** using the template below. The non-negotiable part is **acceptance criteria that
   are observable** — each AC must name *how it will be proven* (a UI assertion, an API response, a test).
   If you can't state how an AC is verified, it isn't an AC yet.
3. **Classify risk.** `risk:high` iff it touches schema/migrations, auth/permissions, multi-tenant
   boundaries, or payments. (Still autonomous-to-PR, but gets the extra DoD gates + second verifier.)
4. **Guess file ownership, then cut the workstreams.** List the files/dirs the work will likely create
   or edit, from `memory/` + a quick look. Then split them into workstreams: one per agent, each with
   its own AC subset, its own file list, and a `depends on:` line. One workstream is the normal case;
   several is correct when the outcome genuinely needs them. Put the shared prerequisite (schema,
   contract, shared types) in the workstream everything else declares a dependency on — that becomes
   stage 0. Accuracy decides two things at once: files that overlap union two workstreams into one
   sequential agent, and a workstream's list is what scopes its **G5** diff check, so a file in the
   diff and not in the list is a deviation.
5. **Find its parent.** Every requirement issue hangs off a `feature` issue — the FRD's home on the
   board. `gh issue list --label feature` lists them. If the item belongs to a feature with no parent
   yet, create the parent first (thin body: FRD link, three lines of scope, settled scope decisions —
   an index, not a store).
6. **Declare blocking edges.** If this item genuinely cannot start until another lands, say so as a
   native dependency, not a sentence. Publish blockers **first** so the edge can reference a real
   number. A dependency is *semantic* — file overlap is a scheduling constraint and belongs in
   `## Likely files`, not here. A dependency **inside** one issue needs no board edge: it is the
   workstream's `depends on:` line, and the planner reads it as a stage boundary within the track.
7. **Create the issue** and label it `agent:queued` (+ `risk:high` if applicable):
   ```bash
   gh issue create --title "<concise>" --body-file <path> \
     --label agent:queued --parent <feature-issue> [--blocked-by <n>[,<n>]]
   ```
   Use `needs-spec` instead of `agent:queued` when an open question inside the spec still changes what
   gets built — a blocked build is cheaper to prevent than to unwind. Title requirement issues with
   their FRD ID (`W-010 — Template linking`) so the doc and the board share one vocabulary.
8. **If the open question is a direction question** — 2+ plausible directions where trying them beats
   reading about them — don't stop at the `needs-spec` label: invoke the `prototype` skill
   (`.claude/skills/prototype/SKILL.md`). The issue then carries live candidates (UI variants behind
   the switcher on a preview, or a runnable CLI for behavior) and a DECISION comment the human can
   rule on directly — `go with A`, `combine A's <x> with B's <y>`, or `riff on B`.

## Issue template

```markdown
## Goal
<one sentence: the user-visible outcome>

## Context
<links: FRD path, memory contracts, related issues/PRs. What exists today.>

## Acceptance criteria  (each must be observable)
- [ ] <AC> — **verify:** <test name / API response / Playwright assertion — prefer the cheapest seam that proves it>
- [ ] …

## Validation plan
- Lane: frontend | backend | fullstack
- G3 method: validate-frontend (flows: …) | validate-backend (routes: …)
- Extra (high-risk): migration dry-run + rollback + schema diff

## Risk
low | medium | high   <!-- high → label risk:high -->

## Workstreams
<one per agent — the unit that must stay small and file-disjoint. One is normal.>

### WS1 — <name>
- **ACs:** <which of the ACs above this workstream owns>
- **Likely files:** src/…, src/…
- **depends on:** —          <!-- another WS here, or an issue number, or — for none -->

### WS2 — <name>
- **ACs:** …
- **Likely files:** …
- **depends on:** WS1

## Likely files
<the union of the workstreams' lists — this is what the planner unions issues into tracks over>
- src/...
- (cross-cutting chokepoints — barrels/constants — named so one track owns them)

## Out of scope
- <explicitly excluded>
```

## Rules

- **Observable ACs or it's not ready.** "Looks good" / "works well" are not ACs.
- **Stage 0 lands a design; it never invents one** (`ops/agent-os/delegation-rules.md` R1). If a
  workstream's description needs a design verb — decide, choose, or design a schema, a contract, or
  an auth surface — the issue is `needs-spec` by definition. Queue it only once the interface is
  written into the body.
- **Prefer the cheapest verify seam: unit test > API assertion > browser** (delegation-rules R4).
  G3 proves the integrated track once; it is the most expensive seam and the only unscopable one. An
  issue whose every AC is browser-verified usually describes a design with no seams — push the
  design toward a pure core before queueing it.
- **Every issue has a parent** (`ops/agent-os/dod.md` G0). The exception is platform work no FRD
  covers — state that rather than inventing a parent.
- **Never write a checklist file.** Status lives on the board; the eleven `checklist.md` files were
  deleted on 2026-07-26 precisely because they went stale (`product-docs/board-design-2026-07.md`).
- **Small & disjoint applies to a workstream, not to an issue.** A list item spanning many files
  becomes one issue with several workstreams — not several issues. Splitting it into issues to keep
  each one small multiplies the fixed cost of a track by the number of pieces.
- **One outcome per issue.** An issue may carry several workstreams, and a track may close several
  issues; there is one PR per **track**, not per issue (`.claude/skills/open-pr/SKILL.md`).
- **Don't design the implementation** — describe the outcome and constraints; let the implementer choose how.
- Record the issue numbers you created so the orchestrator can preflight + schedule them.
