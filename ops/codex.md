# Working on EveryField with Codex

Codex uses the same delivery process, requirements, memory, and engineering principles as Claude
Code. The repository keeps one source for each rule and uses thin host adapters only where the
products require different configuration formats.

## What Codex loads

- `AGENTS.md` is the repository instruction entrypoint.
- `.agents/skills/` is the shared skill catalog Codex discovers directly. Repo workflow skills
  whose source remains under `.claude/skills/` appear here as symlinks.
- `.codex/hooks.json` loads the engineering principles at session start, blocks the poisoned
  worktree/`node_modules` pattern before shell commands, and formats files named by `apply_patch`.
- `.codex/agents/*.toml` exposes the architect, backend, code-reviewer, and frontend roles as Codex
  custom agents. They inherit the task's model and permissions.
- `.worktreeinclude` copies the ignored `.env.local` into Codex-managed worktrees. Each worktree
  still needs its own real `pnpm install`; never share `node_modules` between checkouts.

The Claude-only `handoff` skill is deliberately not mirrored. Codex tasks retain their own history
and the app has a native Local ↔ Worktree handoff, so writing Codex state into Claude's personal
memory directory would create a second, stale source of truth.

## One-time app setup

1. Trust the EveryField project so Codex can load project `.codex/` configuration.
2. Review and trust the project hooks when Codex prompts. Hook trust is tied to the exact hook
   definition, so review again after an intentional hook change.
3. For automatic dependency installation in newly created app worktrees, create/select a shared
   local environment in Codex settings whose setup script is `pnpm install`. This is optional;
   agents can run the same command as their first worktree step.
4. Start a new task after pulling setup changes. Codex discovers `AGENTS.md`, project hooks, custom
   agents, and skill changes at task/session startup.

Do not create `.codex/skills/`. Codex's repository skill location is `.agents/skills/`; a second
tree produces duplicate names and drift. The stale Codex-only copies that previously lived there
were removed.

## Keeping the adapters in sync

When a Claude-native workflow skill or custom agent changes, regenerate the Codex adapters:

```bash
node ops/sync-codex-setup.mjs --write
node ops/sync-codex-setup.mjs --check
```

The sync command refuses to replace a real directory in `.agents/skills/` or `.cursor/skills/`; it
only creates or repairs the declared symlinks. CI runs the check through `pnpm test`.

Useful official references: [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills),
[hooks](https://learn.chatgpt.com/docs/hooks),
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and
[managed worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).
