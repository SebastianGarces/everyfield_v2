import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      {
        source: "/vision-meetings",
        destination: "/meetings",
        permanent: false,
      },
      {
        source: "/vision-meetings/:path*",
        destination: "/meetings",
        permanent: false,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Org/project are read from env so the project slug isn't hardcoded
  // (e.g. renaming the Sentry project only changes SENTRY_PROJECT).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps when an auth token is present (CI/prod).
  // Without a token, the upload step is skipped so local/CI builds don't break.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress SDK logs except in CI.
  silent: !process.env.CI,

  widenClientFileUpload: true,

  // Route Sentry requests through the app to avoid ad-blockers.
  tunnelRoute: "/monitoring",
});
