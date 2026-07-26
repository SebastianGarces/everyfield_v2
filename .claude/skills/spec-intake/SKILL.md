---
name: spec-intake
description: Turn one PM list item (a sentence + maybe a spec) into a rigorous, DoD-shaped GitHub Issue ready for autonomous build. Use when the user hands you a list of things to build, or says "deliver"/"add to the backlog". Produces issues with testable acceptance criteria, a declared validation plan, a risk classification, and a file-ownership guess.
---

# spec-intake

The front door of the factory. A loop is only as good as the target it's pointed at — this skill
converts a fuzzy PM ask into a target the `build-until-done` loop can actually verify against.

Follow the EveryField `requirements-docs` conventions for wording. Keep each issue **small and
file-disjoint** where possible (smaller tracks → cleaner parallel waves, cheaper retries).

## Procedure (per list item)

1. **Clarify only if blocking.** If the item is ambiguous in a way that changes *what gets built*, ask
   one sharp question. Otherwise pick the sensible default and note it in the issue.
2. **Write the issue** using the template below. The non-negotiable part is **acceptance criteria that
   are observable** — each AC must name *how it will be proven* (a UI assertion, an API response, a test).
   If you can't state how an AC is verified, it isn't an AC yet.
3. **Classify risk.** `risk:high` iff it touches schema/migrations, auth/permissions, multi-tenant
   boundaries, or payments. (Still autonomous-to-PR, but gets the extra DoD gates + second verifier.)
4. **Guess file ownership.** List the files/dirs the work will likely create or edit, from `memory/` +
   a quick look. This is what the planner uses to keep tracks file-disjoint — accuracy keeps merges clean.
5. **Create the issue** and label it `agent:queued` (+ `risk:high` if applicable):
   ```bash
   gh issue create --title "<concise>" --body-file <path> --label agent:queued
   ```

## Issue template

```markdown
## Goal
<one sentence: the user-visible outcome>

## Context
<links: FRD path, memory contracts, related issues/PRs. What exists today.>

## Acceptance criteria  (each must be observable)
- [ ] <AC> — **verify:** <Playwright assertion / API response / test name>
- [ ] …

## Validation plan
- Lane: frontend | backend | fullstack
- G3 method: validate-frontend (flows: …) | validate-backend (routes: …)
- Extra (high-risk): migration dry-run + rollback + schema diff

## Risk
low | medium | high   <!-- high → label risk:high -->

## Likely files
- src/...
- (cross-cutting chokepoints — barrels/constants — named so one track owns them)

## Out of scope
- <explicitly excluded>
```

## Rules

- **Observable ACs or it's not ready.** "Looks good" / "works well" are not ACs.
- **Small & disjoint beats big & tangled.** Split a list item that spans many files into separate issues.
- **One concern per issue.** It maps 1:1 to a track and a PR.
- **Don't design the implementation** — describe the outcome and constraints; let the implementer choose how.
- Record the issue numbers you created so the orchestrator can preflight + schedule them.
