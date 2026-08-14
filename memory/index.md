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

Size budget, enforced by test: `invariants.md` ≤ 50 KB, the whole tree ≤ 140 KB. Maintenance is part of the REVIEWED gate — see `ops/agent-os/dod.md` § Memory.
