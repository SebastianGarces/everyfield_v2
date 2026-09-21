// Only the owned discovery proof runner preloads this module. Never import from src.
import assert from "node:assert/strict";
import { neonConfig } from "@neondatabase/serverless";

assert.equal(process.env.DISCOVERY_PROFILE_PROOF, "1");
const connection = process.env.DISCOVERY_PROFILE_DATABASE_URL;
const endpoint = process.env.DISCOVERY_PROFILE_ENDPOINT;
assert.ok(connection && endpoint);
const target = new URL(connection);
const proxy = new URL(endpoint);
assert.equal(target.hostname, "localhost");
assert.equal(target.pathname, "/discovery_294_proof");
assert.equal(proxy.hostname, "127.0.0.1");
assert.equal(proxy.protocol, "http:");
assert.equal(proxy.pathname, "/sql");
neonConfig.fetchEndpoint = endpoint;
process.env.DATABASE_URL = connection;
process.env.RESEND_API_KEY = "re_discovery_scratch_unused";
