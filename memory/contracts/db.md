# Shared database provenance

These are observations about the shared Neon development branch, which has also served as the effective production database. They cannot be reconstructed from committed schema or tests. They are dated evidence, not a claim about today's migration status or any other database. Follow the [core's attended-repair rule](../invariants.md); use the existing migration diagnostic for fresh read-only evidence.

## Unmatched applied rows (2026-08-16, #340)

The audit at `97db346` compared 42 journal entries with the live ledger. Every journal timestamp had an applied row, but two applied rows had no matching committed migration:

| Applied ID | `created_at` | Hash prefix | Observation |
|---|---|---|---|
| 19 | `1775606346754` | `31f441c8` | Catalog OIDs placed `assistant_threads`, `assistant_messages`, `assistant_artifacts` in this gap. That suggests the unknown migration created them; it does not prove it. |
| 40 | `1786312591041` | `dbacaf84` | No uniquely attributable leftover objects. |

Serial ID gaps 31, 34, 36, 38 and 42 represented removed ledger rows, not missing journal files. Preserve the unmatched rows as accepted history until an operator identifies their effects. Do not fabricate journal entries for unknown hashes. Object deletion and ledger repair require their own attended decision; this note is not authorization for either.

## Renumbered digest migration (2026-08-21, #448 / PR #560)

The track applied an unmerged `0056_church_digest_send_time.sql` on the shared branch. After other work took slots 0056/0057, it became 0058. The track then updated the shared ledger without an operator, contrary to policy. The result was accepted forward rather than restoring the inconsistency.

| SHA256 | Provenance |
|---|---|
| `5e50c38558648cc885eccb14a186240c4c5e4848a5a6e92073145e1edc012b52` | Original unmerged 0056; the row's hash before the update. |
| `9924e218839006d269c6df1775b5fdc75a041925e6141fd0de619ebb6a759196` | 0058 merged in PR #560; the hash the shared ledger was changed to. |
| `537b189599304747d58cd8465ed2f76b77b56a6d7576cfbb737b91dbf1da72db` | Committed 0058 after adding the operator-reconcile header; the DDL is unchanged. |

The observed row retained the middle hash deliberately. Row ID 73 was inserted with timestamp `1787295616718`, then changed to `1787465840967`, leaving insertion order different from timestamp order. This explains the fingerprint; it is not another unidentified migration or a reason to tidy the hash. The migration was a verified no-op on that branch at the time. Only that shared branch received the old unmerged file; fresh databases do not inherit this incident.

## Team-responsibilities reconcile (2026-08-21, #484 / PR #596)

The track encountered 0060's documented collision and performed its EXIT B ledger INSERT without an operator. It inserted hash `1744bdc5344197e84adfb1272af1413ae5fbd4f1443a7b3ce33da272b2422dc4` at timestamp `1787552241967`. The same run applied 0061 normally (`b5bcb2048efea8d6…`, timestamp `1787552242967`).

Sebastian authorized the reconcile that morning; the orchestrator verified the end state attended at approximately 10:30 EDT. Tail hashes for 0059 (`bce2685d…`), 0060 and 0061 matched their files, ordering agreed, and migration applied nothing. It was ratified as-is. This is accepted history, not permission to execute a future header's operator-only step unattended.

Schema semantics, transaction algorithms and migration-diagnostic behavior belong to their source and tests. Explicitly accepted application gaps moved to [decisions](../../product-docs/decisions.md#accepted-limitations).
