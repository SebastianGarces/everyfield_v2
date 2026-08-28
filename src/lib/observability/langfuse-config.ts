import { z } from "zod";

const credentialSchema = z.string().min(8).max(512);
const environmentSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .refine((value) => !value.startsWith("langfuse"));

export type LangfuseConfig = Readonly<{
  status: "configured";
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  environment: string;
}>;

export type LangfuseConfigState =
  | LangfuseConfig
  | Readonly<{ status: "disabled" }>
  | Readonly<{
      status: "refused";
      reason: "partial" | "invalid" | "public_secret";
    }>;

type LangfuseEnvironment = Readonly<
  Partial<
    Record<
      | "LANGFUSE_BASE_URL"
      | "LANGFUSE_PUBLIC_KEY"
      | "LANGFUSE_SECRET_KEY"
      | "LANGFUSE_TRACING_ENVIRONMENT"
      | "NEXT_PUBLIC_LANGFUSE_SECRET_KEY",
      string | undefined
    >
  >
>;

function explicitBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash) return null;
    if (
      url.protocol !== "https:" &&
      !(isLoopback && url.protocol === "http:")
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Parse once at the process boundary. No implicit Langfuse Cloud fallback. */
export function parseLangfuseConfig(
  env: LangfuseEnvironment
): LangfuseConfigState {
  if (env.NEXT_PUBLIC_LANGFUSE_SECRET_KEY) {
    return Object.freeze({ status: "refused", reason: "public_secret" });
  }

  const values = [
    env.LANGFUSE_BASE_URL,
    env.LANGFUSE_PUBLIC_KEY,
    env.LANGFUSE_SECRET_KEY,
    env.LANGFUSE_TRACING_ENVIRONMENT,
  ];
  if (values.every((value) => value === undefined || value === "")) {
    return Object.freeze({ status: "disabled" });
  }
  if (values.some((value) => value === undefined || value === "")) {
    return Object.freeze({ status: "refused", reason: "partial" });
  }

  const [rawBaseUrl, rawPublicKey, rawSecretKey, rawEnvironment] = values;
  const baseUrl = explicitBaseUrl(rawBaseUrl ?? "");
  const publicKey = credentialSchema.safeParse(rawPublicKey);
  const secretKey = credentialSchema.safeParse(rawSecretKey);
  const environment = environmentSchema.safeParse(rawEnvironment);
  if (
    !baseUrl ||
    !publicKey.success ||
    !secretKey.success ||
    !environment.success
  ) {
    return Object.freeze({ status: "refused", reason: "invalid" });
  }

  return Object.freeze({
    status: "configured",
    baseUrl,
    publicKey: publicKey.data,
    secretKey: secretKey.data,
    environment: environment.data,
  });
}

export function langfuseConfigFromProcess(): LangfuseConfigState {
  return parseLangfuseConfig({
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_TRACING_ENVIRONMENT: process.env.LANGFUSE_TRACING_ENVIRONMENT,
    NEXT_PUBLIC_LANGFUSE_SECRET_KEY:
      process.env.NEXT_PUBLIC_LANGFUSE_SECRET_KEY,
  });
}
