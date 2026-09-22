import {
  experimental_runCodeMode,
  CodeModeToolError,
  type CodeModeExecutionPolicy,
} from "@ai-sdk/code-mode";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

/** Limits are trusted configuration, never fields in the model's tool input. */
export const COMPOSITION_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  memoryLimitBytes: 32 * 1024 * 1024,
  maxStackSizeBytes: 512 * 1024,
  maxResultBytes: 256 * 1024,
  maxConsoleOutputBytes: 4096,
  maxSourceBytes: 32 * 1024,
  maxToolInputBytes: 64 * 1024,
  maxToolOutputBytes: 512 * 1024,
  maxBridgeRequests: 24,
  maxConcurrentToolCalls: 4,
} satisfies Omit<
  Required<CodeModeExecutionPolicy>,
  "maxInFlightBridgeRequests"
> & {
  maxConcurrentToolCalls: number;
});

/** One program owns its slots. Closing never starts queued or late host work. */
function createDispatchQueue(concurrency: number, maxQueued: number) {
  let active = 0;
  let closed = false;
  const waiting: { start(): void; cancel(): void }[] = [];
  const unavailable = () => new Error("Composition dispatch is unavailable.");
  const drain = () => {
    while (!closed && active < concurrency && waiting.length) {
      waiting.shift()?.start();
    }
  };
  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      if (closed || signal?.aborted) return Promise.reject(unavailable());
      return new Promise((resolve, reject) => {
        const request = {
          start() {
            signal?.removeEventListener("abort", request.cancel);
            if (closed || signal?.aborted) {
              reject(unavailable());
              return;
            }
            active += 1;
            let released = false;
            resolve(() => {
              if (released) return;
              released = true;
              active -= 1;
              drain();
            });
          },
          cancel() {
            const index = waiting.indexOf(request);
            if (index >= 0) waiting.splice(index, 1);
            signal?.removeEventListener("abort", request.cancel);
            reject(unavailable());
          },
        };
        if (active < concurrency) request.start();
        else if (waiting.length >= maxQueued) reject(unavailable());
        else {
          waiting.push(request);
          signal?.addEventListener("abort", request.cancel, { once: true });
        }
      });
    },
    close() {
      closed = true;
      for (const request of [...waiting]) request.cancel();
    },
  };
}

export interface CompositionRegistry {
  describe(): readonly {
    name: string;
    description: string;
    inputSchema: z.ZodType;
    effect: "read" | "prepare";
  }[];
  invoke(
    name: string,
    input: unknown,
    invocation: { signal?: AbortSignal; callId: string }
  ): Promise<unknown>;
}

export type CompositionTrace = {
  name: string;
  callId: string;
  status: "started" | "succeeded" | "failed" | "cancelled";
  durationMs: number;
};

export type CompositionBudget = { consume(): void; readonly used: number };

/** Share one instance across every composition in a turn, not one per program. */
export function createCompositionBudget(maxCalls = 48): CompositionBudget {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 48) {
    throw new Error("Composition turn budget must be between 1 and 48 calls.");
  }
  let used = 0;
  return {
    consume() {
      if (used >= maxCalls)
        throw new Error("Composition turn budget exhausted.");
      used += 1;
    },
    get used() {
      return used;
    },
  };
}

export type CompositionOutcome =
  | { status: "completed"; output: unknown; calls: number }
  | {
      status: "failed";
      reason: "invalid_input";
      toolName: string;
      requiredFields: string[];
      calls: number;
    }
  | {
      status: "failed";
      reason: "cancelled" | "limit" | "program_failed";
      calls: number;
    };

/**
 * The SDK runs generated code in QuickJS/WASM, not eval/vm in the app process.
 * The only bridge is this registry. There is no execution/approval continuation.
 */
