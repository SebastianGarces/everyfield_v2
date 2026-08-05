import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mock, test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  CHURCH_SAVE_FAILED_MESSAGE,
  NOT_A_PLANTER_MESSAGE,
  churchCreationStatements,
  discardChurchStatements,
  runCreateChurch,
  type ChurchCreationWrite,
  type CreateChurchDeps,
  type OnboardingActor,
} from "./create-church";

// ----------------------------------------------------------------------------
// F12 / OB-001 — step 1's write path (#198 + #243).
//
// Two defects live here and both are about what survives a bad moment.
//
// #198: the church insert, the user link and the privacy-settings insert were
// three separate awaited statements, so a failure at the LAST one left a church
// linked to a planter with no privacy row — a state the product could not
// repair, because the retry that would create the missing row is refused by the
// "you already have a church" guard. They are now one `db.batch`, which on
// neon-http is one transaction: a failure rolls the church back too, and the
// retry is a clean first attempt.
//
// #243: the losing tab of a double submit used to be told "Church already
// created" and left rendering its stale step 1. It now revalidates and reports
// the only fact that matters — the church exists — so the flow moves on.
//
// The orchestration is driven through `CreateChurchDeps` rather than a
// database: what these tests assert is the ORDER and the CONDITIONS, which is
// exactly what the defect was about. The SQL section below then reads the real
// statements to pin the guards inside them.
// ----------------------------------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

type Call =
  | { kind: "commit"; write: ChurchCreationWrite }
  | { kind: "discard"; churchId: string }
  | { kind: "revalidate" };

function harness(options: { linked?: boolean; commitFails?: boolean } = {}) {
  const calls: Call[] = [];
  let commitFails = options.commitFails ?? false;

  const deps: CreateChurchDeps = {
    newChurchId: () => CHURCH_ID,
    revalidate() {
      calls.push({ kind: "revalidate" });
    },
    async commitChurch(write) {
      calls.push({ kind: "commit", write });
      if (commitFails) {
        throw new Error("insert into church_privacy_settings failed");
      }
      return options.linked ?? true;
    },
    async discardChurch(churchId) {
      calls.push({ kind: "discard", churchId });
    },
  };

  return {
    deps,
    calls,
    kinds: () => calls.map((call) => call.kind),
    /** Simulate the injected failure being over, for the retry tests. */
    recover() {
      commitFails = false;
    },
  };
}

function planter(overrides: Partial<OnboardingActor> = {}): OnboardingActor {
  return { id: USER_ID, role: "planter", churchId: null, ...overrides };
}

function basics(entries: Record<string, string> = { name: "Grace Church" }) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

// ----------------------------------------------------------------------------
// Who may create a church
// ----------------------------------------------------------------------------

test("a non-planter is refused before anything is written", async () => {
  const { deps, calls } = harness();

  const result = await runCreateChurch(
    deps,
    planter({ role: "coach" }),
    basics()
  );

  assert.deepEqual(result, { status: "error", error: NOT_A_PLANTER_MESSAGE });
  assert.deepEqual(calls, []);
});

test("invalid input returns field errors and writes nothing", async () => {
  const { deps, calls } = harness();

  const result = await runCreateChurch(
    deps,
    planter(),
    basics({ name: "   " })
  );

  assert.equal(result.status, "error");
  assert.ok(result.status === "error" && result.fieldErrors?.name);
  assert.deepEqual(calls, []);
});

// ----------------------------------------------------------------------------
// #243 — the losing tab of a double submit
// ----------------------------------------------------------------------------

test("a planter who already has a church revalidates and moves on", async () => {
  // The branch a second tab lands in. Two things are being asserted: the page
  // is revalidated (so the tab re-renders from the database instead of keeping
  // the copy it painted before the other tab won), and the outcome is `created`
  // rather than an error — the church the planter cares about DOES exist, and
  // parking them on step 1 with "you already have a church" is the stale render
  // this branch exists to prevent.
  const { deps, calls, kinds } = harness();

  const result = await runCreateChurch(
    deps,
    planter({ churchId: CHURCH_ID }),
    basics()
  );

  assert.deepEqual(result, { status: "created" });
  assert.deepEqual(kinds(), ["revalidate"]);
  assert.equal(
    calls.some((call) => call.kind === "commit"),
    false
  );
});

