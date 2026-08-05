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

// ----------------------------------------------------------------------------
// AC (#266): the comparison is constant-time, and length is not a side door
//
// `crypto.timingSafeEqual` throws a RangeError on buffers of unequal length, so
// a guard that only ever sees the happy path would still ship a 500 (or worse, a
// crash loop) the first time a wrong-length token arrived. These cases are the
// proof that the length reconciliation happens BEFORE the call and that every
// wrong shape lands on a plain `false`.
// ----------------------------------------------------------------------------

test("a shorter token is refused, not thrown over", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(requestWithAuth("Bearer s3cre")), false);
  assert.equal(isAuthorized(requestWithAuth("Bearer ")), false);
  assert.equal(isAuthorized(requestWithAuth("")), false);
});

test("a longer token is refused, not thrown over", () => {
  process.env.CRON_SECRET = "s3cret";
  // The correct secret with anything appended: the prefix matches, which is
  // exactly the case a byte-by-byte compare would answer fastest.
  assert.equal(isAuthorized(requestWithAuth("Bearer s3cretX")), false);
  assert.equal(
    isAuthorized(requestWithAuth(`Bearer ${"s3cret".repeat(2000)}`)),
    false
  );
});

test("a token differing only in its last byte is refused", () => {
  // Same length, so `timingSafeEqual` does the deciding rather than the guard.
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isAuthorized(requestWithAuth("Bearer s3creT")), false);
});

test("a long secret still authorises exactly one value", () => {
  // Hashing both sides is what makes the length safe; prove it round-trips for
  // a realistic secret and refuses a same-length near miss.
  const secret = "a".repeat(64);
  process.env.CRON_SECRET = secret;
  assert.equal(isAuthorized(requestWithAuth(`Bearer ${secret}`)), true);
  assert.equal(
    isAuthorized(requestWithAuth(`Bearer ${"a".repeat(63)}b`)),
    false
  );
});

// The source-level half of the AC — "no non-constant-time comparison of the
// secret remains" — is NOT asserted here. A per-file grep in a per-route test
// is exactly how `/api/phase-engine/assess` kept its `===` while this route was
// hardened, and a whole-file grep also overclaims: it passes as long as a
// constant-time helper is *defined* somewhere in the file, even if the guard
// stopped calling it. It lives once, over every route that reads CRON_SECRET,
// in `src/lib/security/constant-time.test.ts`, scoped to the guard body.

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
// The schedule has to exist, or the dispatcher never runs at all — and it has to
// live somewhere the plan will actually accept
// ----------------------------------------------------------------------------

function readVercelCrons(): { path: string; schedule: string }[] {
  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
  ) as { crons?: { path: string; schedule: string }[] };
  return config.crons ?? [];
}

// The workflow is read as text rather than parsed: `yaml` is only a transitive
// dependency here, and the two facts under test are a literal schedule line and
// a literal URL. Both break loudly if the file is restructured.
function readDispatchWorkflow(): string {
  return readFileSync(
    path.join(process.cwd(), ".github/workflows/notifications-dispatch.yml"),
    "utf8"
  );
}

test("a GitHub Actions schedule ticks the dispatcher", () => {
  const workflow = readDispatchWorkflow();

  assert.match(
    workflow,
    /- cron: "\*\/15 \* \* \* \*"/,
    "no 15-minute cron trigger in the dispatch workflow"
  );
  assert.match(
    workflow,
    /\/api\/notifications\/dispatch/,
    "the workflow does not call the dispatch route"
  );
  // Without the bearer the route fails closed and every tick 401s.
  assert.match(
    workflow,
    /Authorization: Bearer \$CRON_SECRET/,
    "the workflow does not send the CRON_SECRET bearer"
  );
});

test("vercel.json does NOT schedule the dispatcher", () => {
  // Not a style preference — a deployment gate. The project is on the Hobby
  // plan, which rejects sub-daily crons outright rather than throttling them,
  // taking the whole deployment down with it. That is what moved this schedule
  // to Actions; putting it back here breaks production deploys, not just this
  // job.
  assert.equal(
    readVercelCrons().find(
      (cron) => cron.path === "/api/notifications/dispatch"
    ),
    undefined,
    "the dispatcher is back in vercel.json — Hobby will reject the deployment"
  );
});

test("every vercel.json cron is daily or less frequent (Hobby limit)", () => {
  // Same gate, generalised: on Hobby, minute and hour must each be a single
  // literal value, so the job fires at most once a day. Any `*`, `*/n`, list or
  // range in those two fields means more than one invocation per day.
  for (const cron of readVercelCrons()) {
    const [minute, hour] = cron.schedule.split(/\s+/);
    assert.match(
      minute,
      /^\d+$/,
      `${cron.path}: minute field "${minute}" fires more than once an hour`
    );
    assert.match(
      hour,
      /^\d+$/,
      `${cron.path}: hour field "${hour}" fires more than once a day`
    );
  }
});

test("the phase-engine cron survives in vercel.json", () => {
  assert.ok(
    readVercelCrons().some((cron) => cron.path === "/api/phase-engine/assess"),
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
