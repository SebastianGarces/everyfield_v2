import assert from "node:assert/strict";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  CHOOSE_AN_ANSWER_MESSAGE,
  CLAIM_LOST_MESSAGE,
  CREATE_CHURCH_FIRST_MESSAGE,
  LEADERSHIP_SAVE_FAILED_MESSAGE,
  NOT_YOURS_TO_ANSWER_MESSAGE,
  claimPlanterStatements,
  recordLeadershipStatement,
  runConfirmLeadership,
  type ConfirmLeadershipDeps,
  type LeadershipActor,
  type LeadershipWrite,
} from "./confirm-leadership";
import type { ChurchLeadershipState } from "@/lib/onboarding/leadership";

// ----------------------------------------------------------------------------
// F12 / OB-004 + OB-010 — the leadership answer's write path.
//
// The interesting cases are all about a plant with an EMPTY planter seat, which
// is the state OB-010 exists for and the only one where "Yes" changes who a
// person is rather than what a column says. Two things have to hold:
//
//  - the permission closes the moment the seat is filled, and it is re-derived
//    from the church at write time rather than trusted from the caller;
//  - the claim writes nothing at all when it loses — the plant is never recorded
//    as planter-confirmed on the strength of a claim that did not land.
//
// The orchestration runs through `ConfirmLeadershipDeps` (no database); the SQL
// section reads the real statements to pin the guards inside them.
// ----------------------------------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

function harness(
  church: ChurchLeadershipState | null,
  options: { written?: boolean; throws?: boolean } = {}
) {
  const writes: LeadershipWrite[] = [];
  let revalidated = 0;

  const deps: ConfirmLeadershipDeps = {
    async readLeadership() {
      return church;
    },
    async writeAnswer(write) {
      writes.push(write);
      if (options.throws) throw new Error("neon: connection reset");
      return options.written ?? true;
    },
    revalidate() {
      revalidated += 1;
    },
  };

  return { deps, writes, revalidations: () => revalidated };
}

function state(
  overrides: Partial<ChurchLeadershipState> = {}
): ChurchLeadershipState {
  return {
    churchId: CHURCH_ID,
    leadershipStatus: null,
    hasPlanterUser: false,
    ...overrides,
  };
}

