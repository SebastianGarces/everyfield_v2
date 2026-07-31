import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OVERSIGHT_ELIGIBLE_CATEGORIES,
  OVERSIGHT_SHARING_FEATURE,
  OVERSIGHT_SHARING_TOGGLE,
  isOversightEligibleCategory,
  notificationCategories,
} from "./categories";
import type { EnqueueNotificationInput, EnqueueResult } from "./enqueue";
import {
  composeMilestone,
  fanOutToOversight,
  oversightMilestoneKinds,
  oversightMilestoneType,
  type OversightFanOutDeps,
  type OversightRecipient,
} from "./oversight";

// ----------------------------------------------------------------------------
// The oversight model, tested at the seam `enqueue` sits behind.
//
// The fake below is `enqueue`'s CONTRACT, not a second implementation of it: it
// refuses a recipient whose plant is not sharing and a category oversight is
// not eligible for, exactly as `runEnqueue` does, and records everything else.
// That is deliberate — these tests are about what the emitters COMPOSE and
// about the gate being consulted, and `enqueue.test.ts` is where the gate's own
// behaviour is proven against the index and the refusal rules.
// ----------------------------------------------------------------------------

const CHURCH = "11111111-1111-4111-8111-111111111111";
const ADMIN_A = "22222222-2222-4222-8222-222222222222";
const ADMIN_B = "33333333-3333-4333-8333-333333333333";

class FakeOversightEnqueue implements OversightFanOutDeps {
  readonly written: EnqueueNotificationInput[] = [];
  readonly calls: EnqueueNotificationInput[] = [];
  sharing: boolean;

  constructor(
    readonly recipients: OversightRecipient[],
    options: { sharing?: boolean } = {}
  ) {
    this.sharing = options.sharing ?? true;
  }

  async listOversightRecipients(): Promise<OversightRecipient[]> {
    return this.recipients;
  }

  async enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult> {
    this.calls.push(input);

    if (!isOversightEligibleCategory(input.category) || !this.sharing) {
      return {
        status: "skipped",
        notification: null,
        created: false,
        reason: "oversight_privacy",
      };
    }

    // The dedupe key is per (church, recipient, key) — the partial unique index
    // includes the recipient, so one key per event still writes one row each.
    const duplicate = this.written.some(
      (row) =>
        row.dedupeKey !== undefined &&
        row.dedupeKey === input.dedupeKey &&
        row.recipientUserId === input.recipientUserId &&
        row.churchId === input.churchId
    );
    if (duplicate) {
      return {
        status: "recorded",
        notification: null,
        created: false,
        reason: null,
      };
    }

    this.written.push(input);
    return {
      status: "recorded",
      notification: null,
      created: true,
      reason: null,
    };
  }
}

const facts = (kind: (typeof oversightMilestoneKinds)[number]) => ({
  churchId: CHURCH,
  plantName: "Grace Chapel",
  kind,
  occurrence: "occ-1",
  detail: "Something happened.",
});

// ----------------------------------------------------------------------------
// The model itself
// ----------------------------------------------------------------------------

test("oversight is eligible for exactly two categories, and neither is granular", () => {
  assert.deepEqual(
    [...OVERSIGHT_ELIGIBLE_CATEGORIES],
    ["milestones", "digest"]
  );

  const granular = notificationCategories.filter(
    (category) => !isOversightEligibleCategory(category)
  );
  assert.deepEqual(granular, [
    "tasks",
    "meetings",
    "communication",
    "teams",
    "phase",
  ]);
});

test("there are exactly three milestones, and they are the ruled three", () => {
  assert.deepEqual(
    [...oversightMilestoneKinds],
    ["invitation_accepted", "phase_advanced", "launch_date_changed"]
  );
});

test("one toggle, one privacy key — nothing is per category any more", () => {
  assert.equal(OVERSIGHT_SHARING_FEATURE, "oversight_activity");
});

// ----------------------------------------------------------------------------
// The toggle's copy — N-026 makes it a requirement, not decoration
// ----------------------------------------------------------------------------

test("the toggle copy promises a SUMMARY and denies a detailed activity list", () => {
  const prose = [
    OVERSIGHT_SHARING_TOGGLE.summary,
    ...OVERSIGHT_SHARING_TOGGLE.detail,
  ]
    .join(" ")
    .toLowerCase();

  // What is shared: a summary, once a day, as counts.
  assert.ok(prose.includes("summary"), "the copy never says 'summary'");
  assert.ok(
    prose.includes("once a day") || prose.includes("daily"),
    "the copy never says how often"
  );
  assert.ok(prose.includes("counts"), "the copy never says it is counts");

  // What is NOT shared, said out loud rather than left to inference — a planter
  // deciding this needs to know their notes and their people stay put.
  assert.ok(prose.includes("never see"), "the copy never states a limit");
  assert.ok(
    prose.includes("not an activity feed"),
    "the copy never denies a feed"
  );

  // And that it is reversible.
  assert.ok(
    prose.includes("turn it off"),
    "the copy never says it is reversible"
  );
});

