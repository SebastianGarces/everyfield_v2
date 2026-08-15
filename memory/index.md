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

There is **no size cap** (ruled 2026-08-15). The byte budget was removed because it had become a tax on every unrelated pass: it was re-pinned four times in two days, and each raise cost a compression negotiation that bought wording back rather than removing a rule. Size is still a real cost — `memory/` is read before source on almost every pass — so the discipline that made the cap work stays, now as review rather than as a test: **each rule is 1–3 sentences**, the *why* that is not derivable from source goes down into `memory/invariants/<domain>.md`, and nothing here mirrors what the source already says. Maintenance is part of the REVIEWED gate — see `ops/agent-os/dod.md` § Memory.
