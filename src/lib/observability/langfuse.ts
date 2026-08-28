import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import {
  langfuseConfigFromProcess,
  type LangfuseConfig,
  type LangfuseConfigState,
} from "./langfuse-config";

type LangfuseRuntime = Readonly<{
  config: LangfuseConfig;
  processor: LangfuseSpanProcessor;
  provider: NodeTracerProvider;
}>;

let initialized = false;
let runtime: LangfuseRuntime | null = null;
let initializationState: LangfuseConfigState = { status: "disabled" };

const SECRET_PATTERN = /\b(?:sk|pk)-(?:lf|live|test)-[a-z0-9._-]+\b/gi;
const BEARER_PATTERN = /\bBearer\s+[a-z0-9._~+/=-]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** Defense in depth. Evry's closed contract rejects these before this runs. */
export function maskLangfuseData(input: unknown): unknown {
  if (typeof input === "string") {
    return input
      .replace(SECRET_PATTERN, "[redacted-secret]")
      .replace(BEARER_PATTERN, "Bearer [redacted]")
      .replace(EMAIL_PATTERN, "[redacted-email]");
  }
  if (Array.isArray(input)) return input.map(maskLangfuseData);
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        maskLangfuseData(value),
      ])
    );
  }
  return input;
}

/** Initialize an isolated provider. It never registers as OTel's global provider. */
export function initializeLangfuseTracing(): LangfuseConfigState {
  if (initialized) return initializationState;
  initialized = true;
  const config = langfuseConfigFromProcess();
  initializationState = config;
  if (config.status !== "configured") return config;

  try {
    const processor = new LangfuseSpanProcessor({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
      environment: config.environment,
      mediaUploadEnabled: false,
      exportMode: "immediate",
      mask: ({ data }: { data: unknown }) => maskLangfuseData(data),
      shouldExportSpan: ({ otelSpan }) =>
        otelSpan.name.startsWith("evry.") ||
        otelSpan.name.startsWith("phase-engine."),
    });
    const provider = new NodeTracerProvider({
      spanProcessors: [processor],
    });
    setLangfuseTracerProvider(provider);
    runtime = Object.freeze({ config, processor, provider });
    return config;
  } catch {
    runtime = null;
    initializationState = Object.freeze({
      status: "refused",
      reason: "invalid",
    });
    return initializationState;
  }
}

export function configuredLangfuseEnvironment(): string | null {
  const state = initializeLangfuseTracing();
  return state.status === "configured" && runtime ? state.environment : null;
}

export async function forceFlushLangfuse(): Promise<void> {
  if (!runtime) return;
  await runtime.processor.forceFlush();
}

/** Process-teardown hook for bounded scripts; application requests never call it. */
export async function shutdownLangfuseTracing(): Promise<void> {
  const active = runtime;
  runtime = null;
  if (!active) return;
  await active.provider.shutdown();
}
