import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { JevClient } from "../../jev/client";
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
  modelCalls: Array<{
    startedMs: number;
    durationMs: number | null;
    tools: string[];
    assistantTextHistory: Array<{
      phase: "commentary" | "final_answer" | null;
      hasItemId: boolean;
    }>;
    reservedUsd: number;
    inputBytes: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  }>;
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
  routingClient?: JevClient;
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
  const providerReservation = new AsyncLocalStorage<{ dispatched: boolean }>();
  let outboundMessages = 0;
  const guardedFetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    if (!loopback(url.hostname)) {
      const reservation = providerReservation.getStore();
      if (
        config.allowPaidProviderCalls &&
        url.origin === "https://api.openai.com" &&
        reservation &&
        !reservation.dispatched
      ) {
        // One HTTP attempt per prepaid generation. SDK retries must get a fresh reservation.
        reservation.dispatched = true;
        return originalFetch(input, init);
      }
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
        modelCalls: [],
      };
      let stopped = false;
      const started = performance.now();
      let pending = 0;
      let generations = 0;
      let invocations = 0;
      const ceiling =
        ((prices.maxInputBytes + 4096) * prices.inputUsdPerMillion +
          prices.maxOutputTokens * prices.outputUsdPerMillion) /
        1_000_000;
      const hooks: FixtureRunHooks = {
        now: new Date(input.now),
        maxOutputTokens: prices.maxOutputTokens,
        model: config.scriptedModel,
        routingClient: config.routingClient,
        turnInput(text) {
          config.onTurnInput?.(text);
        },
        authorize(allowed) {
          if (allowed) capture.freshAuthorizations++;
          else capture.refusedAuthorizations++;
        },
        call(call) {
          invocations++;
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
          // Reserve one token per UTF-8 byte plus 4096 tokens of provider framing.
          // Unknown/failed usage keeps the reservation; no retry receives it for free.
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
          const call: HostCapture["modelCalls"][number] = {
            startedMs: performance.now() - started,
            durationMs: null,
            tools: (params.tools ?? []).map((tool) => tool.name),
            assistantTextHistory: params.prompt.flatMap((message) =>
              message.role === "assistant"
                ? message.content.flatMap((part) => {
                    if (part.type !== "text") return [];
                    const options = part.providerOptions?.openai;
                    return [
                      {
                        phase:
                          options?.phase === "commentary" ||
                          options?.phase === "final_answer"
                            ? options.phase
                            : null,
                        hasItemId: typeof options?.itemId === "string",
                      },
                    ];
                  })
                : []
            ),
            reservedUsd: ceiling,
            inputBytes: bytes,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
          };
          capture.modelCalls.push(call);
          generations++;
          pending++;
          capture.costBasis = "reserved_upper_bound";
          let settled = false;
          const ticket = { dispatched: false };
          return {
            run: (work) => {
              if (settled || stopped)
                return Promise.reject(
                  new Error("Evaluation reservation is closed")
                );
              return providerReservation.run(ticket, work);
            },
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
              call.inputTokens = inputTokens;
              call.durationMs = performance.now() - started - call.startedMs;
              call.outputTokens = outputTokens;
              call.costUsd = actual;
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
        activity: () => ({ generations, invocations }),
        snapshot: () => structuredClone({ ...capture, outboundMessages }),
        present: hooks.present,
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
