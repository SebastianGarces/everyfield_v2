import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { GET, isAuthorized, maxDuration } from "./route";
import { RUN_BUDGET_MS } from "@/lib/notifications/dispatch";

// The scheduled entrypoint. All of the dispatch behaviour is covered in
// `src/lib/notifications/dispatch.test.ts` against injected deps; what is left
// to prove here is the guard, and that the schedule actually exists.
//
// Nothing below reaches `dispatchNotifications` — every request tested is
// rejected before it, which is exactly the property under test: an unauthorised
// caller must not be able to make this route claim rows or call a provider.

function requestWithAuth(
  value: string | null
): import("next/server").NextRequest {
  const headers = new Map<string, string>();
  if (value !== null) headers.set("authorization", value);
  // Minimal shape — the guard only reads `headers.get`.
  return {
    headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
  } as unknown as import("next/server").NextRequest;
}

// ----------------------------------------------------------------------------
// AC: the route rejects unauthenticated invocation
// ----------------------------------------------------------------------------

test("rejects a request with no Authorization header", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(requestWithAuth(null)), false);
});

test("rejects a wrong bearer token", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(requestWithAuth("Bearer wrong")), false);
});

test("rejects a bare token without the Bearer scheme", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(requestWithAuth("s3cret")), false);
});

test("fails closed when CRON_SECRET is not configured", () => {
  // An unset secret must not open the endpoint. This route sends email to real
  // users; an open one is a spam cannon pointed at the cohort.
  delete process.env.CRON_SECRET;
  assert.equal(isAuthorized(requestWithAuth("Bearer anything")), false);
  assert.equal(isAuthorized(requestWithAuth("Bearer ")), false);
});

test("accepts the correct Bearer token", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(requestWithAuth("Bearer s3cret")), true);
});

test("an unauthorised GET is refused with 401 and dispatches nothing", async () => {
  process.env.CRON_SECRET = "s3cret";

  const response = await GET(requestWithAuth("Bearer nope"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("a GET with no secret configured is refused with 401", async () => {
  delete process.env.CRON_SECRET;

  const response = await GET(requestWithAuth(null));

  assert.equal(response.status, 401);
});

// ----------------------------------------------------------------------------
// The schedule has to exist, or the dispatcher never runs at all
// ----------------------------------------------------------------------------

test("vercel.json schedules the dispatcher", () => {
  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
  ) as { crons?: { path: string; schedule: string }[] };

  const entry = config.crons?.find(
    (cron) => cron.path === "/api/notifications/dispatch"
  );
  assert.ok(entry, "no cron entry for /api/notifications/dispatch");
  assert.match(entry.schedule, /^\S+ \S+ \S+ \S+ \S+$/);

  // The existing Plant Intelligence job must survive alongside it.
  assert.ok(
    config.crons?.some((cron) => cron.path === "/api/phase-engine/assess"),
    "the phase-engine cron was dropped"
  );
});

test("the run budget sits under the declared function timeout (N-017)", () => {
  // The run stops itself and releases what it claimed rather than being killed
  // mid-batch with rows stranded in `claimed`.
  assert.ok(
    RUN_BUDGET_MS < maxDuration * 1000,
    `budget ${RUN_BUDGET_MS}ms must be under ${maxDuration}s`
  );
});
