# 393 — what does unticking an offer mean?

Throwaway prototype for the spec-question hold on PR #393.

```
pnpm tsx prototypes/393-partial-accept-finality/cli.ts
```

`1`–`5` replay a scenario through all four directions at once. `f` is free play:
`move`, `open phone`, `import a,b`, `notnow`, `totals`.

Nothing here imports the app. `directions.ts` re-implements only the answer
bookkeeping of `src/lib/tasks/phase-prompt.ts`, over the real phase-2 catalog
(9 + 7 + 6 tasks), so the awkward cases can be operated rather than imagined.

Delete this directory when the ruling is applied.
