# Complete history notes in one composition

`historyNotesExample` is an executable cookbook candidate, not an installed tool, runtime reader or agent instruction. Its test runs the generated program inside the existing QuickJS sandbox with the production input schema and artifact projector. The host registry is an in-memory double, not a database or authentication proof.

Use the pattern when the answer needs every matching history record and the full recorded notes. Validate a list query first. Keep that base query unchanged, follow `Next page cursor` through its record pages, and then read the returned note offsets for the exact records that need more text. Records sharing an offset fit in one bounded `recordIds` call. A continuation retains the original resource, cohort, date basis, date window, author, text and latest-record policy. It does not repeat a search for a word after collecting the full history.

The example returns each record once with full notes, original source link and non-note facts, including entry timestamps. Native result references remain separate and unchanged. It does not fabricate a combined result-card reference or classify which notes express concern. That judgment remains the model's work over the retrieved content.

The independent 53-record fixture puts long notes on records 52 and 53. Its sequence is:

1. First 50 records.
2. Remaining three records.
3. Both long notes at character offset 240.
4. The longer note at offset 480.

The test compares every ID and full-content SHA256 against the original fixture data, including Unicode characters, and checks that entry times and filters survive. It also reproduces the captured missing-`result` rejection with zero host invocations.

## Bounds and limitations

- At most 24 calls in the program, matching the existing runner. It returns `complete: false` with `call_limit` before attempting a 25th call. Record and note work can both stop partially.
- Calls are serial inside this small example. Active dispatch is therefore one, below the existing four-call cap. Parallelizing independent note batches is possible later, but is unnecessary for the observed two-record continuation.
- The existing shared 48-call turn budget, 15-second deadline, memory and payload ceilings still apply. A smaller remaining turn budget or timeout terminates the runner with its normal failure rather than a false complete answer.
- This program detects changed totals, duplicate record IDs, mismatched note offsets/lengths, changed record metadata and missing continuation records. Separate reads are not an atomic database snapshot. A same-length note edit with unchanged exposed metadata between requests is not detectable here. Do not claim point-in-time consistency.
- `complete` describes the selected query, not all assessments everywhere. It does not prove the user chose the correct scope, that missing records never existed, or that a score threshold establishes a concern.
- Complete output can still exceed the existing result-byte limit. The runner must reject it. There is no byte-limit bypass or silent truncation.
- No runtime module imports the example. Adopting it needs a deliberate cookbook integration and a later metered model test. The deterministic four-call result alone does not establish a latency improvement.

Unpaid command, from the repository root:

```sh
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused RESEND_API_KEY=re_isolated_no_send node --import tsx --test src/lib/evry/eve/composition/history-notes.example.test.ts
```