function actor(overrides: Partial<LeadershipActor> = {}): LeadershipActor {
  return {
    id: USER_ID,
    role: "team_member",
    churchId: CHURCH_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("an actor with no church is told to create one, and nothing is written", async () => {
  const h = harness(state());

  const result = await runConfirmLeadership(
    h.deps,
    actor({ churchId: null }),
    "yes"
  );

  assert.deepEqual(result, {
    status: "error",
    error: CREATE_CHURCH_FIRST_MESSAGE,
  });
  assert.equal(h.writes.length, 0);
});

test("anything that is not yes or no is refused before the church is read", async () => {
  const h = harness(state());

  const result = await runConfirmLeadership(h.deps, actor(), "maybe");

  assert.deepEqual(result, {
    status: "error",
    error: CHOOSE_AN_ANSWER_MESSAGE,
  });
  assert.equal(h.writes.length, 0);
});

test("a team member is refused once the plant HAS a planter — the seat closes the permission", async () => {
  const h = harness(state({ hasPlanterUser: true }));

  const result = await runConfirmLeadership(h.deps, actor(), "yes");

  assert.deepEqual(result, {
    status: "error",
    error: NOT_YOURS_TO_ANSWER_MESSAGE,
  });
  assert.equal(h.writes.length, 0);
});

test("a coach of the plant is never in scope, seat empty or not", async () => {
  const h = harness(state());

  const result = await runConfirmLeadership(
    h.deps,
    actor({ role: "coach" }),
    "yes"
  );

  assert.equal(result.status, "error");
  assert.equal(h.writes.length, 0);
});

test("an actor whose church id is not this church is refused", async () => {
  const h = harness(
    state({ churchId: "44444444-4444-4444-8444-444444444444" })
  );

  const result = await runConfirmLeadership(h.deps, actor(), "yes");

  assert.equal(result.status, "error");
  assert.equal(h.writes.length, 0);
});

test("a church that no longer exists is a refusal, not a crash", async () => {
  const h = harness(null);

  const result = await runConfirmLeadership(h.deps, actor(), "yes");

  assert.deepEqual(result, {
    status: "error",
    error: NOT_YOURS_TO_ANSWER_MESSAGE,
  });
});

// ---------------------------------------------------------------------------
// The three plans
// ---------------------------------------------------------------------------

test("the planter answering Yes only RECORDS — no role is written", async () => {
  const h = harness(state({ hasPlanterUser: true }));

  const result = await runConfirmLeadership(
    h.deps,
    actor({ role: "planter" }),
    "yes"
  );

  assert.deepEqual(result, { status: "saved" });
  assert.equal(h.writes[0].plan, "confirm");
});

test("a team member answering Yes on an empty seat CLAIMS it (OB-010)", async () => {
  const h = harness(state());

  const result = await runConfirmLeadership(h.deps, actor(), "yes");

  assert.deepEqual(result, { status: "saved" });
  assert.equal(h.writes[0].plan, "claim");
  assert.equal(h.writes[0].actorId, USER_ID);
});

test("No is the same decline from either of them, and changes nobody's role", async () => {
  for (const role of ["planter", "team_member"]) {
    const h = harness(state({ hasPlanterUser: role === "planter" }));

    const result = await runConfirmLeadership(h.deps, actor({ role }), "no");

    assert.deepEqual(result, { status: "saved" });
    assert.equal(h.writes[0].plan, "decline");
    assert.equal(h.writes[0].answer, "no");
  }
});

test("re-entry has no 'already answered' guard: a plant that said No may say Yes", async () => {
  const h = harness(
    state({ leadershipStatus: "no_planter", hasPlanterUser: true })
  );

  const result = await runConfirmLeadership(
    h.deps,
    actor({ role: "planter" }),
    "yes"
  );

  assert.deepEqual(result, { status: "saved" });
  assert.equal(h.writes[0].plan, "confirm");
});

// ---------------------------------------------------------------------------
// Losing, and failing
// ---------------------------------------------------------------------------

test("a lost claim reports the loss AND revalidates, so the loser stops seeing the prompt", async () => {
  const h = harness(state(), { written: false });

  const result = await runConfirmLeadership(h.deps, actor(), "yes");

  assert.deepEqual(result, { status: "error", error: CLAIM_LOST_MESSAGE });
  assert.equal(h.revalidations(), 1);
});

test("a failed write is reported, not thrown, and nothing is revalidated", async () => {
  const h = harness(state(), { throws: true });

  const result = await runConfirmLeadership(h.deps, actor(), "yes");

  assert.deepEqual(result, {
    status: "error",
    error: LEADERSHIP_SAVE_FAILED_MESSAGE,
  });
  assert.equal(h.revalidations(), 0);
});

// ---------------------------------------------------------------------------
// The SQL
// ---------------------------------------------------------------------------

const dialect = new PgDialect();

function render(statement: {
  getSQL: () => Parameters<PgDialect["sqlToQuery"]>[0];
}) {
  return dialect.sqlToQuery(statement.getSQL()).sql;
}

const CLAIM: LeadershipWrite = {
  plan: "claim",
  churchId: CHURCH_ID,
  actorId: USER_ID,
  answer: "yes",
};

test("the claim batch locks the church row FIRST", () => {
  const [lock] = claimPlanterStatements(CLAIM).map(render);

  assert.match(lock, /select .* from "churches" where .* for update/i);
});

test("the role claim only lands while NOBODY holds the planter seat", () => {
  const [, claim] = claimPlanterStatements(CLAIM).map(render);

  assert.match(claim, /update "users" set/i);
  assert.match(claim, /not exists/i);
  assert.match(claim, /"role" = \$\d+/i);
});

test("the status write is gated on THIS actor holding the role, not on any planter existing", () => {
  const [, , status] = claimPlanterStatements(CLAIM).map(render);

  assert.match(status, /update "churches" set/i);
  assert.match(status, /exists/i);
  // The subquery names the actor: a loser whose role write no-opped must not
  // ride the winner's planter into a "confirmed" the loser did not earn.
  assert.match(status, /"users"\."id" = \$\d+/i);
  assert.doesNotMatch(status, /not exists/i);
});

test("recording an answer is a plain church update — no users row is touched", () => {
  const sql = render(
    recordLeadershipStatement({ ...CLAIM, plan: "decline", answer: "no" })
  );

  assert.match(sql, /update "churches" set/i);
  assert.doesNotMatch(sql, /"users"/i);
});

test("the claim never names anybody but the acting user", () => {
  const params = dialect.sqlToQuery(
    claimPlanterStatements(CLAIM)[1].getSQL()
  ).params;

  assert.ok(params.includes(USER_ID));
  assert.ok(!params.includes(OTHER_USER_ID));
});
