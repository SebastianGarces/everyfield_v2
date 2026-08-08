# Memory Index

Memory holds what the code cannot tell you: invariants, rulings, and architectural intent.
For everything else, the source is the source of truth — read it directly.

| File | Purpose |
|------|---------|
| [invariants.md](invariants.md) | Every rule that must not be violated, one line each — **read before any mutation** |
| [invariants/](invariants/) | Per-domain elaboration behind those one-liners: the why, the pattern, worked examples. Read the domain file matching the files you are touching |
| [entrypoints.md](entrypoints.md) | Conventions for finding where flows start |
| [contracts/api.md](contracts/api.md) | Non-obvious route behaviors (cron, webhooks, tokened routes) |
| [contracts/db.md](contracts/db.md) | Non-obvious column semantics + migration rules |
| [contracts/config.md](contracts/config.md) | Env vars (incl. ones missing from `.env.example`) and constants |
| [contracts/data-patterns.md](contracts/data-patterns.md) | Client/server data sync conventions |
| [flows/auth.mmd](flows/auth.mmd) | Authentication flow |
| [flows/person-status.mmd](flows/person-status.mmd) | Person status progression flow |
| [flows/wiki-article.mmd](flows/wiki-article.mmd) | Wiki article retrieval |
| [flows/request-lifecycle.mmd](flows/request-lifecycle.mmd) | Dashboard request lifecycle |

Maintenance workflow (DoD gate G4): `.claude/skills/memory-maintenance/SKILL.md`.
