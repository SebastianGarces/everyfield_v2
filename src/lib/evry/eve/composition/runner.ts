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
  maxInFlightBridgeRequests: 4,
} satisfies Required<CodeModeExecutionPolicy>);

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
        trace({ ...event, status: "started", durationMs: 0 });
        try {
          execution.abortSignal?.throwIfAborted();
          try {
            options.budget.consume();
          } catch {
            budgetExceeded = true;
            throw new Error("Call budget exhausted.");
          }
          calls += 1;
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
          trace({
            ...event,
            status: execution.abortSignal?.aborted ? "cancelled" : "failed",
            durationMs: performance.now() - started,
          });
          // Never forward provider/database exception text, which can contain secrets.
          throw new Error("The requested capability could not complete.");
        }
      },
    });
  }
  try {
    const output = await experimental_runCodeMode({
      js: options.js,
      tools,
      toolExecutionOptions: {
        toolCallId: options.callId,
        abortSignal: options.signal,
      },
      options: {
        executionPolicy: policy,
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
