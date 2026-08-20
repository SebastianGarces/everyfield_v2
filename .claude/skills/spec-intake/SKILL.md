---
name: spec-intake
description: Turn one PM list item (a sentence + maybe a spec) into a rigorous GitHub Issue ready for autonomous build. Use when the user hands you a list of things to build, or says "deliver"/"add to the backlog". Produces issues with testable acceptance criteria, a declared validation plan, and a file-ownership guess.
---

# spec-intake

The front door of the factory. A loop is only as good as the target it is pointed at. Follow the
`requirements-docs` conventions for wording, and size an issue to its **outcome**.

## Procedure

1. **Clarify only if blocking** — an ambiguity that changes *what gets built*. Otherwise default and
   note it in the issue.
2. **Write the issue** from the template. The non-negotiable part is observable ACs: each names how
   it will be proven. If you cannot say how, it is not an AC yet.
3. **Guess file ownership, then cut the workstreams.** **One workstream is the default**; a second
   must state its reason — real file disjointness plus parallel time saved — because each buys
   another implement agent. A shared prerequisite (schema, contract, types) goes in the workstream
   the others `depends on:`, which makes it stage 0. Overlapping files union two workstreams into
   one sequential agent.
4. **Find its parent** — a `feature` issue (`gh issue list --label feature`). None yet → create the
   thin one first: FRD link, three lines of scope.
5. **Declare blocking edges.** A dependency is *semantic*; file overlap is scheduling and belongs in
   `## Likely files`. A dependency inside one issue is a `depends on:` line, not a board edge.
   Publish blockers first so the edge can name a real number.
6. **Create it**, titled with its FRD ID (`W-010 — Template linking`):
   ```bash
   gh issue create --title "<concise>" --body-file <path> \
     --label agent:queued --parent <feature-issue> [--blocked-by <n>[,<n>]]
   ```
7. **Rule any question that remains** from `product-docs/product-values.md`, `CONTEXT.md` and
   `memory/invariants.md`; record the ruling in the body and queue the work. Convene a short
   consulate (2–3 perspectives, one synthesis) for a hard call. A product ruling also goes in
   `product-docs/decisions.md`. Two questions you do not rule: owner taste on **UI direction**
   (invoke the `prototype` skill and keep the work moving), and an item that is **not yet fleshed
   out** as a product idea — label it `needs-spec` and bring it to Sebastian as a conversation
   (`grilling`); the talk turns it into `agent:queued`.

## Issue template

```markdown
## Goal
<one sentence: the user-visible outcome>

## Context
<links: FRD path, memory contracts, related issues/PRs. What exists today.>

## Acceptance criteria  (each must be observable)
- [ ] <AC> — **verify:** <test name / API response / Playwright assertion — prefer the cheapest seam that proves it>

## Validation plan
- Lane: frontend | backend | fullstack
- WORKS method: browser (flows: …) | request (routes: …)
- Extra (any migration in the diff): applies + rollback proven, DDL delta in the PR body

## Workstreams
<one per agent. ONE is the default; a second must state why.>

### WS1 — <name>
- **ACs:** <which of the ACs above this workstream owns>
- **Likely files:** src/…, src/…
- **depends on:** —          <!-- another WS here, or an issue number, or — for none -->

## Likely files
<the union of the workstreams' lists — what the planner unions issues into tracks over>
- src/...
- (cross-cutting chokepoints — barrels/constants — named so one track owns them)

## Out of scope
- <explicitly excluded>
```

## Rules

- **Observable ACs or it is not ready.** "Looks good" is not an AC.
- **Prefer the cheapest verify seam: unit test > API assertion > browser.** An issue whose every AC
  is browser-verified usually describes a design with no seams — push it toward a pure core first.
- **The design must be written down before implementation starts.** An implementer inventing a
  contract mid-build is what makes tracks collide. You write and rule that design.
- **Every issue has a parent**, except platform work no FRD covers.
- **Never write a checklist file.** Status lives on the board.
- **Small and disjoint applies to a workstream, not to an issue.** One outcome per issue; one PR per
  **track**. Do not design the implementation — describe the outcome and constraints. Record the
  issue numbers you created.