export async function runEvryComposition(options: {
  js: string;
  registry: CompositionRegistry;
  callId: string;
  budget: CompositionBudget;
  signal?: AbortSignal;
  onCall?: (event: CompositionTrace) => void;
  limits?: Partial<typeof COMPOSITION_LIMITS>;
}): Promise<CompositionOutcome> {
  const policy = { ...COMPOSITION_LIMITS, ...options.limits };
  for (const key of Object.keys(
    COMPOSITION_LIMITS
  ) as (keyof typeof COMPOSITION_LIMITS)[]) {
    if (
      !Number.isSafeInteger(policy[key]) ||
      policy[key] < 1 ||
      policy[key] > COMPOSITION_LIMITS[key]
    ) {
      throw new Error(`Invalid composition limit: ${key}`);
    }
  }
  if (!options.callId.trim())
    throw new Error("Composition requires a trusted call identity.");
  let calls = 0;
  let budgetExceeded = false;
  const concurrency = Math.min(
    policy.maxConcurrentToolCalls,
    policy.maxBridgeRequests
  );
  const maxQueued = Math.min(
    COMPOSITION_LIMITS.maxBridgeRequests -
      COMPOSITION_LIMITS.maxConcurrentToolCalls,
    policy.maxBridgeRequests - concurrency
  );
  const queue = createDispatchQueue(concurrency, maxQueued);
  const tools: ToolSet = Object.create(null);
  const names = new Set<string>();
  const trace = (event: CompositionTrace) => {
    try {
      options.onCall?.(event);
    } catch {
      /* Telemetry never changes product behavior. */
    }
  };
  for (const entry of options.registry.describe()) {
    // Fail closed even if a future or untyped registry accidentally adds a writer.
    if (entry.effect !== "read" && entry.effect !== "prepare")
      throw new Error("Unsafe composition registration.");
    if (names.has(entry.name))
      throw new Error("Duplicate composition registration.");
    names.add(entry.name);
    tools[entry.name] = tool({
      description: entry.description,
      inputSchema: entry.inputSchema,
      execute: async (input, execution) => {
        const started = performance.now();
        const event = { name: entry.name, callId: execution.toolCallId };
        let release: (() => void) | undefined;
        let dispatched = false;
        try {
          release = await queue.acquire(execution.abortSignal);
          execution.abortSignal?.throwIfAborted();
          try {
            options.budget.consume();
          } catch {
            budgetExceeded = true;
            queue.close();
            throw new Error("Call budget exhausted.");
          }
          calls += 1;
          dispatched = true;
          trace({ ...event, status: "started", durationMs: 0 });
          const output = await options.registry.invoke(entry.name, input, {
            callId: execution.toolCallId,
            signal: execution.abortSignal,
          });
          execution.abortSignal?.throwIfAborted();
          trace({
            ...event,
            status: "succeeded",
            durationMs: performance.now() - started,
          });
          return output;
        } catch {
          if (dispatched)
            trace({
              ...event,
              status: execution.abortSignal?.aborted ? "cancelled" : "failed",
              durationMs: performance.now() - started,
            });
          // Never forward provider/database exception text, which can contain secrets.
          throw new Error("The requested capability could not complete.");
        } finally {
          release?.();
        }
      },
    });
  }
  const { maxConcurrentToolCalls: _dispatchLimit, ...executionPolicy } = policy;
  try {
    const output = await experimental_runCodeMode({
      js: options.js,
      tools,
      toolExecutionOptions: {
        toolCallId: options.callId,
        abortSignal: options.signal,
      },
      options: {
        // The SDK counts pending bridge promises, not actual host dispatches.
        // Admit the existing total budget; our local queue still dispatches four.
        executionPolicy: {
          ...executionPolicy,
          maxInFlightBridgeRequests: concurrency + maxQueued,
        },
        approval: { onApprovalRequired: () => "denied" },
      },
    });
    if (budgetExceeded) return { status: "failed", reason: "limit", calls };
    return { status: "completed", output, calls };
  } catch (error) {
    // Return only trusted schema names, never the SDK's reflected input or error
    // message. Invalid arguments remain rejected before the registry is invoked.
    if (
      !options.signal?.aborted &&
      !budgetExceeded &&
      error instanceof CodeModeToolError
    ) {
      const invalid = z
        .object({ toolName: z.string(), input: z.unknown() })
        .safeParse(error.details);
      if (invalid.success && Object.hasOwn(invalid.data, "input")) {
        const entry = options.registry
          .describe()
          .find(({ name }) => name === invalid.data.toolName);
        if (
          entry &&
          !(await entry.inputSchema.safeParseAsync(invalid.data.input)).success
        ) {
          const schema = z.toJSONSchema(entry.inputSchema, {
            unrepresentable: "any",
          });
          return {
            status: "failed",
            reason: "invalid_input",
            toolName: entry.name,
            requiredFields: (schema.required ?? []).slice(0, 16),
            calls,
          };
        }
      }
    }
    const code = z.object({ code: z.string() }).safeParse(error);
    const limited =
      code.success && /LIMIT|TIMEOUT|TOO_LARGE|MEMORY/.test(code.data.code);
    return {
      status: "failed",
      reason: options.signal?.aborted
        ? "cancelled"
        : budgetExceeded || limited
          ? "limit"
          : "program_failed",
      calls,
    };
  } finally {
    queue.close();
  }
}

/** The same registry schemas power direct discovery and code-mode discovery. */
export function describeCompositionTools(registry: CompositionRegistry) {
  return registry
    .describe()
    .map(({ name, description, inputSchema, effect }) => ({
      name,
      description,
      effect,
      inputSchema: z.toJSONSchema(inputSchema, { unrepresentable: "any" }),
    }));
}
