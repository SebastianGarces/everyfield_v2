import type {
  CaseResult,
  EvalQuestion,
  Expectations,
  Regression,
} from "./contract";
import { gradeObservation, summarizeResults } from "./grade";

type Scenario = EvalQuestion | Regression;
export type FixtureSession = Readonly<{
  expectations: Expectations;
  // Must run the production Eve path with fixture-bound domain services.
  run(input: {
    scenario: Scenario;
    signal: AbortSignal;
    maxCostUsd: number;
  }): Promise<unknown>;
  cleanup(): Promise<void>;
}>;
export type EvalAdapter = Readonly<{
  // null is BLOCKED, not a skip or successful empty answer.
  prepare(scenario: Scenario): Promise<FixtureSession | null>;
}>;

export async function runEvalSuite(input: {
  scenarios: readonly Scenario[];
  adapter: EvalAdapter;
  budgetUsd: number;
  maxCaseCostUsd: number;
  caseTimeoutMs?: number;
  repetitions?: number;
  onResult?: (result: CaseResult) => void | Promise<void>;
}) {
  const repetitions = input.repetitions ?? 1;
  const timeoutMs = input.caseTimeoutMs ?? 60_000;
  if (
    !Number.isFinite(input.budgetUsd) ||
    input.budgetUsd <= 0 ||
    !Number.isFinite(input.maxCaseCostUsd) ||
    input.maxCaseCostUsd <= 0 ||
    input.maxCaseCostUsd > input.budgetUsd ||
    !Number.isInteger(repetitions) ||
    repetitions < 1 ||
    repetitions > 10 ||
    !Number.isInteger(timeoutMs) || timeoutMs <= 0
  ) {
    throw new Error(
      "An explicit positive total/per-case budget and 1–10 repetitions are required"
    );
  }
  const results: CaseResult[] = [];
  // Reserve the maximum BEFORE dispatch; never assume an interrupted provider call was free.
  let remaining = input.budgetUsd;
  let fixtureFailure: string | null = null;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const scenario of input.scenarios) {
      let result: CaseResult;
      if (fixtureFailure) {
        result = { id: scenario.id, status: "not_run", failures: [fixtureFailure] };
      } else if (remaining + Number.EPSILON < input.maxCaseCostUsd) {
        result = {
          id: scenario.id,
          status: "not_run",
          failures: ["budget_exhausted"],
        };
      } else {
        let fixture: FixtureSession | null = null;
        try {
          fixture = await input.adapter.prepare(scenario);
        } catch {
          // A partially created fixture may no longer be isolated. Do not run
          // another case against that database or lose the report to a throw.
          fixtureFailure = "fixture_setup_failed";
        }
        if (!fixture) {
          result = {
            id: scenario.id,
            status: "blocked",
            failures: [fixtureFailure ?? "fixture_not_bound"],
          };
        } else {
          remaining -= input.maxCaseCostUsd;
          const signal = AbortSignal.timeout(timeoutMs);
          try {
            const observation = await fixture.run({
              scenario,
              signal,
              maxCostUsd: input.maxCaseCostUsd,
            });
            result = gradeObservation(
              scenario.id,
              fixture.expectations,
              observation
            );
            if (
              result.observation &&
              result.observation.costUsd > input.maxCaseCostUsd
            ) {
              result = {
                ...result,
                status: "failed",
                failures: [...result.failures, "case_budget_exceeded"],
              };
              remaining = 0;
            }
          } catch {
            result = {
              id: scenario.id,
              status: "failed",
              failures: [signal.aborted ? "timeout" : "execution_error"],
            };
          }
          try {
            await fixture.cleanup();
          } catch {
            fixtureFailure = "fixture_cleanup_failed";
            result = { ...result, status: "failed", failures: [...result.failures, fixtureFailure] };
          }
        }
      }
      results.push(result);
      await input.onResult?.(result);
    }
  }
  return {
    results,
    summary: summarizeResults(results),
    reservedUsd: input.budgetUsd - remaining,
  };
}
