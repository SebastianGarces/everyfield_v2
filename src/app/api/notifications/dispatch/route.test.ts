import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  GET,
  isAuthorized,
  maxDuration,
  runDispatchTick,
  type DispatchTickDeps,
} from "./route";
import {
  RUN_BUDGET_MS,
  stillLivePredicateFor,
  type DispatchRunSummary,
} from "@/lib/notifications/dispatch";
import type { PlanterDigestSweepSummary } from "@/lib/notifications/digest";
import type { OversightDigestSweepSummary } from "@/lib/notifications/oversight-digest";
import { MEETING_NOTIFICATION_TYPES } from "@/lib/meetings/notifications";
import { TASK_NOTIFICATION_TYPES } from "@/lib/tasks/notifications";

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

test("vercel.json schedules nothing at all", () => {
  // It used to carry the one cron Hobby allows (the daily phase engine). #36
  // moved that route to a twice-daily Actions tick as well, so BOTH schedules
  // now live in .github/workflows and vercel.json declares none. Re-adding one
  // does not just duplicate a schedule — two drivers on one route double the
  // OpenAI spend and race each other's TPM window. The schedule each route
  // actually has is asserted next to that route.
  assert.deepEqual(
    readVercelCrons(),
    [],
    "a cron is back in vercel.json — both scheduled routes are driven by GitHub Actions"
  );
});

// ----------------------------------------------------------------------------
// AC (N-014): the still-live re-check is ARMED in the runtime that dispatches
//
// This is the probe that was red before the fix, and it is deliberately made
// over THIS module's graph. `stillLivePredicateFor` is asked only after
// `./route` has been imported at the top of this file, and NOTHING here imports
// a feature module for its side effects — the two type tuples below are plain
// `const` arrays, and both feature modules stopped registering at load time in
// the same change. So a green result can only come from the route's own
// `registerNotificationConsumers()` call.
//
// Why it matters, in one line: `resolveLiveness` treats an unregistered type as
// LIVE (by design — a caller with no resolution concept must not have its
// notifications silently swallowed), so an unarmed dispatcher emails a task the
// planter already finished and logs it as delivered.
//
// The feature suites CANNOT prove this. Each one calls its registrar by hand
// before dispatching, which proves the predicate's logic and says nothing about
// whether production ever arms it.
// ----------------------------------------------------------------------------

const CONSUMER_TYPES = [
  ...TASK_NOTIFICATION_TYPES,
  ...MEETING_NOTIFICATION_TYPES,
];

test("importing the dispatch route arms every consumer's still-live predicate", () => {
  assert.equal(
    CONSUMER_TYPES.length,
    6,
    "the two consumers compose six types between them"
  );

  for (const type of CONSUMER_TYPES) {
    assert.ok(
      stillLivePredicateFor(type),
      `no still-live predicate is registered for "${type}" in the dispatcher's own module graph — N-014's second line of defence is inert in the cron runtime`
    );
  }
});

test("the route is the ONLY place that arms them", () => {
  // The property, not the instance. Registration used to be a module-load side
  // effect in each feature — which type-checked, passed both feature suites and
  // armed nothing in production, because this route imports neither feature. A
  // third consumer must therefore join `registerNotificationConsumers()` rather
  // than arming itself where nobody dispatching will see it.
  const registrar = readFileSync(
    path.join(process.cwd(), "src/lib/notifications/register-consumers.ts"),
    "utf8"
  );
  assert.match(registrar, /registerTaskStillLivePredicates\(\)/);
  assert.match(registrar, /registerMeetingStillLivePredicates\(\)/);

  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/notifications/dispatch/route.ts"),
    "utf8"
  );
  assert.match(
    route,
    /^registerNotificationConsumers\(\);$/m,
    "the dispatch route no longer calls registerNotificationConsumers() at module scope"
  );

  for (const consumer of [
    "src/lib/tasks/notifications.ts",
    "src/lib/meetings/notifications.ts",
  ]) {
    const source = readFileSync(path.join(process.cwd(), consumer), "utf8");
    assert.doesNotMatch(
      source,
      /^register(Task|Meeting)StillLivePredicates\(\);$/m,
      `${consumer} arms itself at module load again — the runtime that reads a predicate imports no feature module, so that registration is invisible where it counts`
    );
  }
});

test("the run budget sits under the declared function timeout (N-017)", () => {
  // The run stops itself and releases what it claimed rather than being killed
  // mid-batch with rows stranded in `claimed`.
  assert.ok(
    RUN_BUDGET_MS < maxDuration * 1000,
    `budget ${RUN_BUDGET_MS}ms must be under ${maxDuration}s`
  );
});

// ----------------------------------------------------------------------------
// AC (#135): the planter digest sweep is actually CALLED by the one recurring
// tick this app has — and cannot take a successful dispatch down with it
//
// This is the probe that was red before the fix. `runDailyPlanterDigestSweep`
// had no caller anywhere in `src/`, so every digest acceptance criterion held
// inside the unit suite and nowhere else: in production no digest was composed,
// no row was enqueued, and the whole module plus its email template was
// unreachable code.
//
// The tick runs against injected deps rather than the database, which is what
// makes the ORDER and the never-fail contract assertable at all — the real
// `dispatch()` needs Postgres, and a test that cannot get past it proves
// nothing about what happens after it.
// ----------------------------------------------------------------------------

