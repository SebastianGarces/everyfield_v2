# Behavior prototype — a throwaway CLI that lets the reviewer drive the directions

For direction questions about **how something should behave**: state transitions, data shape,
algorithms, policy under edge cases. The kind of thing that looks reasonable on paper and only
feels wrong once real cases are pushed through it. The reviewer drives each direction by hand in
the terminal and rules.

This code lives **completely outside the application**. It mimics only the logic in question —
the app around it is irrelevant to the decision.

## Shape

```
prototypes/<issue>-<slug>/
  README.md        # the question, one paragraph — so the prototype can be checked against it
  directions.ts    # one module per direction, ALL implementing the same interface
  cli.ts           # the thin TUI shell; this is the only file the reviewer runs
```

- **The directions are the prototype.** Each direction is a pure module — no I/O, no terminal
  code, no imports from `src/` — implementing the **same interface**. Pick the interface shape
  that fits the question, not the one easiest to wire to a TUI:
  - a **reducer** `(state, action) => state` when actions are discrete events;
  - an explicit **state machine** when "which actions are even legal right now" is part of the
    question;
  - a **set of pure functions** over a plain data type when there is no implicit current state.
- **The TUI is a disposable shell over them.** On every keypress: clear the screen
  (`console.clear()`) and re-render one full frame — current state pretty-printed (one field per
  line; ANSI bold `\x1b[1m` for names, dim `\x1b[2m` for derived values), then the key legend at
  the bottom: `[a] add person  [t] tick  [1-3] direction  [s] scenario  [q] quit`. The whole
  frame fits on one screen; never append to scrollback.

## The two things that make comparison honest

1. **Direction switching by event-log replay.** Keep the log of every action dispatched. When the
   reviewer presses `[2]`, replay the whole log through direction 2 from the initial state. Same
   inputs, different rules — the CLI analog of the UI switcher's instant flip. This is why the
   directions must share one interface.
2. **Preloaded scenarios.** The contentious cases that raised the spec-question ship as named
   scenarios (prebuilt action logs) one keypress away — the reviewer must not have to reconstruct
   the edge case by hand. Include at minimum the exact case the verifier or spec flagged.

## Rules

- **In-memory only.** No database, no network, no filesystem state — unless persistence is itself
  the question.
- **No tests, no generalization.** A prototype that needs tests is no longer a prototype; "what if
  we later want X" is scope creep on throwaway code.
- **It must keep `pnpm typecheck` and `pnpm lint` green.** `tsconfig.json` includes `**/*.ts` and
  eslint does not ignore `prototypes/`, and CI runs on the branch. Strict mode on a small pure
  module is cheap — and type errors in a direction module are often bugs in the *idea*, which is
  exactly what we're here to find.
- **One command to run**, stated in the DECISION comment:

  ```bash
  git fetch origin && git checkout <branch>
  pnpm tsx prototypes/<issue>-<slug>/cli.ts
  ```

## Where it runs

- **Hold case:** commit into the held PR's branch.
- **Intake case:** branch `proto/<issue>-<slug>` is enough — a behavior prototype needs no
  preview deployment, so no draft PR is required; the DECISION comment on the issue carries the
  checkout + run command.

Drive every direction through every scenario yourself before posting the DECISION.

## After the ruling

The winning direction's module is the **spec** for the real implementation — lift or rewrite it at
production quality inside `src/` with real tests. The TUI shell and the `prototypes/` directory
are deleted before merge, always.