test("a lost link sweeps up its own church and still moves the planter on", async () => {
  // #183's compare-and-set matched no row: another request linked this planter
  // first. The batch still committed, so the church row this request inserted
  // is real and belongs to nobody — it is discarded, and the planter is moved
  // on to step 2 of the church they actually have.
  const { deps, calls, kinds } = harness({ linked: false });

  const result = await runCreateChurch(deps, planter(), basics());

  assert.deepEqual(result, { status: "created" });
  assert.deepEqual(kinds(), ["commit", "discard", "revalidate"]);
  assert.deepEqual(
    calls.find((call) => call.kind === "discard"),
    { kind: "discard", churchId: CHURCH_ID }
  );
});

test("a failed sweep costs a stray row, not the planter's step", async () => {
  // The planter's church exists and is linked — by the request that won — so
  // there is nothing to tell them about and nothing for them to retry. The
  // stray row is logged for whoever cleans up, and the flow moves on.
  mock.method(console, "error", () => {});
  const { deps } = harness({ linked: false });
  deps.discardChurch = async () => {
    throw new Error("delete blew up");
  };

  const result = await runCreateChurch(deps, planter(), basics());

  assert.deepEqual(result, { status: "created" });
  mock.restoreAll();
});

// ----------------------------------------------------------------------------
// #198 — atomicity
// ----------------------------------------------------------------------------

test("the happy path is exactly one commit, then a revalidate", async () => {
  const { deps, calls, kinds } = harness();

  const result = await runCreateChurch(
    deps,
    planter(),
    basics({ name: "  Grace Church  ", city: "Austin", country: "" })
  );

  assert.deepEqual(result, { status: "created" });
  assert.deepEqual(kinds(), ["commit", "revalidate"]);

  const commit = calls[0];
  assert.equal(commit.kind, "commit");
  assert.deepEqual(commit.kind === "commit" ? commit.write : null, {
    churchId: CHURCH_ID,
    plantedBy: USER_ID,
    name: "Grace Church",
    city: "Austin",
    // Untouched optional fields reach the column as NULL, never "" — the
    // contract `src/lib/validations/onboarding.ts` exists to hold.
    stateRegion: null,
    country: null,
  });
});

test("a failed batch leaves nothing behind and is reported, not thrown", async () => {
  // The #198 scenario: the privacy-settings insert blows up. Because all three
  // writes are one batch, the church and the link roll back with it — so there
  // is nothing to discard, and the planter is told rather than shown a crash
  // (FRD NFR: a failure on one step must not cost them another).
  mock.method(console, "error", () => {});
  const { deps, kinds } = harness({ commitFails: true });

  const result = await runCreateChurch(deps, planter(), basics());

  assert.deepEqual(result, {
    status: "error",
    error: CHURCH_SAVE_FAILED_MESSAGE,
  });
  assert.deepEqual(kinds(), ["commit"]);
  mock.restoreAll();
});

test("the retry after a failed batch succeeds cleanly", async () => {
  // Idempotency, stated as the planter experiences it: submit, fail, submit
  // again, done. Nothing from the first attempt exists to collide with — no
  // half-written church, and no unique violation on the privacy row (the real
  // statement carries ON CONFLICT DO NOTHING; see the SQL section).
  mock.method(console, "error", () => {});
  const { deps, kinds, recover } = harness({ commitFails: true });

  const failed = await runCreateChurch(deps, planter(), basics());
  assert.equal(failed.status, "error");

  recover();
  const retried = await runCreateChurch(deps, planter(), basics());

  assert.deepEqual(retried, { status: "created" });
  assert.deepEqual(kinds(), ["commit", "commit", "revalidate"]);
  mock.restoreAll();
});

// ----------------------------------------------------------------------------
// The statements themselves
//
// The deps seam above proves the orchestration; these read the generated SQL,
// because the guarantees live inside the statements: what makes the three
// writes atomic is that they are ONE batch in FK order, and what makes a
// double submit safe is #183's compare-and-set inside statement two.
// ----------------------------------------------------------------------------

const dialect = new PgDialect();

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

const WRITE: ChurchCreationWrite = {
  churchId: CHURCH_ID,
  plantedBy: USER_ID,
  name: "Grace Church",
  city: null,
  stateRegion: null,
  country: null,
};

