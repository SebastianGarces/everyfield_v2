# Memory index

Read [core memory](invariants.md) before editing. Then select the topic relevant to the change; do not read all memory or the entire decision register by default.

| Question | Read |
|---|---|
| Product scope, deferred work, Evry retirement | [Scope and release](../product-docs/decisions.md#scope-and-release) |
| Seats, coaching, discovery, invitations | [Authority and invitations](../product-docs/decisions.md#authority-and-invitations) |
| Consent, sharing, oversight, personal data | [Privacy and oversight](../product-docs/decisions.md#privacy-and-oversight) |
| Playbook, phases, intelligence, tasks | [Planting methodology](../product-docs/decisions.md#planting-methodology-and-intelligence) |
| Settings, onboarding, design, local schedules | [Experience and scheduling](../product-docs/decisions.md#experience-and-scheduling) |
| Why a known gap remains | [Accepted limitations](../product-docs/decisions.md#accepted-limitations) |
| Local preview setup, disposable services and cleanup | [Local previews](../ops/local-previews.md) |
| Shared database migration-ledger anomalies | [Database provenance](contracts/db.md) |
| How a feature works | Its source and tests; no memory mirror |
| Former invariant sections cited in older source/migration comments | [Historical invariants](https://github.com/SebastianGarces/everyfield_v2/blob/ddcb9129aa8a4d18b3e1d3e5a56828edc2419674/memory/invariants.md), not current instructions |

Update product intent in the owning decision entry and requirements in the same change. Put only external operational facts in memory; remove them when superseded. Behavior already established by code or tests needs no parallel prose contract. The short core has no byte quota, but it is not an inventory of every rule. Historical wording remains in Git.
