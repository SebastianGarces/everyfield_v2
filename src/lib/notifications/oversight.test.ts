import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OVERSIGHT_ELIGIBLE_CATEGORIES,
  OVERSIGHT_SHARING_EXEMPT_TYPES,
  OVERSIGHT_SHARING_FEATURE,
  OVERSIGHT_SHARING_TOGGLE,
  isOversightEligibleCategory,
  notificationCategories,
  oversightGateFor,
} from "./categories";
import type { EnqueueNotificationInput, EnqueueResult } from "./enqueue";
import {
  announceInvitationAccepted,
  announceLaunchDateChanged,
  announcePhaseAdvanced,
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

    // Mirrors `runEnqueue`'s oversight gate: the category allow-list first, then
    // the plant's toggle — which a consent-exempt `type` is not subject to.
    const gate = oversightGateFor(input.category, input.type);
    if (gate === "denied" || (gate === "requires_sharing" && !this.sharing)) {
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

test("the invitation milestone does not describe the toggle as off", () => {
  // This row is written only when `enqueue`'s third gate passed — i.e. when
  // `share_activity_with_oversight` was ALREADY true. The old body told the
  // reader their summary "will start arriving once they turn sharing on",
  // which was therefore false in every state in which it could be delivered.
  //
  // The structural consequence stands and is documented at the emitter: in the
  // ordinary order (accept, then decide about sharing) this milestone is
  // skipped and never retried. Fixing THAT means either exempting one
  // milestone from the consent gate or retrying it on opt-in, both of which are
  // rulings. Telling the truth in the body is not.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }]);

  return announceInvitationAccepted(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-1",
    },
    fake
  ).then(() => {
    const body = fake.written[0].body;
    assert.doesNotMatch(body, /turn sharing on/i);
    assert.doesNotMatch(body, /once they/i);
    assert.match(body, /accepted your invitation/i);
  });
});

test("the copy admits what this toggle does NOT cover", () => {
  // The security finding this bullet answers: `getOversightPlantHealth`
  // (`src/lib/phase-engine/oversight/read.ts`) returns every accessible plant's
  // name, current phase and days-until-launch to an oversight admin with no
  // privacy gate at all. That is the oversight dashboard working as designed —
  // but it means a consent screen claiming "they see nothing unless you turn
  // this on" was false about precisely the two facts the milestones mention.
  //
  // A consent control that overstates its own reach is worse than none: the
  // planter decides on the strength of a guarantee the system does not offer.
  // If a ruling ever brings that listing under this toggle, delete the bullet
  // AND this test — not one of them.
  const prose = OVERSIGHT_SHARING_TOGGLE.detail.join(" ").toLowerCase();

  assert.ok(
    prose.includes("does not cover"),
    "the copy never admits a limit to what the toggle governs"
  );
  assert.ok(
    prose.includes("already listed on their dashboard"),
    "the copy never names the ungated portfolio listing"
  );
  for (const fact of ["current stage", "launch date"]) {
    assert.ok(prose.includes(fact), `the copy never names "${fact}"`);
  }
});

test("no copy anywhere promises totality", () => {
  // "see nothing" / "sees nothing" is the specific false claim that shipped.
  // It is asserted here rather than only on the screen because the screen's
  // teaser and this module's detail have to agree, and this is the file the
  // gate lives beside.
  const prose = [
    OVERSIGHT_SHARING_TOGGLE.label,
    OVERSIGHT_SHARING_TOGGLE.summary,
    ...OVERSIGHT_SHARING_TOGGLE.detail,
  ]
    .join(" ")
    .toLowerCase();

  assert.doesNotMatch(prose, /sees? nothing/);
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

// ----------------------------------------------------------------------------
// The consent exemption (ruled 2026-08-01, amending N-026)
// ----------------------------------------------------------------------------

test("the exempt list names a type the emitters actually produce", () => {
  // The list is spelled out in ./categories to avoid an import cycle, so this
  // is the only thing stopping it from drifting into an exemption that matches
  // nothing — a silent revert of the ruling, invisible to every other test.
  assert.deepEqual(
    [...OVERSIGHT_SHARING_EXEMPT_TYPES],
    [oversightMilestoneType("invitation_accepted")]
  );
});

test("the gate: category first, exemption second, sharing last", () => {
  // Eligible + exempt → consent does not apply.
  assert.equal(
    oversightGateFor(
      "milestones",
      oversightMilestoneType("invitation_accepted")
    ),
    "exempt"
  );

  // Eligible, not exempt → the plant decides. Both remaining milestones.
  for (const kind of ["phase_advanced", "launch_date_changed"] as const) {
    assert.equal(
      oversightGateFor("milestones", oversightMilestoneType(kind)),
      "requires_sharing"
    );
  }
  assert.equal(
    oversightGateFor("digest", "oversight.activity.digest"),
    "requires_sharing"
  );

  // The safety property: an exempt type smuggled into a granular category is
  // DENIED, not exempted. Order is what guarantees this, so it is asserted
  // rather than assumed.
  for (const category of notificationCategories.filter(
    (c) => !isOversightEligibleCategory(c)
  )) {
    assert.equal(
      oversightGateFor(category, oversightMilestoneType("invitation_accepted")),
      "denied",
      category
    );
  }
});

test("the invitation milestone is emitted with the plant NOT sharing", async () => {
  // The ruling: "your invitation was accepted" is the SENDING CHURCH'S own
  // event. Before it, the toggle defaulted off and a planter decided about
  // sharing only after joining — so this milestone was refused in essentially
  // every real case and never retried.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }, { id: ADMIN_B }], {
    sharing: false,
  });

  const report = await announceInvitationAccepted(
    { churchId: CHURCH, plantName: "Grace Chapel", invitationId: "inv-1" },
    fake
  );

  assert.equal(report.recorded, 2);
  assert.equal(report.skipped, 0);
  assert.equal(fake.written.length, 2);
});

test("the other two milestones are still refused with the plant not sharing", async () => {
  // The line the exemption does NOT cross: a phase advance and a launch date
  // are facts about the plant's own progress.
  const phase = new FakeOversightEnqueue([{ id: ADMIN_A }], { sharing: false });
  await announcePhaseAdvanced(
    { churchId: CHURCH, plantName: "Grace Chapel", toPhase: 3 },
    phase
  );
  assert.equal(phase.written.length, 0);

  const launch = new FakeOversightEnqueue([{ id: ADMIN_A }], {
    sharing: false,
  });
  await announceLaunchDateChanged(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      launchDate: "2026-10-04",
      changedAt: new Date("2026-08-01T10:00:00.000Z"),
    },
    launch
  );
  assert.equal(launch.written.length, 0);
});

