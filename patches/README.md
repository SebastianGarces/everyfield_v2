# Eve 0.63 conversation compaction recovery

`eve@0.63.0.patch` changes only the shipped `dist/src/harness/tool-loop.js`. Eve ships this file minified, so the textual patch is larger than its semantic change.

Before this patch, both catch-path checks call `throwIfCompactionFailed()` before cancellation or recoverable model-error handling. A failure during a summary call therefore terminates a conversation instead of allowing a user retry.

The patch replaces that helper with `recoverCompactionFailure()`:

```js
if (compactionFailure === undefined) return null;
if (mode === "task" || !emit) throw compactionFailure.error;
const message = toErrorMessage(compactionFailure.error);
// Record the existing telemetry/log error, then use Eve's native failure event.
emissionState = await emitRecoverableFailedTurn(emit, emissionState, {
  code: "COMPACTION_FAILED",
  continuationToken: session.continuationToken,
  details: { errorId },
  message,
});
return {
  next: null,
  session: setHarnessEmissionState({
    ...session,
    history: validateHarnessModelMessages(preCompactionWorkingHistory),
    outputSchema: undefined,
  }, emissionState),
  settledTurn: { isError: true, output: message },
};
```

Both callers check cancellation and active steering first, await the helper, and return its parked result if present. Inside the helper, a recorded compaction failure invokes native `GenerationSteering.begin()` before recovery. This processes pending steering with Eve's existing `outputStarted` and `effectsStarted` protections. Only a real `interrupted` state uses the existing `finishSteeredStep()` path. Already-visible output cannot be retroactively discarded. All other error handling is unchanged. The working history includes the current user prompt that had not yet been committed to `session.history`; no summary or replacement user input is invented. Compaction itself and its retry policy are unchanged.

No application-specific budget sentinel is embedded in Eve. EveryField maps only its exact sentinel to processing-limit copy; ordinary compaction errors retain generic retry copy. Task mode and cancellation keep their previous semantics.

Rerun `node scripts/evry-eve-compaction-recovery.test.mjs` or the `.test.ts` wrapper included in the ordinary suite. This uses the installed pinned dependency, native conversation loop and native compaction code with a scripted provider. It verifies budget exhaustion inside a multi-call compaction, an independent provider failure, retained history, one failed turn, no automatic retries, successful explicit Retry, task-mode failure and cancellation before/during compaction. The compiled processing-budget test separately proves durable application state across provider failures and replay.

Remove this patch only after an upstream version passes those same tests. `pnpm-workspace.yaml` declares it, and `pnpm-lock.yaml` pins its hash.
