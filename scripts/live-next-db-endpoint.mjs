// Test-runner preload for production-path Next.js live proofs.
//
// Next rewrites repeated `--import` arguments when it starts its worker
// processes, so the TypeScript node:test preload cannot be passed to the Next
// CLI. This JavaScript-only adapter performs the one boundary change the live
// process needs: point the production neon-http driver at the isolated local
// proxy. It is never imported by `src/` and fails closed unless the opt-in live
// test environment is explicit.
import { neonConfig } from "@neondatabase/serverless";

if (process.env.LIVE_DB_TESTS !== "1") {
  throw new Error("The Next live-database preload is test-only");
}

const endpoint = process.env.NEON_HTTP_PROXY_URL;
if (!endpoint) {
  throw new Error("NEON_HTTP_PROXY_URL is required for the Next live proof");
}

neonConfig.fetchEndpoint = endpoint;
