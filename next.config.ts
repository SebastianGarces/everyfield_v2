import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // A profile photo is a server-action payload — a person's (P-024a) and an
    // account's own picture (#617) alike — and the default cap on one is 1MB:
    // under it a 2MB avatar died as a bare 413 with a console error, never
    // reaching the action that would have explained itself. This sits above
    // `PROFILE_PHOTO_MAX_BYTES` (3MB) so the refusal a reader sees is always
    // ours, and under the serverless platform's own 4.5MB body cap, which no
    // config here can raise.
    serverActions: { bodySizeLimit: "4mb" },
  },
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
