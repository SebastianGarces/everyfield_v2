# Invocation policy — who is allowed to start the factory

Every skill splits on one axis: **who can reach it.** Getting this wrong in either direction is a
real failure, and neither direction errors at author time.

The idea and the user-invoked/model-invoked framing come from
[mattpocock/skills](https://github.com/mattpocock/skills) (`.agents/invocation.md`).

## The two settings

Per the [Claude Code skills docs](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill):

| Frontmatter | User can invoke | Claude can invoke | Description in context |
|---|---|---|---|
| *(default)* | yes | yes | always |
| `disable-model-invocation: true` | yes | **no** | **no** |
| `user-invocable: false` | no | yes | always |

Two consequences that matter here:

- **"Claude" includes subagents.** A skill with `disable-model-invocation: true` cannot be reached by
  the implementer, the verifier, or the release agent inside `build-until-done.js`.
- **It also cannot be reached from a slash-command body.** A command whose body says "invoke the `X`
  skill" breaks the moment `X` takes the flag, because that body is executed by the model.

## The rule

> **User-invoked = entry points only. Everything the loop calls stays model-invocable.**

There is a third case the two settings cannot express: a skill invoked by a **schedule**.

The factory is a graph, and only its roots are typed by a human:

```
/deliver  (command)            ← human types this
    └─ delivery-orchestrator   ← USER-INVOKED
cron (schedule)                ← human creates this ONCE
    └─ dispatch                ← SCHEDULE-INVOKED (model-invocable; guards live inside)
         ├─ token-preflight
         └─ build-until-done.js
         ├─ spec-intake              ┐
         ├─ token-preflight          │
         ├─ standup                  │  all model-invocable
         └─ build-until-done.js      │  BY DESIGN — subagents
              ├─ definition-of-done  │  call them
              │    ├─ validate-frontend
              │    └─ validate-backend
              └─ open-pr             ┘
```

Anything below the root is *reusable discipline*, not an action a human times. Flagging one of them
would not make the system safer — it would make the loop fail at attempt 1 with a confusing error.

## Current classification

**User-invoked** (`disable-model-invocation: true`) — side effects the human times:

| Skill | Why |
|---|---|
| `delivery-orchestrator` | Launches the autonomous factory: creates issues, spawns implementers, opens PRs. The model must never decide on its own that a message looked like a build list. |
| `handoff` | Overwrites `session_handoff.md` and the `MEMORY.md` pointer. Only meaningful at a moment the human chooses. |

**Schedule-invoked** — the flag cannot be the guard:

| Skill | Why it is model-invocable despite opening PRs |
|---|---|
| `dispatch` | A cron's prompt is executed by **the model**, so `disable-model-invocation: true` would make it unreachable from the schedule — the same trap as a slash-command body. |

This is the one place rule 2 below ("side effects the human should time → user-invoked") does not
apply, and it is worth being precise about why rather than treating it as an exception.

**The human still times it — once, when they create the schedule**, not once per run. Deleting the
cron is the off switch. What changes is that the invocation flag stops being a meaningful guard, so
the guarding has to move *inside* the skill:

- a **review-queue cap** — the gate that matters, because a dispatcher outrunning the human does not
  ship faster, it accumulates unreviewed branches rotting against a moving `main`
- **refuses to start** when anything is already `agent:in-progress`, and never clears another run's
  claim
- **excludes `risk:high`** unless explicitly opted in — not because the DoD cannot handle it (HR1–HR4
  exist for exactly that) but because *unattended and recurring* is a different axis from *autonomous*
- a **per-pass track cap**, so one 03:00 run cannot fill the review queue and starve the next four

Note what `dispatch` may **not** call: `delivery-orchestrator` is user-invoked, so that edge does not
exist. It calls `token-preflight` and the `build-until-done` workflow directly.

**Model-invocable — deliberately, do not "fix" this:**

| Skill | Called by | Guarded instead by |
|---|---|---|
| `spec-intake` | `delivery-orchestrator` | it only writes issues, never code |
| `token-preflight` | `delivery-orchestrator`, the wave loop | read-only estimate |
| `definition-of-done` | the verifier subagent | it reports a verdict; it can't ship |
| `validate-frontend` / `validate-backend` | `definition-of-done` | read-only assertions |
| `open-pr` | the release subagent | **its own precondition** — it refuses to open a PR on a FAIL verdict. That refusal is the guard, not the invocation flag. |
| `standup` | anyone | read-only |
| `prototype` | the hold agent in `build-until-done.js`, `spec-intake` | throwaway by contract — prototype code lives only on branches, never merges; stripping it is part of applying the ruling |
| `grilling`, `browser-validation`, `resolving-merge-conflicts` | anyone | no side effects beyond the work at hand |

> **Hazard.** Adding `disable-model-invocation: true` to any row in the second table breaks
> `build-until-done` silently — the subagent simply cannot see the skill, and the failure surfaces as
> an unrelated gate failure several minutes later. Same class of trap as renaming the CI job
> `Format, Lint, Typecheck, Build` without updating the ruleset: a contract that lives in two places.

## Adding a skill

Ask the question in this order:

0. **Does a schedule invoke it?** → model-invocable, and guard it *inside* the skill. Stop.
1. **Does a subagent or another skill invoke it?** → model-invocable. Stop.
2. **Does it have side effects the human should time** (creates issues, opens PRs, writes memory,
   deploys)? → `disable-model-invocation: true`, and make sure nothing invokes it by name.
3. Otherwise → model-invocable, with rich trigger phrasing in the `description` so it actually fires.

A user-invoked skill may invoke model-invocable ones. It must never invoke another user-invoked one —
that edge is unreachable by construction.
