# Archived skills

Skills that were live and are no longer loaded. They live **outside `.claude/skills/`** so no agent
can reach them, and are kept in the repo because their content is still worth something — usually
guidance that outlived the mechanics it was wrapped around.

Deleting them outright would lose that; leaving them in `.claude/skills/` would leave agents
following instructions that cannot be carried out.

| Skill | Archived | Why | Revive when |
|-------|----------|-----|-------------|
| `wiki-articles` | 2026-07-26 | Its workflow writes MDX to a repo-root `wiki/` directory that was deleted when articles moved into the database (`scripts/migrate-wiki-to-db.ts`, commit `6f9445a`). There is no DB-era authoring path at all — only that one-time migration script — so the skill cannot be reworked, only paused. **The article style guidance is still good and is the reason this wasn't deleted.** | An authoring path exists (a seed/upsert script or an in-product editor). Then rewrite the mechanics against it and move this back. |

Decisions #18 and #19 in [`product-docs/docs-audit-2026-07.md`](https://github.com/SebastianGarces/everyfield_v2/blob/1e47e1c503fd3a14432d43366b161a3c523f9d78/product-docs/docs-audit-2026-07.md).

`work-in-progress` was **not** archived here — it was deleted. Its workflow actively contradicted
the delivery process (its Risk Gate halted work that the process allowed),
and a contradicting skill is worse than none. The one part worth keeping, its memory-maintenance
discipline, now lives in `memory/index.md`.