test("the batch is church, then link, then privacy — the only FK-legal order", () => {
  const [church, link, privacy] = churchCreationStatements(WRITE).map(render);

  assert.match(church, /insert\s+into\s+"churches"/i);
  assert.match(link, /update\s+"users"\s+set/i);
  assert.match(privacy, /insert\s+into\s+"church_privacy_settings"/i);
});

test("the link is #183's compare-and-set and reports whether it won", () => {
  const [, link] = churchCreationStatements(WRITE).map(render);

  assert.match(link, /"users"\."id"\s*=\s*\$\d+/);
  assert.match(link, /"users"\."church_id"\s+is\s+null/i);
  // Without RETURNING there is no way to tell a won link from a lost one — an
  // empty result is not an error and does not roll a batch back.
  assert.match(link, /returning/i);
});

test("the privacy row cannot dead-end a retry on its unique index", () => {
  const [, , privacy] = churchCreationStatements(WRITE).map(render);

  assert.match(privacy, /on\s+conflict\s+do\s+nothing/i);
});

test("cleanup deletes the privacy row first, then the church", () => {
  const [privacy, church] = discardChurchStatements(CHURCH_ID).map(render);

  assert.match(privacy, /delete\s+from\s+"church_privacy_settings"/i);
  assert.match(church, /delete\s+from\s+"churches"/i);
});

test("cleanup can only ever delete a church nobody is linked to", () => {
  // The id was minted by the request doing the sweeping, so in practice nobody
  // can be pointing at it. The guard is on BOTH statements because the cost of
  // being wrong is somebody else's plant — and because deleting the privacy
  // row while leaving the church is precisely the #198 defect.
  for (const statement of discardChurchStatements(CHURCH_ID).map(render)) {
    assert.match(statement, /not\s+exists/i);
    assert.match(statement, /"users"\."church_id"\s*=\s*\$\d+/);
  }
});

// ----------------------------------------------------------------------------
// #243 — the contract between the action and its caller
//
// Typecheck is the primary proof (the AC says so), but typecheck passes just as
// happily if someone re-tightens the return type and drops the `?.` again. These
// two assertions are what makes that a test failure with a reason attached.
// ----------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src");

function source(...segments: string[]) {
  return readFileSync(path.join(SRC, ...segments), "utf8");
}

test("completeOnboarding declares that it may not return", () => {
  const actions = source("app", "(dashboard)", "dashboard", "actions.ts");

  assert.match(
    actions,
    /completeOnboarding\(\):\s*Promise<CompleteOnboardingState \| void>/,
    "the success path redirects; the type must say so rather than rest on `redirect()` being typed `never`"
  );
});

test("the flow reads the completion result optionally", () => {
  const flow = source("components", "onboarding", "onboarding-flow.tsx");

  assert.match(flow, /await completeOnboarding\(\)/);
  assert.match(flow, /result\?\.error/);
  assert.doesNotMatch(flow, /result\.error/);
});

test("a finish that never returns a state is still reported to the planter", () => {
  // The third outcome, alongside "redirected" and "returned an error": the call
  // REJECTED. An async transition callback that lets that escape renders
  // nothing and leaves the button pending — the worst version of the FRD's NFR,
  // because every earlier step IS saved and the planter cannot tell.
  const flow = source("components", "onboarding", "onboarding-flow.tsx");

  const finishBody = flow.slice(flow.indexOf("function finish()"));
  assert.match(
    finishBody.slice(0, finishBody.indexOf("\n  }")),
    /try\s*\{[\s\S]*await completeOnboarding\(\)[\s\S]*\}\s*catch/,
    "the finish call must be guarded — a rejected action has to become a message, not a stuck button"
  );

  // Finishing is idempotent (`onboarding_completed_at IS NULL`), so the message
  // is allowed to invite a retry; the action keeps the guard that makes that true.
  const actions = source("app", "(dashboard)", "dashboard", "actions.ts");
  assert.match(actions, /isNull\(churches\.onboardingCompletedAt\)/);
});

test("the action module publishes only actions", () => {
  // Every export of a `"use server"` module is a POSTable endpoint
  // (memory/invariants.md → Authentication), so the write path's helpers live
  // in this module and only the three actions are exported over there.
  const actions = source("app", "(dashboard)", "dashboard", "actions.ts");
  const exported = [...actions.matchAll(/^export\s+(?!type\b)(\w+)/gm)];

  assert.deepEqual(
    exported.map((match) => match[1]),
    ["async", "async", "async"],
    "only `export async function` may appear in a 'use server' module"
  );
});
