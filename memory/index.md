# Memory Index

Memory holds what the code cannot tell you: invariants, rulings, and architectural intent. It deliberately does NOT mirror schemas, routes, file layouts or test names — the source is faster and never stale.

| File | Purpose |
|------|---------|
| [invariants.md](invariants.md) | Every rule, one line each — **read before any mutation** |
| [invariants/](invariants/) | Per-domain why and worked examples; read the file matching what you touch |
| [entrypoints.md](entrypoints.md) | Where flows start |
| [contracts/api.md](contracts/api.md) | Non-obvious route behaviours (cron, webhooks, tokened routes) |
| [contracts/db.md](contracts/db.md) | Non-obvious column semantics and migration rules |
| [contracts/config.md](contracts/config.md) | Env vars (incl. ones absent from `.env.example`) and constants |
| [contracts/data-patterns.md](contracts/data-patterns.md) | Client/server data-sync conventions |

Size budget, enforced by test: `invariants.md` ≤ 65 KB, the whole tree ≤ 181 KB (the tree re-pinned 2026-08-15 for the `email_suppressions` (#324) and `meeting_responses` (#98) contracts; `invariants.md` re-pinned the same day, after a 1.8 KB compression pass over ~45 lines, for the nine rules those two features and the shared dispatcher deadline establish — the cap governs rule LENGTH, never rule count). Maintenance is part of the REVIEWED gate — see `ops/agent-os/dod.md` § Memory.
