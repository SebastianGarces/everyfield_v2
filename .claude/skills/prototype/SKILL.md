---
name: prototype
description: Build two or three live, throwaway prototypes of competing directions so an owner-taste ruling becomes "try them, pick one" instead of "read prose and imagine". Use when a spec-question hold or a needs-spec issue is a UI DIRECTION question the owner's taste decides. UI variants live behind the prototype switcher on a preview deployment; behavior questions get a throwaway CLI outside the app.
---

# prototype — turn a direction question into a decision

A prose DECISION comment makes the reviewer *imagine* each option; a prototype lets them *operate*
each one. Use it when **experiencing the options is what decides**.

**Narrow trigger.** Prototype an owner-taste **UI direction** question. Rule behavior and policy
questions yourself from `product-docs/product-values.md`, `CONTEXT.md` and `memory/invariants.md`
(see `ops/agent-os/README.md`) unless the call is irreversible. Reached from a spec-question hold
(build into the held PR's branch) or a `needs-spec` issue at intake (branch `proto/<issue>-<slug>`,
opened as a draft PR so the push creates a preview).

## Shared discipline

- **Two or three options, genuinely divergent.** Each must be defensible as what we would ship. If a
  screenshot of A could be mistaken for B, they are one option.
- **Every option fully works, on real seeded data.** Half-built options bias the ruling; an empty
  state proves nothing about a layout. State each option's win-case and cost candidly.
- **Your run on the preview IS the single browser look** for this surface — try every option
  yourself before posting, so no later track pays a second browser pass for it.
- **No prototype surface survives to merge** — no switcher mount, no init script, no `prototypes/`
  directory, no losing variants. Stripping them is part of applying the ruling, not later cleanup.

## UI variants

All candidates live in the **same branch**, all in the DOM, selected by CSS keyed off an attribute
on `<html>`, so switching is instant and comparison is honest. The harness is
`src/components/prototype-switcher.tsx` (`PrototypeSwitcher` + `prototypeInitScript`) — **read its
docblock; it is the full pattern.** Diverge on structure (layout, hierarchy, affordances), not
styling, and stub any variant interaction that would mutate data — the preview writes to the shared
development database. Get the URL with `./scripts/preview-url.sh --wait --bypass <pr-number>`; see
`.claude/skills/browser-validation/SKILL.md` for logins and the bypass cookie.

## Behavior directions (rare — only when the call is irreversible)

A throwaway runnable under `prototypes/<issue>-<slug>/`: one pure module per direction, all behind
**one shared interface**, so replaying a single action log through each is the CLI analog of the
switcher's instant flip. Preload the contentious scenarios one keypress away. In-memory, no tests,
no generalization; one command to run, `pnpm tsx prototypes/<issue>-<slug>/cli.ts`. The winning
module is the spec for the real implementation, rewritten inside `src/` with real tests.

## The DECISION comment

Post on the held PR or the `needs-spec` issue:

```markdown
## DECISION: <the question, one line>

**Try them:** <preview URL> — flip options with the floating switcher (bottom of screen)
<!-- or, for a behavior prototype: -->
**Try them:** `git fetch origin && git checkout <branch> && pnpm tsx prototypes/<slug>/cli.ts`

| | Direction | Wins | Costs |
|---|---|---|---|
| **A** | <one line: what this direction is> | <where it's clearly better> | <what it gives up> |
| **B** | … | … | … |

**Reply to rule:** `go with A` · `combine: A's <x> + B's <y>` · `riff on B` (new round diverging
around B) · or free-form.
```

Then apply it: implement the ruled direction at production quality, strip everything else, and the
track re-enters the normal gates.
