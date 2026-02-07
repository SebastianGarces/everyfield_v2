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
| [flows/wiki-article.mmd](flows/wiki-article.mmd) | Wiki article retrieval |
| [flows/request-lifecycle.mmd](flows/request-lifecycle.mmd) | Dashboard request lifecycle |

## When Memory Suffices

Use memory alone when:
- Understanding high-level architecture
- Identifying which files to modify
- Checking invariants before making changes
- Understanding data flow between components
- Reviewing API contracts

## When to Open Code

Open source files when:
- Memory references a file but lacks needed detail
- Implementing changes to specific functions
- Debugging unexpected behavior
- Memory explicitly says "see source for implementation"

## Reading Order

1. **entrypoints.md** - Always start here
2. **Relevant flow diagram** - Visual understanding
3. **Relevant contract** - Interface details
4. **invariants.md** - Before any mutation