test("the invitation body is true whether or not the plant shares", async () => {
  // Under the exemption this row is read MOST often by someone who will get
  // nothing further, so a body promising "you'll get a summary" would be a
  // promise the product does not keep.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }], { sharing: false });
  await announceInvitationAccepted(
    { churchId: CHURCH, plantName: "Grace Chapel", invitationId: "inv-1" },
    fake
  );

  const body = fake.written[0].body;
  assert.match(body, /accepted your invitation/i);
  // It must not assert that anything further WILL arrive.
  assert.doesNotMatch(body, /you'?ll get/i);
  assert.doesNotMatch(body, /turn sharing on/i);
  // It must say whose choice that is.
  assert.match(body, /theirs to switch on/i);
});

// ----------------------------------------------------------------------------
// The launch-date milestone keys the CHANGE, not the value
// ----------------------------------------------------------------------------

test("moving a launch date BACK to a previously announced one is announced", async () => {
  // The bug this pins: the dedupe key is permanent, so keying it by the date
  // value meant 4 Oct → 1 Nov → 4 Oct produced two announcements and then
  // silence — and a launch date moving back is the most newsworthy version of
  // this milestone, not a duplicate of it.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }]);

  const move = (launchDate: string, changedAt: string) =>
    announceLaunchDateChanged(
      {
        churchId: CHURCH,
        plantName: "Grace Chapel",
        launchDate,
        changedAt: new Date(changedAt),
      },
      fake
    );

  await move("2026-10-04", "2026-08-01T10:00:00.000Z");
  await move("2026-11-01", "2026-08-02T10:00:00.000Z");
  await move("2026-10-04", "2026-08-03T10:00:00.000Z");

  assert.equal(
    fake.written.length,
    3,
    "a revert to an earlier date was swallowed"
  );
  assert.equal(
    new Set(fake.written.map((row) => row.dedupeKey)).size,
    3,
    "two changes shared a dedupe key"
  );
});

test("replaying ONE launch-date change announces once", async () => {
  // Replay protection still has to work: the same change carries the same
  // instant, so a retry of the announcement alone dedupes.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }]);
  const once = () =>
    announceLaunchDateChanged(
      {
        churchId: CHURCH,
        plantName: "Grace Chapel",
        launchDate: "2026-10-04",
        changedAt: new Date("2026-08-01T10:00:00.000Z"),
      },
      fake
    );

  await once();
  await once();

  assert.equal(fake.written.length, 1);
});
