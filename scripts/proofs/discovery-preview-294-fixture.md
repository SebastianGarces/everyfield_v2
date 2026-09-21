# Discovery 294 offline preview fixtures

This generator prepares review artifacts. It imports only Node built-ins, reads local JSON, and writes files. It does not connect to a database, start a browser, create sessions, hash passwords, send mail, or invoke a provider. Sebastian has explicitly authorized use of the existing development database, excluding production and customer data. Root retains execution; this generator itself does not apply fixtures or run browser cases. Existing unrelated records are allowed and must remain untouched.

```sh
node scripts/proofs/discovery-preview-294-fixture.mjs --help
node scripts/proofs/discovery-preview-294-fixture.mjs /private/tmp/root-input.json /private/tmp/discovery294-review
```

Root supplies a unique `run` (8–40 lowercase letters/digits/hyphens), controlled `emailDomain`, existing application-compatible Argon2id PHC `passwordHash`, and two distinct cryptographically random 32-byte hexadecimal strings in `seatTokens.associated` and `seatTokens.empty`. Optional `seatTokenHashes` are checked against SHA-256. The matching plaintext password stays with root. Input and outputs contain credentials or bearer links and must remain private. Output files are created exclusively with mode 0600; use a new output directory for each generation. IDs are deterministic within the unique run; repeated fixture application deliberately fails on collisions.

The generated manifest contains account identities, exact organization IDs/names, the seeded coaching/seat destination plant, three accountless organization-invitation addresses, seat tokens and hashes, pending invitation IDs, and the real corpus slug `getting-started/welcome-to-the-launch-playbook`. The fixture refuses a target without the exact committed migration 78 ledger hash/stamp, wiki75/discovery77 columns, leadership guard table, or that published global article. It never inserts, edits, or deletes article content. Only personal progress and bookmarks belong to the run.

Artifacts:

- `fixture.sql`: one bounded transaction creating isolated organizations, Owners/Member/foreign control, five discovery accounts, independent associations with audit, three open signup invitation types, response fixtures, seat invitations and personal wiki/coaching state. No session rows or auth bypass flags.
- `manifest.json`: private browser inputs. Additional `accounts.sever` and `accounts.plantOwner` support org removal and canonical seat invitation ownership.
- `baseline-oracle.sql`: read-only assertions that raise on a missing or incorrect baseline.
- `post-safe-oracle.sql`: read-only assertions after **Create plant with sharing ON**, associated-seat refusal, and empty-seat acceptance. Checks associations, all eight privacy toggles, four handoff audits, pending retargeting, canonical people, coaching and wiki state.
- `oracle.sql`: a read-only diagnostic projection without hashes or session tokens.
- `capture.sql`: root-only read-only lookup by exact expected signup emails and transfer actor/name; returns one JSON object containing browser-generated user and plant IDs.
- `cleanup.sql`: bounded transactional cleanup of explicit roots and their FK dependants. No prefix-wide deletes.

Successful signup, organization invitation accept/decline, Leave and org sever emit mail. Root may prepare those cases using the SDK's `RESEND_BASE_URL` pointed at a root-owned capture-only endpoint, but must independently verify every sending path reaches that endpoint and block external provider egress before execution. A configured variable or approval flag alone is not proof of isolation. No production provider calls are authorized. Capture contents are private fixture data. Existing-account sign-in, seat and plant operations still require the separate root browser plan and its action audit.

## Per-step read-only assertion interface

Manifest version **2** exposes `oracles`, mapping runner step keys to filenames. Execute the selected file using the externally supplied scoped `pg` driver inside a root-owned **read-only transaction**. The files have only `DO` assertions and reads, no transaction wrappers or mutations. Any failed expectation raises an exception.

| Key | Filename | Expected phase |
| --- | --- | --- |
| schema | `00-schema.sql` | Before fixture application; exact 78 hash/stamp and required schema |
| baseline | `01-baseline.sql` | After fixtures, before browser; verifies only run-owned state, existing users allowed |
| signup1 | `02-signup1.sql` | Sending church's open invitation accepted as Discovery |
| signup2 | `03-signup2.sql` | Network plant invitation accepted as Discovery |
| signup3 | `04-signup3.sql` | Network sending-church invitation accepted as Discovery |
| accept | `05-accept.sql` | Lifecycle account accepts network invitation |
| decline | `06-decline.sql` | Same account declines sending-church invitation; network remains |
| leave | `07-leave.sql` | Same account leaves network |
| sever | `08-sever.sql` | Network Owner removes separate `accounts.sever` association |
| transfer | `09-transfer.sql` | Transfer account creates named plant with sharing ON |
| associatedSeat | `10-associated-seat.sql` | Associated discovery account's seat invitation remains refused |
| emptySeat | `11-empty-seat.sql` | Empty discovery account accepts its seat invitation |

Signup assertions check account identity, no seat/tenancy/person, correct bound invitation, one audit and preserved run-owned plant/organization identities. It does not impose database-wide user or organization counts. Lifecycle assertions check actual profile state, responses and correctly attributed audits. The final three phases are independent and may run in seat-refusal → empty-seat → transfer order. They retain completed wiki state/bookmarks; scroll position is allowed to change through normal article reading. Transfer also checks privacy, handoff audits, pending retarget, person and coaching. The legacy aggregate oracles remain available; the runner should use the indexed map. SQL proves persistence; root separately checks capture-only mail events and UI results.

## Capture and cleanup

After browser work has stopped, root can collect `capture.sql` on the authorized development target and save its JSON output. Re-run the offline generator with the same input into a **new directory**, passing capture as the third argument:

```sh
node scripts/proofs/discovery-preview-294-fixture.mjs /private/tmp/root-input.json /private/tmp/discovery294-cleanup-review /private/tmp/capture.json
```

Review that directory's cleanup before any root application. Captured signup identities must exactly match the manifest; the transfer plant must be named `<run> Transfer plant` and owned by the exact transfer actor. Other account or plant creation is outside this recipe.

Before deletion, cleanup looks up and locks users at all three exact signup emails. Every account found must have a captured `users` root matching its actual ID, name and email; missing or mismatched capture aborts before deleting profiles or invitations. This guard is independent of FK traversal, so seatless signup accounts cannot be missed.

Cleanup locks and verifies every explicit root's ID/name/email, follows actual public-schema foreign keys, refuses uncaptured roots or foreign tenant rows, and caps discovery at 5,000 rows and 40 dependency rounds. It clears only owned users' tenancy links to break the account/plant cycle, then deletes dependent rows before their roots; unexpected FKs abort the whole transaction. Auth-attempt rows are removed only by the exact run emails, never by IP. PostgreSQL timeouts bound each cleanup statement.

The recursive pass may discover unexpected global rows through fields such as `created_by`. Foreign roots/tenants abort rather than expand ownership. Unsupported tables without primary keys, mandatory FK cycles, append-only triggers (including audited Evry tables), and external objects can block cleanup. These browser cases must not create Evry runs, uploads, or other unrelated features. Do not disable triggers, widen predicates, or use `CASCADE` to force cleanup. External provider effects cannot be rolled back by SQL and are prohibited here.

These artifacts have offline generation/syntax checks only. No SQL application or browser/provider execution is part of this preparation.

Run the dependency-free offline regression with `node --test scripts/proofs/discovery-preview-294-fixture.test.mjs`. It verifies empty/complete capture output, refusal guards before deletion, exact-email predicates and rejection of foreign capture inputs. These are generated-SQL checks, not evidence that cleanup has executed or preserved rows in a live database; root owns that SQL proof.
