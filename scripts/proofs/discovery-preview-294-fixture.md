# Discovery 294 offline preview fixtures

This generator prepares review artifacts. It imports only Node built-ins, reads local JSON, and writes files. It does not connect to a database, start a browser, create sessions, hash passwords, send mail, or invoke a provider. Nothing here authorizes applying fixtures or running browser cases.

```sh
node scripts/proofs/discovery-preview-294-fixture.mjs --help
node scripts/proofs/discovery-preview-294-fixture.mjs /private/tmp/root-input.json /private/tmp/discovery294-review
```

Root supplies a unique `run` (8–40 lowercase letters/digits/hyphens), controlled `emailDomain`, existing application-compatible Argon2id PHC `passwordHash`, and two distinct cryptographically random 32-byte hexadecimal strings in `seatTokens.associated` and `seatTokens.empty`. Optional `seatTokenHashes` are checked against SHA-256. The matching plaintext password stays with root. Input and outputs contain credentials or bearer links and must remain private. Output files are created exclusively with mode 0600; use a new output directory for each generation. IDs are deterministic within the unique run; repeated fixture application deliberately fails on collisions.

The generated manifest contains account identities, exact organization IDs/names, the seeded coaching/seat destination plant, three accountless organization-invitation addresses, seat tokens and hashes, pending invitation IDs, and the real corpus slug `getting-started/welcome-to-the-launch-playbook`. The fixture refuses a target without migration 77 or that published global article. It never inserts, edits, or deletes article content. Only personal progress and bookmarks belong to the run.

Artifacts:

- `fixture.sql`: one bounded transaction creating isolated organizations, Owners/Member/foreign control, five discovery accounts, independent associations with audit, three open signup invitation types, response fixtures, seat invitations and personal wiki/coaching state. No session rows or auth bypass flags.
- `manifest.json`: private browser inputs. Additional `accounts.sever` and `accounts.plantOwner` support org removal and canonical seat invitation ownership.
- `baseline-oracle.sql`: read-only assertions that raise on a missing or incorrect baseline.
- `post-safe-oracle.sql`: read-only assertions after **Create plant with sharing ON**, associated-seat refusal, and empty-seat acceptance. Checks associations, all eight privacy toggles, four handoff audits, pending retargeting, canonical people, coaching and wiki state.
- `oracle.sql`: a read-only diagnostic projection without hashes or session tokens.
- `capture.sql`: root-only read-only lookup by exact expected signup emails and transfer actor/name; returns one JSON object containing browser-generated user and plant IDs.
- `cleanup.sql`: bounded transactional cleanup of explicit roots and their FK dependants. No prefix-wide deletes.

Successful signup, organization invitation accept/decline, Leave and org sever currently emit mail. Those cases remain blocked until an actual inert transport exists. An approval flag does not make them safe. The prepared fixtures support reviewing forms, dialogs, invalid confirmation and role restrictions without submitting those successful mutations. Existing-account sign-in, seat and plant operations still require the separate root browser plan and its action audit.

## Capture and cleanup

After browser work has stopped, root can collect `capture.sql` on the approved dedicated target and save its JSON output. Re-run the offline generator with the same input into a **new directory**, passing capture as the third argument:

```sh
node scripts/proofs/discovery-preview-294-fixture.mjs /private/tmp/root-input.json /private/tmp/discovery294-cleanup-review /private/tmp/capture.json
```

Review that directory's cleanup before any root application. Captured signup identities must exactly match the manifest; the transfer plant must be named `<run> Transfer plant` and owned by the exact transfer actor. Other account or plant creation is outside this recipe.

Cleanup locks and verifies every explicit root's ID/name/email, follows actual public-schema foreign keys, refuses uncaptured roots or foreign tenant rows, and caps discovery at 5,000 rows and 40 dependency rounds. It clears only owned users' tenancy links to break the account/plant cycle, then deletes dependent rows before their roots; unexpected FKs abort the whole transaction. Auth-attempt rows are removed only by the exact run emails, never by IP. PostgreSQL timeouts bound each cleanup statement.

The recursive pass may discover unexpected global rows through fields such as `created_by`. Foreign roots/tenants abort rather than expand ownership. Unsupported tables without primary keys, mandatory FK cycles, append-only triggers (including audited Evry tables), and external objects can block cleanup. These browser cases must not create Evry runs, uploads, or other unrelated features. Do not disable triggers, widen predicates, or use `CASCADE` to force cleanup. External provider effects cannot be rolled back by SQL and are prohibited here.

These artifacts have offline generation/syntax checks only. No SQL application or browser/provider execution is part of this preparation.
