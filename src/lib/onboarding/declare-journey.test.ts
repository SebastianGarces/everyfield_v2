import assert from "node:assert/strict";

import { SeatRefusalError } from "@/lib/auth/seats";
import { mock, test } from "node:test";

import { runDeclareJourney, type DeclareJourneyDeps } from "./declare-journey";
import type { OnboardingActor } from "./create-church";

// ----------------------------------------------------------------------------
// F12 / OB-003 + OB-005 — step 3's write path, driven through its deps.
//
// Every ruled branch is exercised by CALLING it, without a request or a
// database: the date-before-stage ordering, the "no date yet" re-entry
// refusal (#306 HR4), `already_declared` reporting the STORED phase (ruled
// 2026-08-09), and the launch date surviving a refused stage. The SQL-level
// once-only guard is the unique index (migration 0033), pinned by
// `src/lib/phase-engine/transitions/declaration-race.test.ts` — what this
// file pins is what the orchestration does with each answer.
// ----------------------------------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

type Call =
  | { kind: "schedule"; targetDate: string }
  | { kind: "readLaunch"; churchId: string }
  | { kind: "declare"; churchId: string; userId: string; phase: number }
  | { kind: "revalidate" };

function harness(
  options: {
    scheduleFails?: string;
    storedLaunchDate?: string | null;
    declared?: { status: "declared" | "already_declared"; phase: number };
    declareFails?: boolean;
  } = {}
) {
  const calls: Call[] = [];

  const deps: DeclareJourneyDeps = {
    async scheduleLaunch({ targetDate }) {
      calls.push({ kind: "schedule", targetDate });
      if (options.scheduleFails) {
        return { success: false, error: options.scheduleFails };
      }
      return { success: true, data: { targetDate } };
    },
    async readLaunch(churchId) {
      calls.push({ kind: "readLaunch", churchId });
      if (options.storedLaunchDate === undefined) return null;
      return { targetDate: options.storedLaunchDate };
    },
    async declareInitialPhase(churchId, userId, { phase }) {
      calls.push({ kind: "declare", churchId, userId, phase });
      if (options.declareFails) throw new Error("insert blew up");
      return options.declared ?? { status: "declared", phase };
    },
    revalidate() {
      calls.push({ kind: "revalidate" });
    },
  };

  return { deps, calls, kinds: () => calls.map((call) => call.kind) };
}

/**
 * The plant's Owner. All three tenancy FKs are named because `OnboardingActor`
 * is `SeatFields`: a fixture that omitted one would be asserting about a shape
 * `isChurchLevelOwner` never sees.
 */
function planter(overrides: Partial<OnboardingActor> = {}): OnboardingActor {
  return {
    id: USER_ID,
    seat: "owner",
    churchId: CHURCH_ID,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Who may declare, and with what
// ----------------------------------------------------------------------------

test("a non-planter is refused before anything is written", async () => {
  const { deps, calls } = harness();

  // A throw, not a rendered outcome — see `create-church.test.ts` for why.
  await assert.rejects(
    () => runDeclareJourney(deps, planter({ seat: null }), { stage: "3" }),
    (error: Error) => error instanceof SeatRefusalError
  );

  assert.deepEqual(calls, []);
});

test("a planter with no church is refused before anything is written", async () => {
  const { deps, calls } = harness();

  const result = await runDeclareJourney(deps, planter({ churchId: null }), {
    stage: "3",
  });

  assert.equal(result.status, "error");
  assert.deepEqual(calls, []);
});

test("an unknown stage is refused, never defaulted to Discovery", async () => {
  // A POST carrying `stage=9` is a caller error, not a declaration the planter
  // made — phase history is append-only, so there is no taking a default back.
  const { deps, calls } = harness();

  for (const stage of ["9", "-1", "", "phase-3"]) {
    const result = await runDeclareJourney(deps, planter(), { stage });
    assert.equal(result.status, "error", stage);
  }
  assert.deepEqual(calls, []);
});

test("a malformed date is refused under the date question, before any write", async () => {
  const { deps, calls } = harness();

  const result = await runDeclareJourney(deps, planter(), {
    stage: "3",
    targetDate: "not-a-date",
  });

  assert.equal(result.status, "error");
  assert.equal(result.status === "error" && result.field, "date");
  assert.deepEqual(calls, []);
});

// ----------------------------------------------------------------------------
// The date goes first, through the launch rail
// ----------------------------------------------------------------------------

test("the date is scheduled BEFORE the declaration captures its snapshot", async () => {
  // The declaration's fact snapshot includes the launch countdown. Declared
  // first, the plant's own audit row would record it as having no launch date
  // moments before it acquired one.
  const { deps, calls, kinds } = harness();

  const result = await runDeclareJourney(deps, planter(), {
    stage: "3",
    targetDate: "2027-03-07",
  });

  assert.deepEqual(result, {
    status: "declared",
    phase: 3,
    targetDate: "2027-03-07",
  });
  assert.deepEqual(kinds(), ["schedule", "declare", "revalidate"]);
  assert.deepEqual(calls[2], { kind: "revalidate" });
});

test("a refused date stops the step — the stage is not declared without it", async () => {
  const { deps, kinds } = harness({ scheduleFails: "That day is in the past" });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "3",
    targetDate: "2020-01-01",
  });

  assert.deepEqual(result, {
    status: "error",
    field: "date",
    error: "That day is in the past",
  });
  assert.deepEqual(kinds(), ["schedule"]);
});

