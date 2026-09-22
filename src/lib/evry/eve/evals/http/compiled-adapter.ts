import type { ProductionEvalRunner } from "../fixtures/adapter";
import type { EvalPriceCeiling } from "./host";
import { runCompiledEveFixture } from "./process";
import type { CompiledFixtureRequest } from "./process-contract";

type Scenario = Parameters<ProductionEvalRunner>[0]["scenario"];

/** Connect the fixture grader to the actual compiled HTTP runtime, not its in-process registry. */
export function createCompiledEveEvalRunner(options: {
  compiledEntry: string;
  databaseUrl: string;
  proxyUrl: string;
  prices: EvalPriceCeiling;
  model(scenario: Scenario): CompiledFixtureRequest["model"];
  timeoutMs?: number;
  onOutcome?(outcome: Awaited<ReturnType<typeof runCompiledEveFixture>>): void;
}): ProductionEvalRunner {
  return async ({
    scenario,
    actor,
    sessionToken,
    now,
    signal,
    maxCostUsd,
    attachments,
  }) => {
    const outcome = await runCompiledEveFixture(
      {
        compiledEntry: options.compiledEntry,
        databaseUrl: options.databaseUrl,
        proxyUrl: options.proxyUrl,
        sessionToken,
        actor: { userId: actor.userId, plantId: actor.plantId },
        turns: [...scenario.turns],
        attachments,
        now: now.toISOString(),
        maxCostUsd,
        prices: options.prices,
        model: options.model(scenario),
        timeoutMs: options.timeoutMs,
      },
      signal
    );
    options.onOutcome?.(outcome);
    return outcome;
  };
}
