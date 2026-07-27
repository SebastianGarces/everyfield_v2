# The delivery workflow, on one page

How a sentence ("add X") becomes a merged PR — and where a human is genuinely needed. The
mechanics live in the files linked below; this page is the map. GitHub renders the diagram.

Two principles explain most of the shape:

- **Labels are canonical, everything else is derived.** Agents read and write issue labels;
  the Project board is a one-way mirror of them (`.github/workflows/board-sync.yml`).
- **Anchored, not attested.** Work counts as done when GitHub says so (a green required
  check, a real merge state), never because an agent claims it. The two anchor points are
  marked ⚓ below.

```mermaid
flowchart TD
  subgraph intake ["1 · Intake — a sentence becomes buildable work"]
    A["PM list item / idea"] --> B["spec-intake:<br/>testable ACs · validation plan · risk · likely files"]
    B -->|"build-ready"| C["Issue: agent:queued"]
    B -->|"open question"| D["Issue: needs-spec — waits for a ruling<br/>(direction questions get live prototypes)"]
    D -->|"ruling"| C
  end

  subgraph pass ["2 · A dispatch pass"]
    F["dispatch — one pass over the frontier:<br/>unblocked, unclaimed, file-disjoint tracks"]
    F --> G{"token-preflight:<br/>enough budget to FINISH?"}
    G -->|"no"| G2["defer / split — never strand work half-done"]
  end
  C --> F

  subgraph loop ["3 · build-until-done — per track, ≤3 attempts"]
    G -->|"yes"| I["claim: agent:in-progress<br/>(blast-radius guard: exactly these issues)"]
    I --> J["implementer codes in an isolated worktree"]
    J --> K["INDEPENDENT verifier runs the DoD:<br/>G0 spec · G1 declared files · G2 typecheck/lint/test<br/>G3 functional (real browser, preview deploy) · G4 memory<br/>risk:high adds 3 diverse-lens reviewers"]
    K -->|"FAIL → fix instructions"| J
    K -->|"attempts exhausted"| L["agent:blocked + evidence comment"]
    K -->|"PASS"| M["open-pr: evidence bundle + Manual QA<br/>agent:in-review"]
    M --> N{"⚓ required CI check green?"}
    N -->|"red → the real failure feeds back"| J
  end

  subgraph gate ["4 · The auto-merge gate"]
    N -->|"green"| O{"risk:high?<br/>any spec-question warning?"}
    O -->|"clean pass"| Q["merge agent:<br/>1. file code-quality warnings as issues FIRST<br/>2. squash-merge with --auto<br/>3. ⚓ report GitHub's answer, not its own"]
    O -->|"HOLD"| P["hold agent posts a DECISION —<br/>options to rule on, not a defect report;<br/>direction questions arrive as live prototypes"]
    Q --> R["issue closes → board shows Done"]
  end

  Q -.->|"follow-ups re-enter the frontier"| C

  subgraph human ["5 · The human queue — rulings, not code reviews"]
    P --> S["Sebastian rules"]
    L --> T["human decides: tighten the spec,<br/>raise the budget, or take it manually"]
  end
  S -->|"ruling applied (or merge as-is)"| Q

  style N fill:#1a7f37,color:#fff
  style Q fill:#1a7f37,color:#fff
  style P fill:#9a6700,color:#fff
  style L fill:#cf222e,color:#fff
```

## Why the gate splits the way it does

A **spec-question** warning means the verifier found a question about *what should have been
built* — only a human can answer that, so the PR holds and the comment presents options to
rule on. A **code-quality** warning is a known, tracked defect — it becomes a queued issue
*before* the merge (so a merge cannot lose it) and re-enters the same loop. `risk:high`
(schema/auth/tenancy) never auto-merges, because that is where a bad merge is unrecoverable.

The human's attention is the scarcest resource in the system: the queue contains only
decisions, never "please re-check what the gates already proved".

When a spec-question (or a `needs-spec` intake question) is a **direction** question — two or
more plausible answers where trying them beats reading about them — the decision arrives as
**live prototypes**, not prose (`.claude/skills/prototype/`): UI directions as 3–4 variants
behind the floating switcher on the branch's preview deployment, behavior directions as a
throwaway interactive CLI under `prototypes/` that replays the same scenarios through each
candidate. The reviewer operates the options and replies `go with A`, `combine A's <x> with
B's <y>`, or `riff on B`. Prototype code never merges — stripping it is part of applying the
ruling.

## Where each piece lives

| Piece | File |
|---|---|
| Status labels + board structure | `ops/agent-os/labels.md` |
| DoD gates (G0–G4, HR lenses) | `ops/agent-os/dod.md` |
| The build loop + auto-merge gate | `.claude/workflows/build-until-done.js` |
| Board mirror (labels → columns, closed → Done) | `.github/workflows/board-sync.yml` |
| Intake, dispatch, PR, validation skills | `.claude/skills/{spec-intake,dispatch,open-pr,browser-validation,definition-of-done}/` |
| Prototyping a direction decision | `.claude/skills/prototype/` (+ `src/components/prototype-switcher.tsx`) |
| Design + decision history | `product-docs/board-design-2026-07.md` |