// ----------------------------------------------------------------------------
// "No date yet" (OB-003) — silence on a first pass, an ANSWER on re-entry
// ----------------------------------------------------------------------------

test("'no date yet' on a first pass writes no launch row at all", async () => {
  // No stored launch: the branch reads and moves on. The countdown stays
  // empty, which is the AC — no placeholder row, no `planning` status.
  const { deps, kinds } = harness({ storedLaunchDate: undefined });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "1",
    targetDate: null,
  });

  assert.deepEqual(result, { status: "declared", phase: 1, targetDate: null });
  assert.deepEqual(kinds(), ["readLaunch", "declare", "revalidate"]);
});

test("an empty date input means the same as the explicit 'no date yet'", async () => {
  const { deps, kinds } = harness({ storedLaunchDate: null });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "1",
    targetDate: "   ",
  });

  assert.equal(result.status, "declared");
  assert.deepEqual(kinds(), ["readLaunch", "declare", "revalidate"]);
});

test("'no date yet' over a stored date is REFUSED, and nothing is written", async () => {
  // #306 HR4, ruled: there is no unschedule write path, so the honest answer
  // is a refusal that names the stored day and where it can be moved — never
  // silence over a countdown the radio hint promised would be empty.
  const { deps, kinds } = harness({ storedLaunchDate: "2027-03-07" });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "1",
    targetDate: null,
  });

  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.field, "date");
    assert.match(result.error, /already set to/);
    assert.match(result.error, /launch page/);
  }
  // The refusal comes BEFORE the declaration: no date write, no stage write.
  assert.deepEqual(kinds(), ["readLaunch"]);
});

// ----------------------------------------------------------------------------
// A second declaration is REFUSED, and the refusal is said out loud
// ----------------------------------------------------------------------------

test("already_declared reports the STORED phase, not the submitted one", async () => {
  // Ruled 2026-08-09: the first declaration is the one that is history. The
  // planter submitted 5; the record says 2; the dashboard is about to render 2.
  const { deps } = harness({
    declared: { status: "already_declared", phase: 2 },
  });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "5",
    targetDate: "2027-03-07",
  });

  assert.deepEqual(result, {
    status: "already_declared",
    phase: 2,
    targetDate: "2027-03-07",
  });
});

test("the launch date survives a refused declaration, and the planter is told", async () => {
  // The date rode the same form and DID save — `targetDate` carries it so the
  // step can say so, or "already recorded" reads as "nothing went through".
  const { deps, kinds } = harness({
    declared: { status: "already_declared", phase: 2 },
  });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "5",
    targetDate: "2027-03-07",
  });

  assert.equal(
    result.status === "already_declared" && result.targetDate,
    "2027-03-07"
  );
  // The refusal still revalidates: the flow re-renders from what is stored.
  assert.deepEqual(kinds(), ["schedule", "declare", "revalidate"]);
});

test("a failed declaration is reported as a form error, not thrown", async () => {
  mock.method(console, "error", () => {});
  const { deps, kinds } = harness({ declareFails: true });

  const result = await runDeclareJourney(deps, planter(), {
    stage: "3",
    targetDate: null,
  });

  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.field, "form");
  // No revalidate on the failure path — nothing changed to re-render.
  assert.deepEqual(kinds(), ["readLaunch", "declare"]);
  mock.restoreAll();
});
