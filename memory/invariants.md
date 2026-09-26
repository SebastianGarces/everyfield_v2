# Core memory

Read this file before editing. Then load only the relevant decision topic or operational note from [the index](index.md), alongside the implementation and tests. There is no requirement to read all memory or every decision.

- Product intent comes from the [current decisions](../product-docs/decisions.md), requirements and Launch Playbook. Code establishes behavior; it does not authorize a different consent model, methodology or scope. Record intentional changes to those decisions.
- The shared Neon development branch has also held the effective production database. A development label or passing seed sentinel does not establish that a database is disposable. Identify the target before destructive work; use an owned or throwaway database for destructive proofs.
- Migration-ledger diagnosis is read-only. Repairs to `drizzle.__drizzle_migrations` are attended operator work, not an automatic response to migration failure. Unknown applied rows are accepted history until their effects are identified. Do not invent journal entries or remove rows to make a comparison look clean. [Database provenance](contracts/db.md) records facts unavailable from the repository.
- Retiring code does not authorize deleting its stored data or rewriting applied migrations. The Evry retirement expressly preserves historical data and migrations; see [scope decisions](../product-docs/decisions.md#scope-and-release).

Keep only cross-cutting intent and operational facts absent from source/tests here. Mechanics, schema mirrors, test inventories and resolved bug narratives stay in their existing source, tests or Git history.
