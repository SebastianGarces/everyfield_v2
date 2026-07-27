# Memory Index

## Contents

| File | Purpose |
|------|---------|
| [entrypoints.md](entrypoints.md) | Where each flow starts |
| [invariants.md](invariants.md) | Rules that must not be violated |
| [contracts/api.md](contracts/api.md) | API routes and actions |
| [contracts/db.md](contracts/db.md) | Database schema |
| [contracts/config.md](contracts/config.md) | Environment and config |
| [contracts/data-patterns.md](contracts/data-patterns.md) | Client/server data sync patterns |
| [flows/auth.mmd](flows/auth.mmd) | Authentication flow |
| [flows/person-status.mmd](flows/person-status.mmd) | Person status progression flow |
| [flows/wiki-article.mmd](flows/wiki-article.mmd) | Wiki article retrieval |
| [flows/request-lifecycle.mmd](flows/request-lifecycle.mmd) | Dashboard request lifecycle |

## Reading Order

1. **entrypoints.md** — always start here
2. **Relevant flow diagram** — visual understanding
3. **Relevant contract** — interface details
4. **invariants.md** — before any mutation

Memory alone is enough for architecture, picking which files to change, checking invariants, and reading contracts. Open source only when memory lacks the specific detail, when editing a specific function, or when debugging. Full rules: `.agents/memory-first.md`.
