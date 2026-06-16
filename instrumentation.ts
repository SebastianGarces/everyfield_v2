import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

export async function register() {
  // No-op cleanly when no DSN is configured (e.g. local dev).
  if (!SENTRY_DSN) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
      enabled: process.env.NODE_ENV === "production",
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
      enabled: process.env.NODE_ENV === "production",
    });
  }
}

// Capture errors from nested React Server Components, middleware, and proxies.
export const onRequestError = Sentry.captureRequestError;
