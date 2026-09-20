import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  FixtureIdentity,
  FixtureModelParams,
  FixtureModel,
  FixtureRunHooks,
  IsolatedFixtureHost,
} from "../../runtime/fixture-bridge";

export type HostCapture = {
  calls: Array<{ id: string; name: string; input: unknown; output: unknown }>;
  presented: string[];
  freshAuthorizations: number;
  refusedAuthorizations: number;
  outboundMessages: number;
  costUsd: number;
  costBasis: "provider_usage" | "reserved_upper_bound";
};
const loopback = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
const priceSchema = z.strictObject({
  inputUsdPerMillion: z.number().positive(),
  outputUsdPerMillion: z.number().positive(),
  maxInputBytes: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
export type EvalPriceCeiling = z.infer<typeof priceSchema>;

export function assertIsolatedFixtureTarget(
  origin: string,
  databaseUrl: string
) {
  const target = new URL(origin);
  const database = new URL(databaseUrl);
  if (
    process.env.VERCEL ||
    target.protocol !== "http:" ||
    !loopback(target.hostname) ||
    !loopback(database.hostname) ||
    database.pathname !== "/eve_fixture" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  )
    throw new Error(
      "Evaluations require a loopback-only, non-Vercel isolated process"
    );
}

/** Process-local fixture observer. Never installed by production application code. */
export function installIsolatedFixtureHost(config: {
  origin: string;
  databaseUrl: string;
  allowPaidProviderCalls?: true;
  scriptedModel?: FixtureModel;
  onTurnInput?: (text: string) => void;
}) {
  assertIsolatedFixtureTarget(config.origin, config.databaseUrl);
  if (process.env.DATABASE_URL !== config.databaseUrl)
    throw new Error(
      "Isolated fixture database must match the runtime database"
    );
  if (globalThis.__everyfieldIsolatedEveFixtureHost)
    throw new Error("A fixture host is already installed");
  const runs = new Map<
    string,
    {
      identity: FixtureIdentity;
      hooks: FixtureRunHooks;
      capture: HostCapture;
      stop: () => void;
    }
  >();
  const host: IsolatedFixtureHost = {
    run(identity) {
      const run = runs.get(identity.appSessionId);
      if (
        !run ||
        run.identity.userId !== identity.userId ||
        run.identity.plantId !== identity.plantId
      )
        throw new Error("Unregistered isolated evaluation identity");
      return run.hooks;
    },
  };
  globalThis.__everyfieldIsolatedEveFixtureHost = host;
  const originalFetch = globalThis.fetch;
  let outboundMessages = 0;
  const guardedFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    if (
      !loopback(url.hostname) &&
      !(
        config.allowPaidProviderCalls && url.origin === "https://api.openai.com"
      )
    ) {
      if (url.hostname === "api.resend.com") outboundMessages++;
      return Promise.reject(
        new Error("Isolated evaluation outbound request blocked")
      );
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = guardedFetch;
  return {
    register(input: {
      sessionToken: string;
      userId: string;
      plantId: string;
      now: Date;
      maxCostUsd: number;
      prices: EvalPriceCeiling;
    }) {
      const prices = priceSchema.parse(input.prices);
      if (
        !Number.isFinite(input.maxCostUsd) ||
        input.maxCostUsd <= 0 ||
        !Number.isFinite(input.now.getTime())
      )
        throw new Error("Invalid isolated evaluation limits");
      const appSessionId = createHash("sha256")
        .update(input.sessionToken)
        .digest("hex");
      if (runs.has(appSessionId))
        throw new Error("Fixture session already registered");
      const identity = {
        appSessionId,
        userId: input.userId,
        plantId: input.plantId,
      };
      const capture: HostCapture = {
        calls: [],
        presented: [],
        freshAuthorizations: 0,
        refusedAuthorizations: 0,
        outboundMessages: 0,
        costUsd: 0,
        costBasis: "provider_usage",
      };
      let stopped = false;
      let pending = 0;
      const ceiling =
        (prices.maxInputBytes * prices.inputUsdPerMillion +
          prices.maxOutputTokens * prices.outputUsdPerMillion) /
        1_000_000;
      const hooks: FixtureRunHooks = {
        now: new Date(input.now),
        maxOutputTokens: prices.maxOutputTokens,
        model: config.scriptedModel,
        turnInput(text) {
          config.onTurnInput?.(text);
        },
        authorize(allowed) {
          if (allowed) capture.freshAuthorizations++;
          else capture.refusedAuthorizations++;
        },
        call(call) {
          if (!capture.calls.some((entry) => entry.id === call.id))
            capture.calls.push(structuredClone(call));
        },
        present(reference) {
          if (!capture.calls.some((call) => call.id === reference))
            throw new Error("Unobserved result reference");
          if (!capture.presented.includes(reference))
            capture.presented.push(reference);
        },
        reserve(params: FixtureModelParams) {
          if (stopped) throw new Error("Evaluation has stopped");
          // UTF-8 bytes conservatively bound visible token input; provider-added framing is not billed here.
          const bytes = Buffer.byteLength(
            JSON.stringify({ prompt: params.prompt, tools: params.tools })
          );
          if (
            bytes > prices.maxInputBytes ||
            !params.maxOutputTokens ||
            params.maxOutputTokens > prices.maxOutputTokens
          )
            throw new Error("Generation exceeds evaluation token limits");
          if (capture.costUsd + ceiling > input.maxCostUsd + Number.EPSILON)
            throw new Error("Evaluation budget exhausted before generation");
          capture.costUsd += ceiling;
          pending++;
          capture.costBasis = "reserved_upper_bound";
          let settled = false;
          return {
            finish(inputTokens, outputTokens) {
              if (settled) return;
              settled = true;
              if (
                !Number.isFinite(inputTokens) ||
                !Number.isFinite(outputTokens) ||
                inputTokens < 0 ||
                outputTokens < 0
              ) {
                stopped = true;
                throw new Error("Provider usage unavailable");
              }
              const actual =
                (inputTokens * prices.inputUsdPerMillion +
                  outputTokens * prices.outputUsdPerMillion) /
                1_000_000;
              capture.costUsd += actual - ceiling;
              pending--;
              capture.costBasis = pending
                ? "reserved_upper_bound"
                : "provider_usage";
              if (actual > ceiling || capture.costUsd > input.maxCostUsd) {
                stopped = true;
                throw new Error(
                  "Provider usage exceeded reserved evaluation ceiling"
                );
              }
            },
          };
        },
      };
      runs.set(appSessionId, {
        identity,
        hooks,
        capture,
        stop: () => {
          stopped = true;
        },
      });
      return {
        identity,
        maxOutputTokens: prices.maxOutputTokens,
        snapshot: () => structuredClone({ ...capture, outboundMessages }),
        stop() {
          stopped = true;
        },
        dispose() {
          stopped = true;
          runs.delete(appSessionId);
        },
      };
    },
    close() {
      for (const run of runs.values()) run.stop();
      if (globalThis.__everyfieldIsolatedEveFixtureHost === host)
        delete globalThis.__everyfieldIsolatedEveFixtureHost;
      if (globalThis.fetch === guardedFetch) globalThis.fetch = originalFetch;
      runs.clear();
    },
  };
}
