# Archived skills

Skills that were live and are no longer loaded. They live **outside `.claude/skills/`** so no agent
can reach them, and are kept in the repo because their content is still worth something — usually
guidance that outlived the mechanics it was wrapped around.

Deleting them outright would lose that; leaving them in `.claude/skills/` would leave agents
following instructions that cannot be carried out.

| Skill | Archived | Why | Revive when |
|-------|----------|-----|-------------|
| `wiki-articles` | 2026-07-26 | Its workflow writes MDX to a repo-root `wiki/` directory that was deleted when articles moved into the database (`scripts/migrate-wiki-to-db.ts`, commit `6f9445a`). There is no DB-era authoring path at all — only that one-time migration script — so the skill cannot be reworked, only paused. **The article style guidance is still good and is the reason this wasn't deleted.** | An authoring path exists (a seed/upsert script or an in-product editor). Then rewrite the mechanics against it and move this back. |

Decisions #18 and #19 in [`product-docs/docs-audit-2026-07.md`](../../../product-docs/docs-audit-2026-07.md).

`work-in-progress` was **not** archived here — it was deleted. Its workflow actively contradicted
`ops/agent-os/dod.md` (its Risk Gate halts high-risk work; the delivery OS ships high-risk to a PR
behind the HR4 lens gate), and a contradicting skill is worse than none. The one part worth keeping,
its memory-maintenance discipline, was extracted to `.claude/skills/memory-maintenance/`.