test("the toggle's label names the audience in the planter's words", () => {
  assert.equal(
    OVERSIGHT_SHARING_TOGGLE.label,
    "Share activity with your sending church or network"
  );
  // Sentence case, no trailing period — a control label, not a sentence.
  assert.ok(!OVERSIGHT_SHARING_TOGGLE.label.endsWith("."));
});

// ----------------------------------------------------------------------------
// Composition
// ----------------------------------------------------------------------------

test("a milestone is composed in the `milestones` category, never a granular one", () => {
  for (const kind of oversightMilestoneKinds) {
    const input = composeMilestone(facts(kind), ADMIN_A);
    assert.equal(input.category, "milestones", kind);
    assert.equal(input.type, `oversight.milestone.${kind}`);
    assert.ok(input.title.includes("Grace Chapel"));
  }
});

test("the dedupe key is per EVENT and shared across recipients", () => {
  // The partial unique index is on (church_id, recipient_user_id, dedupe_key),
  // so one key per event is correct: each admin gets their own row, and a
  // replayed emitter writes none.
  const a = composeMilestone(facts("phase_advanced"), ADMIN_A);
  const b = composeMilestone(facts("phase_advanced"), ADMIN_B);

  assert.equal(a.dedupeKey, b.dedupeKey);
  assert.notEqual(a.recipientUserId, b.recipientUserId);
  assert.equal(
    a.dedupeKey,
    `${oversightMilestoneType("phase_advanced")}:${CHURCH}:occ-1`
  );
});

test("different milestones about the same plant do not collide", () => {
  const keys = oversightMilestoneKinds.map(
    (kind) => composeMilestone(facts(kind), ADMIN_A).dedupeKey
  );
  assert.equal(new Set(keys).size, oversightMilestoneKinds.length);
});

// ----------------------------------------------------------------------------
// Fan-out
// ----------------------------------------------------------------------------

test("with the plant sharing, every oversight recipient gets a row", async () => {
  const deps = new FakeOversightEnqueue([{ id: ADMIN_A }, { id: ADMIN_B }]);

  const report = await fanOutToOversight(deps, CHURCH, (recipientId) =>
    composeMilestone(facts("invitation_accepted"), recipientId)
  );

  assert.deepEqual(report, {
    considered: 2,
    recorded: 2,
    created: 2,
    skipped: 0,
    failed: 0,
  });
  assert.deepEqual(
    deps.written.map((row) => row.recipientUserId),
    [ADMIN_A, ADMIN_B]
  );
});

test("with the plant NOT sharing, no row is written for anyone", async () => {
  const deps = new FakeOversightEnqueue([{ id: ADMIN_A }, { id: ADMIN_B }], {
    sharing: false,
  });

  const report = await fanOutToOversight(deps, CHURCH, (recipientId) =>
    composeMilestone(facts("launch_date_changed"), recipientId)
  );

  assert.equal(report.skipped, 2);
  assert.equal(report.recorded, 0);
  assert.equal(deps.written.length, 0);
  // Enqueue was still CALLED — the refusal belongs to the gate, not to a
  // pre-check the emitter does for itself. Duplicating the gate here would give
  // us two places to forget it.
  assert.equal(deps.calls.length, 2);
});

test("a plant with no oversight considers nobody and writes nothing", async () => {
  const deps = new FakeOversightEnqueue([]);

  const report = await fanOutToOversight(deps, CHURCH, (recipientId) =>
    composeMilestone(facts("phase_advanced"), recipientId)
  );

  assert.equal(report.considered, 0);
  assert.equal(deps.calls.length, 0);
});

test("one recipient's failure does not cost the others theirs", async () => {
  // Same shape as enqueue's skip-not-throw ruling, one level up: the barred (or
  // here, broken) recipient sits in the MIDDLE, because with a throw it is the
  // recipient AFTER them who silently goes missing.
  const deps = new FakeOversightEnqueue([
    { id: ADMIN_A },
    { id: "broken" },
    { id: ADMIN_B },
  ]);
  const realEnqueue = deps.enqueue.bind(deps);
  deps.enqueue = async (input) => {
    if (input.recipientUserId === "broken") throw new Error("connection lost");
    return realEnqueue(input);
  };

  const report = await fanOutToOversight(deps, CHURCH, (recipientId) =>
    composeMilestone(facts("phase_advanced"), recipientId)
  );

  assert.equal(report.failed, 1);
  assert.equal(report.recorded, 2);
  assert.deepEqual(
    deps.written.map((row) => row.recipientUserId),
    [ADMIN_A, ADMIN_B]
  );
});

test("re-running an emitter writes nothing the second time", async () => {
  const deps = new FakeOversightEnqueue([{ id: ADMIN_A }]);
  const run = () =>
    fanOutToOversight(deps, CHURCH, (recipientId) =>
      composeMilestone(facts("invitation_accepted"), recipientId)
    );

  const first = await run();
  const second = await run();

  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.recorded, 1, "a replay should still report the row");
  assert.equal(deps.written.length, 1);
});
