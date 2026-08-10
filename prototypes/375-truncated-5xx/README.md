# #375 — how should a 5xx ladder cut short by the run deadline surface?

`runPacedCall` rethrows a 5xx **as itself** when the run deadline is spent
(`paced-call.ts:256-261`). `route.ts` sees a non-deferral, logs
`console.error("assessment failed for church …")` and records
`{status: "failed", attempted: true}` with no `deferralReason`.

On `main`, `failed` always meant one thing: the retry ladder was exhausted against a
genuinely broken provider. After this track, `failed` can **also** mean "the run ran out
of wall clock while the provider was 5xx-ing", after a single attempt. Nothing
distinguishes the two — same status, same `console.error`, same bare error string, no
`deferralReason`, and `deferredUnattempted` does not cover it because it is not a
deferral at all. The 429 side of the same deadline test routes to
`{status: "deferred", deferralReason: "time_budget"}` precisely so it does not read as a
broken judge.

So a run truncated by its own budget can report `failed: 3` and three ERROR lines at
07:00 UTC. That is exactly the readability property #374 was filed about. No AC ruled on
it; the decision currently lives in a code comment.

**Data safety is not at stake under any direction** — rollover is identical for `failed`
and `deferred`, so no snapshot is lost either way. This is purely a question of what the
Actions log tells a human at 7am.

Run it:

```bash
pnpm tsx prototypes/375-truncated-5xx/cli.ts
```

Direction **A** is the code as it stands in this PR, so every other direction is graded
against it. Same plant events replay through all four on a keypress.
