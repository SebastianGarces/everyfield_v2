// Explicitly preloaded by the disposable preview runner, never imported by src.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const ownHash = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
assert.equal(ownHash, process.env.EVERYFIELD_PREVIEW_RUNTIME_HASH);
const require = createRequire(join(process.cwd(), "package.json"));
const driverPath = require.resolve("@neondatabase/serverless");
const { neonConfig } = await import(
  pathToFileURL(driverPath.replace(/\.js$/, ".mjs")).href
);
const cjsNeonConfig = require("@neondatabase/serverless").neonConfig;
assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
const connection = new URL(process.env.DATABASE_URL);
const endpoint = new URL(process.env.EVERYFIELD_PREVIEW_SQL_ENDPOINT);
assert.equal(connection.hostname, "localhost");
assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
assert.equal(endpoint.hostname, "127.0.0.1");
assert.equal(endpoint.protocol, "http:");
assert.equal(endpoint.pathname, "/sql");
neonConfig.fetchEndpoint = endpoint.href;
cjsNeonConfig.fetchEndpoint = endpoint.href;
if (process.env.EVERYFIELD_PREVIEW_WS_ENDPOINT) {
  const ws = new URL(process.env.EVERYFIELD_PREVIEW_WS_ENDPOINT);
  assert.equal(ws.hostname, "127.0.0.1");
  assert.equal(ws.protocol, "ws:");
  neonConfig.wsProxy = () => ws.host + ws.pathname + ws.search;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  neonConfig.webSocketConstructor = WebSocket;
  cjsNeonConfig.wsProxy = neonConfig.wsProxy;
  cjsNeonConfig.useSecureWebSocket = false;
  cjsNeonConfig.pipelineConnect = false;
  cjsNeonConfig.webSocketConstructor = WebSocket;
}
// Next bundles the driver. Its copy uses the same fetch transport, not the
// preloaded driver's module instance. Match only the owned connection's URL.
const nativeFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url
  );
  if (url.href === "https://localhost/sql") {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    assert.equal(
      headers.get("neon-connection-string"),
      process.env.DATABASE_URL
    );
    input = input instanceof Request ? new Request(endpoint, input) : endpoint;
  }
  return nativeFetch(input, init);
};
