import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (SENTRY_DSN) {
      Sentry.init({
        dsn: SENTRY_DSN,
        tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
        enabled: process.env.NODE_ENV === "production",
      });
    }

    // This provider stays isolated from Sentry's global OpenTelemetry setup.
    const { initializeLangfuseTracing } =
      await import("./src/lib/observability/langfuse");
    initializeLangfuseTracing();
  }

  if (process.env.NEXT_RUNTIME === "edge" && SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
      enabled: process.env.NODE_ENV === "production",
    });
  }
}

// Capture errors from nested React Server Components, middleware, and proxies.
export const onRequestError = Sentry.captureRequestError;