const DISPATCH_SUMMARY: DispatchRunSummary = {
  claimed: 3,
  remainingPending: 0,
  groups: 2,
  emailsSent: 2,
  delivered: 2,
  cancelled: 0,
  failed: 0,
  retryScheduled: 0,
  deferred: 0,
  suppressed: 0,
  addressSuppressed: 0,
  released: 0,
  durationMs: 12,
};

const OVERSIGHT_SUMMARY: OversightDigestSweepSummary = {
  dayKey: "2026-08-14",
  selected: 1,
  plantsScanned: 1,
  pages: 1,
  digested: 1,
  quiet: 0,
  unknown: 0,
  failed: 0,
  budgetExhausted: false,
  durationMs: 4,
};

const PLANTER_SUMMARY: PlanterDigestSweepSummary = {
  selected: 2,
  plantsScanned: 2,
  pages: 1,
  created: 5,
  deduped: 1,
  quiet: 0,
  failed: 0,
  budgetExhausted: false,
  durationMs: 7,
};

/** The three steps of a tick, named as the recorder and the failure list name them. */
type TickStep = "dispatch" | "oversight" | "planter";

/**
 * A tick whose three steps record that they ran, in the order they ran, and
 * throw where asked to.
 *
 * The recording happens BEFORE the throw on purpose: "the sweep ran and blew
 * up" and "the sweep was never called" are the two outcomes this file exists to
 * tell apart, and a fake that throws without recording cannot.
 */
function tickDeps(failing: readonly TickStep[] = []): {
  deps: DispatchTickDeps;
  calls: TickStep[];
  sweptAt: Date[];
} {
  const calls: TickStep[] = [];
  const sweptAt: Date[] = [];

  function record(step: TickStep): void {
    calls.push(step);
    if (failing.includes(step)) throw new Error(`${step} exploded`);
  }

  const deps: DispatchTickDeps = {
    async dispatch() {
      record("dispatch");
      return DISPATCH_SUMMARY;
    },
    async sweepOversightDigests() {
      record("oversight");
      return OVERSIGHT_SUMMARY;
    },
    async sweepPlanterDigests(at) {
      record("planter");
      sweptAt.push(at);
      return PLANTER_SUMMARY;
    },
  };

  return { deps, calls, sweptAt };
}

test("an authorised tick runs the planter digest sweep, after the dispatch", async () => {
  const { deps, calls, sweptAt } = tickDeps();

  const response = await runDispatchTick(deps);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    calls,
    ["dispatch", "oversight", "planter"],
    "draining what is due is the time-sensitive obligation; a roll-up never runs first"
  );
  assert.deepEqual(body.planterDigest, PLANTER_SUMMARY);
  assert.deepEqual(body.oversightDigest, OVERSIGHT_SUMMARY);
  assert.equal(body.claimed, DISPATCH_SUMMARY.claimed);
  assert.ok(
    sweptAt[0] instanceof Date,
    "the sweep is given the instant the tick fired — every period is derived from it"
  );
});

test("a planter digest sweep that throws still returns 200 with the dispatch intact", async () => {
  // A throw here would turn a successful dispatch — emails already sent, rows
  // already marked delivered — into a 500, and the caller's only recovery is to
  // tick again, which re-runs nothing and re-attempts the same broken sweep.
  const { deps, calls } = tickDeps(["planter"]);

  const response = await runDispatchTick(deps);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(
    body.planterDigest,
    null,
    "the failure is data, not an exception"
  );
  assert.deepEqual(body.oversightDigest, OVERSIGHT_SUMMARY);
  assert.equal(body.claimed, DISPATCH_SUMMARY.claimed);
  assert.equal(body.delivered, DISPATCH_SUMMARY.delivered);
  assert.deepEqual(calls, ["dispatch", "oversight", "planter"]);
});

test("an oversight sweep that throws does not cost the planter digest its tick", async () => {
  // The two roll-ups are independent; neither catch may swallow the other's run.
  const { deps } = tickDeps(["oversight"]);

  const body = await (await runDispatchTick(deps)).json();

  assert.equal(body.oversightDigest, null);
  assert.deepEqual(body.planterDigest, PLANTER_SUMMARY);
});

test("a dispatch that throws is still a 500, and no sweep runs behind it", async () => {
  const { deps, calls } = tickDeps(["dispatch"]);

  const response = await runDispatchTick(deps);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Dispatch run failed" });
  assert.deepEqual(calls, ["dispatch"]);
});

test("GET does the authorisation and nothing else — the tick is one call", () => {
  // The guard and the work are separate so the work can be tested; that split
  // is only honest while GET keeps delegating rather than growing a second copy
  // of the body.
  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/notifications/dispatch/route.ts"),
    "utf8"
  );
  const getBody = route.slice(route.indexOf("export async function GET("));

  assert.match(getBody, /return runDispatchTick\(\);/);
  assert.doesNotMatch(
    getBody,
    /dispatchNotifications\(/,
    "GET re-implements the tick instead of calling it"
  );
});
