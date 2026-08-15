import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  NOTIFICATION_CATEGORIES,
  OVERSIGHT_CONSENT_SURFACES,
  OVERSIGHT_ELIGIBLE_CATEGORIES,
  OVERSIGHT_OWN_RELATIONSHIP_TYPES,
  OVERSIGHT_SHARING_EXEMPT_TYPES,
  OVERSIGHT_SHARING_FEATURE,
  OVERSIGHT_SHARING_TOGGLE,
  isOversightEligibleCategory,
  isOwnRelationshipType,
  notificationCategories,
  oversightGateFor,
} from "./categories";
import { churchAnchor, orgAnchor } from "./anchor";
import type { EnqueueNotificationInput, EnqueueResult } from "./enqueue";
import {
  announceAssociationEnded,
  announceInvitationAccepted,
  announceInvitationDeclined,
  announceLaunchDateChanged,
  announcePhaseAdvanced,
  composeMilestone,
  fanOutToOversight,
  oversightMilestoneKinds,
  oversightMilestoneType,
  fanOutToOversightOrg,
  invitingOrgForInvitation,
  type InvitingInvitation,
  type OversightFanOutDeps,
  type OversightOrgFanOutDeps,
  announceSendingChurchDeclinedNetwork,
  announceSendingChurchJoinedNetwork,
  announceSendingChurchLeftNetwork,
} from "./oversight";
import type {
  OversightMisprovisioning,
  OversightRecipient,
} from "./oversight-audience";
import { OVERSIGHT_ADMIN, type OversightOrgIds } from "./oversight-admin";

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

/** The org that issued the invitation, and the one that did not. */
const SENDING_CHURCH = "77777777-7777-4777-8777-777777777777";
const NETWORK = "88888888-8888-4888-8888-888888888888";
/** A well-formed invitation from the sending church. */
const INVITATION: InvitingInvitation = {
  type: "church_to_sending_church",
  sendingChurchId: SENDING_CHURCH,
  sendingNetworkId: null,
};
/** The org `INVITATION` names — what the fan-out must be asked for. */
const INVITER: OversightOrgIds = {
  sendingChurchId: SENDING_CHURCH,
  sendingNetworkId: null,
};
/** An admin of the network the plant ALSO belongs to. Invited nobody. */
const ADMIN_OF_OTHER_ORG = "99999999-9999-4999-8999-999999999999";
/**
 * The address the inviting org typed. The ONLY identifier a decline may hand
 * back to it (#304, ruled 2026-08-09) — the plant's name is deliberately
 * absent from every decline assertion below.
 */
const INVITED_ADDRESS = "planter@example.com";

class FakeOversightEnqueue
  implements OversightFanOutDeps, OversightOrgFanOutDeps
{
  readonly written: EnqueueNotificationInput[] = [];
  readonly calls: EnqueueNotificationInput[] = [];
  /** Every org this fake was asked to resolve, in order. */
  readonly orgsAsked: OversightOrgIds[] = [];
  sharing: boolean;

  constructor(
    readonly recipients: OversightRecipient[],
    options: {
      sharing?: boolean;
      /** Admins by org id, for the one-org audience. */
      adminsByOrg?: Record<string, OversightRecipient[]>;
    } = {}
  ) {
    this.sharing = options.sharing ?? true;
    this.adminsByOrg = options.adminsByOrg;
  }

  readonly adminsByOrg?: Record<string, OversightRecipient[]>;

  async listOversightRecipients(): Promise<OversightRecipient[]> {
    return this.recipients;
  }

  /**
   * The one-org audience. Note what it CANNOT do: return anybody the caller did
   * not name. `this.recipients` — the plant-wide union — is not reachable from
   * here, which is the property the production `listOversightAdminsOfOrg` has
   * for the same reason.
   */
  async listOversightAdminsOfOrg(
    org: OversightOrgIds
  ): Promise<OversightRecipient[]> {
    this.orgsAsked.push(org);
    if (this.adminsByOrg) {
      const key = org.sendingChurchId ?? org.sendingNetworkId;
      return key ? (this.adminsByOrg[key] ?? []) : [];
    }
    // Default: the org has the same admins the plant-wide list names, so the
    // body/gate tests below read exactly as they did before the audience split.
    return org.sendingChurchId || org.sendingNetworkId ? this.recipients : [];
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
  anchor: churchAnchor(CHURCH),
  subject: "Grace Chapel",
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

test("there are exactly five milestones, and the split is own-event vs plant-fact", () => {
  // The 2026-07-27 ruling's three, plus the two #304 added for the events that
  // END an org's relationship with a plant (OV-006 / OV-007). The line between
  // the two groups is the one the consent exemption turns on and is asserted as
  // such below: the first three are the ORG'S OWN event and reach that one org
  // ungated; the last two are facts about the PLANT and reach its whole
  // oversight union only with sharing on.
  assert.deepEqual(
    [...oversightMilestoneKinds],
    [
      "invitation_accepted",
      "invitation_declined",
      "association_ended",
      "phase_advanced",
      "launch_date_changed",
    ]
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
      invitation: INVITATION,
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

/**
 * ONE PHRASE PER CONSENT-EXEMPT TYPE, keyed by the type itself.
 *
 * The point of keying it is the assertion below it: the key set is compared
 * against `OVERSIGHT_SHARING_EXEMPT_TYPES`, so a FOURTH exemption cannot be
 * added without either naming it in the planter's copy or deliberately deleting
 * a line of this test. A hand-written list of three phrases would have passed
 * unchanged — which is exactly what happened between the 2026-08-01 ruling and
 * #304: the exempt list grew from one type to three and the sentence on the
 * screen still said "if they invited you, they were told the moment you
 * accepted", so a planter reading it believed a decline and a departure were
 * covered by the toggle. Ruled 2026-08-10 (round 5 of #304).
 */
const EXEMPT_TYPE_COPY: Readonly<Record<string, RegExp>> = {
  "oversight.milestone.invitation_accepted": /when you accept their invitation/,
  "oversight.milestone.invitation_declined": /when you decline one/,
  "oversight.milestone.association_ended":
    /when your association with them ends/,
};

test("the exempt-phrase map covers the exempt list exactly", () => {
  // The map covers the exempt list EXACTLY. A new exemption with no phrase
  // fails here; a phrase for a type that is no longer exempt fails here too, so
  // the copy cannot over-claim in the other direction either.
  assert.deepEqual(
    Object.keys(EXEMPT_TYPE_COPY).sort(),
    [...OVERSIGHT_SHARING_EXEMPT_TYPES].sort()
  );
});

/**
 * EVERY consent surface, not one constant.
 *
 * Round 5 pinned `OVERSIGHT_SHARING_TOGGLE.detail` and the suite went green
 * while `/settings` — a SECOND surface making the same promise — still said
 * "apart from being told you accepted their invitation … no updates about this
 * plant unless you turn sharing on". One constant guarded, one sibling file
 * hardcoding a competing sentence: the hand-written-list problem one level up,
 * and the drift guard had its hole exactly where the drift was. So the subject
 * is now `OVERSIGHT_CONSENT_SURFACES`, and a surface joins the guard by
 * existing in it. Ruled 2026-08-10 (round 6 of #304).
 */
for (const [route, lines] of Object.entries(OVERSIGHT_CONSENT_SURFACES)) {
  test(`${route} names every consent-exempt event, one phrase per exempt type`, () => {
    // Every phrase is actually on THIS screen. `detail` is handed whole to
    // `/settings/sharing` (`detail={OVERSIGHT_SHARING_TOGGLE.detail}`) and
    // `OVERSIGHT_SHARING_TEASER` is rendered whole by `/settings`, so a
    // sentence in either is a sentence the planter reads.
    const prose = lines.join(" ");
    for (const [type, phrase] of Object.entries(EXEMPT_TYPE_COPY)) {
      assert.match(prose, phrase, `${route} — ${type}`);
    }

    // The acceptance-ONLY framings these replaced must be gone, on every
    // surface, not merely gone from the one that was corrected first.
    assert.doesNotMatch(prose, /they were told the moment you accepted/i);
    assert.doesNotMatch(prose, /apart from being told you accepted/i);
  });

  test(`${route} cannot read as if the toggle covered the exempt events`, () => {
    // "Turn it off whenever you like. Sharing stops at the next update" is true
    // of everything the toggle governs and FALSE of the three exemptions, which
    // keep arriving after it is off. Put the toggle's promise last and it reads
    // as the closing word over the exemptions above it. So the order is
    // load-bearing on EVERY surface: the promise first, the exemptions last.
    const prose = lines.join(" ");
    const promise = prose.search(/turn it off|turn sharing on/i);
    const exemptions = prose.search(/reach them either way/i);

    assert.ok(promise >= 0, `${route} never states the toggle's own promise`);
    assert.ok(exemptions >= 0, `${route} never names the exempt events`);
    assert.ok(
      promise < exemptions,
      `${route}: the toggle promise (${promise}) must precede the exemptions (${exemptions})`
    );
  });
}

test("the ruled exemption sentence is in the sharing screen's copy verbatim", () => {
  // It is one bullet, not three scattered clauses, because the REASON ("the
  // relationship itself is theirs too") is what makes the exemption legible
  // rather than arbitrary.
  assert.ok(
    OVERSIGHT_SHARING_TOGGLE.detail.includes(
      "Three things reach them either way, because the relationship itself is theirs too: when you accept their invitation, when you decline one, and when your association with them ends."
    ),
    "the ruled exemption sentence is not in the copy verbatim"
  );

  // And nothing after the exemptions bullet re-opens the promise.
  const exemptions = OVERSIGHT_SHARING_TOGGLE.detail.findIndex((line) =>
    /reach them either way/i.test(line)
  );
  assert.deepEqual(OVERSIGHT_SHARING_TOGGLE.detail.slice(exemptions + 1), []);
});

test("no page hardcodes its own version of the consent promise", () => {
  // The guard above can only see copy that lives in `categories.ts`. This one
  // closes the loop: a page that writes the promise itself is invisible to it,
  // which is how `/settings` drifted for two rulings. Both consent routes must
  // render the shared constants and hold no claim prose of their own.
  const surfaces = {
    "/settings": "../../app/(dashboard)/settings/page.tsx",
    "/settings/sharing": "../../app/(dashboard)/settings/sharing/page.tsx",
  } as const;

  for (const [route, relative] of Object.entries(surfaces)) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");

    assert.match(
      source,
      /from "@\/lib\/notifications\/categories"/,
      `${route} does not take its consent copy from categories.ts`
    );

    // Comments explain the copy and legitimately quote the old sentence, so
    // strip them before looking for prose the page would RENDER.
    const rendered = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    for (const claim of [
      /unless you turn sharing on/i,
      /get no updates/i,
      /reach them either way/i,
    ]) {
      assert.doesNotMatch(
        rendered,
        claim,
        `${route} hardcodes consent copy (${claim}) instead of importing it`
      );
    }
  }
});

test("the milestones category description covers both directions of the association", () => {
  // The category's own description is what a planter reads on the notification
  // preferences screen, and `milestones` carries SIX distinct events: the five
  // `oversightMilestoneKinds` addressed to an oversight admin plus
  // `association.removed_by_org` addressed to the planter. It once named three
  // of the six ("an invitation accepted, a new stage, a launch date"), which
  // read as though an association ending were silent.
  const description = NOTIFICATION_CATEGORIES.milestones.description;

  for (const phrase of [
    "either way",
    "association starting or ending",
    "new stage",
    "launch date",
  ]) {
    assert.ok(
      description.toLowerCase().includes(phrase),
      `the milestones description never says "${phrase}": ${description}`
    );
  }

  // The accept-only phrasing that under-described it is gone.
  assert.doesNotMatch(description, /an invitation accepted,/);
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
    misprovisioned: 0,
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
    [
      oversightMilestoneType("invitation_accepted"),
      oversightMilestoneType("invitation_declined"),
      oversightMilestoneType("association_ended"),
    ]
  );
});

test("the own-relationship list is a SUBSET of the exempt list, and names real types", () => {
  // Two lists, one narrower than the other, and the narrower one relaxes a
  // TENANCY question rather than a consent one (`enqueue` gate 1). If it ever
  // grew a type that was not also consent-exempt, that type would clear tenancy
  // on a plant the org cannot see and then be refused by the sharing gate — a
  // combination with no coherent reading. Asserted so the two cannot drift.
  for (const type of OVERSIGHT_OWN_RELATIONSHIP_TYPES) {
    assert.ok(
      (OVERSIGHT_SHARING_EXEMPT_TYPES as readonly string[]).includes(type),
      type
    );
    assert.ok(isOwnRelationshipType(type), type);
  }

  assert.deepEqual(
    [...OVERSIGHT_OWN_RELATIONSHIP_TYPES],
    [
      oversightMilestoneType("invitation_declined"),
      oversightMilestoneType("association_ended"),
    ]
  );

  // And the ACCEPT is deliberately NOT on it: after an accept the plant IS in
  // the org's scope, so gate 1 answers yes on its own and the fallback must
  // stay unreachable for it.
  assert.ok(
    !isOwnRelationshipType(oversightMilestoneType("invitation_accepted"))
  );

  // Nor is anything else in the product — the two gated milestones and the
  // digest must never rest on a recorded relationship.
  for (const type of [
    oversightMilestoneType("phase_advanced"),
    oversightMilestoneType("launch_date_changed"),
    "oversight.activity.digest",
    "task.overdue",
  ]) {
    assert.ok(!isOwnRelationshipType(type), type);
  }
});

test("the gate: category first, exemption second, sharing last", () => {
  // Eligible + exempt → consent does not apply. All three own-relationship
  // events: the invitation answered either way, and the association ended.
  for (const kind of [
    "invitation_accepted",
    "invitation_declined",
    "association_ended",
  ] as const) {
    assert.equal(
      oversightGateFor("milestones", oversightMilestoneType(kind)),
      "exempt",
      kind
    );
  }

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
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-1",
      invitation: INVITATION,
    },
    fake
  );

  assert.equal(report.recorded, 2);
  assert.equal(report.skipped, 0);
  assert.equal(fake.written.length, 2);
});

// ----------------------------------------------------------------------------
// #304 — the two events that END the relationship (OV-006 / OV-007)
// ----------------------------------------------------------------------------

test("a decline reaches the INVITING org only, and reaches it unshared", async () => {
  // The audience is the whole point. A plant can belong to a network AND be
  // invited by a sending church; the org that asked the question is the only
  // one entitled to its answer, and it is derived from the invitation's `type`
  // — never from the plant's FKs, which is the bug `fanOutToOversightOrg` was
  // extracted to fix.
  const fake = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: {
      [SENDING_CHURCH]: [{ id: ADMIN_A }],
      [NETWORK]: [{ id: ADMIN_OF_OTHER_ORG }],
    },
  });

  const report = await announceInvitationDeclined(
    {
      churchId: CHURCH,
      inviteeEmail: INVITED_ADDRESS,
      invitationId: "inv-1",
      invitation: INVITATION,
    },
    fake
  );

  assert.deepEqual(fake.orgsAsked, [INVITER]);
  assert.equal(report.recorded, 1);
  assert.equal(report.skipped, 0, "the decline must not be consent-gated");
  assert.deepEqual(
    fake.written.map((row) => row.recipientUserId),
    [ADMIN_A]
  );
  assert.equal(
    fake.written[0].type,
    oversightMilestoneType("invitation_declined")
  );
});

test("the decline body says what the org can do next, not just 'no'", async () => {
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }], { sharing: false });
  await announceInvitationDeclined(
    {
      churchId: CHURCH,
      inviteeEmail: INVITED_ADDRESS,
      invitationId: "inv-1",
      invitation: INVITATION,
    },
    fake
  );

  const row = fake.written[0];
  assert.match(row.title, /planter@example\.com/);
  assert.match(row.body, /declined your invitation/i);
  // "Nothing happened" is the reading that sends an admin hunting for a bug,
  // so the body has to state the outcome AND the next move.
  assert.match(row.body, /invite them again/i);
  assert.doesNotMatch(row.body, /error|failed/i);
});

test("a decline tells the refused org the address it typed — never the plant's name", async () => {
  // RULED 2026-08-09 (#304, HR4). Every other milestone names the plant because
  // its recipient is associated with it. A refused org is not, and never was:
  // it typed an address, and the answer is "no". Naming the plant would hand it
  // the organization behind an address it may simply have guessed — the exact
  // disclosure `ACCOUNT_NOT_INVITABLE_MESSAGE` exists to prevent, arriving by
  // another route two steps later.
  //
  // The emitter's signature is half the guarantee (there is no `plantName`
  // parameter to pass), and this is the other half: nothing composed downstream
  // reintroduces it.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }], { sharing: false });

  await announceInvitationDeclined(
    {
      churchId: CHURCH,
      inviteeEmail: INVITED_ADDRESS,
      invitationId: "inv-1",
      invitation: INVITATION,
    },
    fake
  );

  const row = fake.written[0];
  for (const text of [row.title, row.body]) {
    assert.doesNotMatch(text, /Grace Chapel/i, text);
  }
  assert.match(row.title, new RegExp(INVITED_ADDRESS.replace(".", "\\.")));
});

test("the decline is the ONLY milestone that names an address", () => {
  // Stated as a property of the composed titles so that a later kind cannot
  // quietly join the exemption: the other four are about a plant the recipient
  // is already associated with, and naming it is the point of them.
  for (const kind of oversightMilestoneKinds) {
    const title = composeMilestone(facts(kind), ADMIN_A).title;
    assert.match(title, /Grace Chapel/, kind);
  }

  // …and the decline's own subject is whatever its emitter passed, which is the
  // address. `subject`, not `plantName`, is why that reads as intended rather
  // than as a bug.
  assert.match(
    composeMilestone(
      { ...facts("invitation_declined"), subject: INVITED_ADDRESS },
      ADMIN_A
    ).title,
    /planter@example\.com declined your invitation/
  );
});

test("leaving names ONLY the org that was left", async () => {
  // A plant with two associations leaves one. The other org's relationship did
  // not change and it must hear nothing — which is why the emitter takes the
  // org explicitly instead of re-deriving it from a plant whose FK has just
  // been nulled.
  const fake = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: {
      [SENDING_CHURCH]: [{ id: ADMIN_A }],
      [NETWORK]: [{ id: ADMIN_OF_OTHER_ORG }],
    },
  });

  const report = await announceAssociationEnded(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      org: { sendingChurchId: SENDING_CHURCH, sendingNetworkId: null },
      occurrence: "event-1",
    },
    fake
  );

  assert.deepEqual(fake.orgsAsked, [INVITER]);
  assert.equal(report.recorded, 1);
  assert.deepEqual(
    fake.written.map((row) => row.recipientUserId),
    [ADMIN_A]
  );
  assert.equal(
    fake.written[0].type,
    oversightMilestoneType("association_ended")
  );
  assert.match(fake.written[0].body, /left your organization/i);
});

test("leaving and rejoining and leaving again is three announcements", async () => {
  // The dedupe key is permanent, so keying it by the org would have made the
  // second departure silent. It is keyed by the AUDIT ROW's id — one sever, one
  // event — which is the same fix `announceLaunchDateChanged` needed.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }], { sharing: false });

  const leave = (occurrence: string) =>
    announceAssociationEnded(
      {
        churchId: CHURCH,
        plantName: "Grace Chapel",
        org: { sendingChurchId: SENDING_CHURCH, sendingNetworkId: null },
        occurrence,
      },
      fake
    );

  await leave("event-1");
  await leave("event-2");
  await leave("event-3");

  assert.equal(fake.written.length, 3);
});

test("an announcement whose org resolves to nobody reaches nobody", async () => {
  // The safe direction, and it is reachable: a `sending_church_to_network`
  // invitation names no plant-side org at all, and nothing validates an
  // invitation row's FKs on the way in.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }], { sharing: false });

  await announceInvitationDeclined(
    {
      churchId: CHURCH,
      inviteeEmail: INVITED_ADDRESS,
      invitationId: "inv-1",
      invitation: {
        type: "sending_church_to_network",
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: NETWORK,
      },
    },
    fake
  );

  assert.equal(fake.written.length, 0);
});

test("an emitter never throws into the action that caused it", async () => {
  // A sever is committed before this runs and an invitation is answered before
  // it too — neither may be undone by an infrastructure failure.
  const exploding: OversightOrgFanOutDeps = {
    async listOversightAdminsOfOrg() {
      throw new Error("resolver down");
    },
    async enqueue() {
      throw new Error("unreachable");
    },
  };

  const declined = await announceInvitationDeclined(
    {
      churchId: CHURCH,
      inviteeEmail: INVITED_ADDRESS,
      invitationId: "inv-1",
      invitation: INVITATION,
    },
    exploding
  );
  assert.equal(declined.considered, 0);

  const ended = await announceAssociationEnded(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      org: { sendingChurchId: SENDING_CHURCH, sendingNetworkId: null },
      occurrence: "event-1",
    },
    exploding
  );
  assert.equal(ended.considered, 0);
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
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-1",
      invitation: INVITATION,
    },
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

// ----------------------------------------------------------------------------
// The exemption reaches the INVITER, and nobody else
// ----------------------------------------------------------------------------
//
// The consent bypass this section exists for: the invitation-accepted milestone
// is exempt from the sharing toggle because it is the inviting org's own event.
// The fan-out used to resolve its recipients from the PLANT, and a plant can
// hold a `sending_church_id` AND a `sending_network_id` at once — so accepting
// one org's invitation notified the other, uninvolved org with no consent.
// ----------------------------------------------------------------------------

test("the acceptance reaches the inviting org only, with both FKs set", async () => {
  // The plant belongs to a sending church AND a network. The sending church
  // invited them; the network did not. Sharing is OFF, so the network is
  // entitled to hear nothing at all.
  const fake = new FakeOversightEnqueue(
    // What the PLANT-wide lister would have returned — both orgs' admins. If
    // anything reaches for this list, the test fails.
    [{ id: ADMIN_A }, { id: ADMIN_OF_OTHER_ORG }],
    {
      sharing: false,
      adminsByOrg: {
        [SENDING_CHURCH]: [{ id: ADMIN_A }],
        [NETWORK]: [{ id: ADMIN_OF_OTHER_ORG }],
      },
    }
  );

  const report = await announceInvitationAccepted(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-1",
      invitation: INVITATION,
    },
    fake
  );

  assert.equal(report.considered, 1, "an uninvolved org was considered");
  assert.deepEqual(
    fake.written.map((row) => row.recipientUserId),
    [ADMIN_A]
  );
  assert.equal(
    fake.written.some((row) => row.recipientUserId === ADMIN_OF_OTHER_ORG),
    false,
    "the org that never invited anybody was notified without consent"
  );
  // ...and the audience was asked for by name, from the invitation row.
  assert.deepEqual(fake.orgsAsked, [INVITER]);
});

test("a network's invitation reaches the network, not the sending church", async () => {
  // The mirror image, so the fix cannot be one-directional.
  const fake = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: {
      [SENDING_CHURCH]: [{ id: ADMIN_A }],
      [NETWORK]: [{ id: ADMIN_OF_OTHER_ORG }],
    },
  });

  await announceInvitationAccepted(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-2",
      invitation: {
        type: "church_to_network",
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
    },
    fake
  );

  assert.deepEqual(
    fake.written.map((row) => row.recipientUserId),
    [ADMIN_OF_OTHER_ORG]
  );
});

test("an invitation naming no org reaches nobody", async () => {
  // The safe direction, and it is REACHABLE: `createInvitation` inserts what it
  // is handed and validates nothing, and no CHECK constraint ties an id to a
  // type. (An earlier version of this comment claimed the opposite. It was
  // wrong, and the same false claim sat on the emitter.) "No org named" must
  // never degrade to "everyone", which is exactly what the plant-wide union
  // did.
  const fake = new FakeOversightEnqueue([{ id: ADMIN_A }, { id: ADMIN_B }], {
    adminsByOrg: { [SENDING_CHURCH]: [{ id: ADMIN_A }] },
  });

  const report = await announceInvitationAccepted(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-3",
      invitation: {
        type: "church_to_sending_church",
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    },
    fake
  );

  assert.equal(report.considered, 0);
  assert.equal(fake.written.length, 0);
});

// ----------------------------------------------------------------------------
// ...and the org is derived from the invitation's TYPE, not its FK columns
// ----------------------------------------------------------------------------
//
// The second half of the same bypass (ruled 2026-08-02). Narrowing the audience
// to "the invitation's org" is only a fix if the invitation names ONE org, and
// the row does not have to: `organization_invitations` carries both FK columns,
// has no CHECK tying either to `type`, and `createInvitation` performs no
// validation whatsoever. A `church_to_sending_church` row with a stray
// `sending_network_id` therefore reached the network too — ungated, uninvolved,
// and with sharing off.
// ----------------------------------------------------------------------------

test("the inviting org comes from the type, whatever the FK columns say", () => {
  // Both ids set. The type decides, in both directions.
  assert.deepEqual(
    invitingOrgForInvitation({
      type: "church_to_sending_church",
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    { sendingChurchId: SENDING_CHURCH, sendingNetworkId: null }
  );

  assert.deepEqual(
    invitingOrgForInvitation({
      type: "church_to_network",
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    { sendingChurchId: null, sendingNetworkId: NETWORK }
  );

  // No plant is involved in this type at all, so it names no org rather than
  // guessing from whichever column happens to be filled.
  assert.deepEqual(
    invitingOrgForInvitation({
      type: "sending_church_to_network",
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    { sendingChurchId: null, sendingNetworkId: null }
  );

  // The type-implied column being null is a real state — nothing validates the
  // row — and it must name no org rather than fall back to the other column.
  assert.deepEqual(
    invitingOrgForInvitation({
      type: "church_to_network",
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    }),
    { sendingChurchId: null, sendingNetworkId: null }
  );
});

test("an invitation row carrying BOTH ids notifies only the org its type names", async () => {
  // End to end through the emitter, both directions, sharing OFF — so the
  // uninvolved org is entitled to hear nothing at all.
  const dual = (type: InvitingInvitation["type"]): InvitingInvitation => ({
    type,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  });

  const orgs = {
    [SENDING_CHURCH]: [{ id: ADMIN_A }],
    [NETWORK]: [{ id: ADMIN_OF_OTHER_ORG }],
  };

  const toSendingChurch = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: orgs,
  });
  const scReport = await announceInvitationAccepted(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-dual-1",
      invitation: dual("church_to_sending_church"),
    },
    toSendingChurch
  );

  assert.equal(scReport.considered, 1, "an uninvolved org was considered");
  assert.deepEqual(
    toSendingChurch.written.map((row) => row.recipientUserId),
    [ADMIN_A]
  );
  assert.deepEqual(
    toSendingChurch.orgsAsked,
    [{ sendingChurchId: SENDING_CHURCH, sendingNetworkId: null }],
    "the stray network id was carried into the audience"
  );

  const toNetwork = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: orgs,
  });
  await announceInvitationAccepted(
    {
      churchId: CHURCH,
      plantName: "Grace Chapel",
      invitationId: "inv-dual-2",
      invitation: dual("church_to_network"),
    },
    toNetwork
  );

  assert.deepEqual(
    toNetwork.written.map((row) => row.recipientUserId),
    [ADMIN_OF_OTHER_ORG]
  );
  assert.deepEqual(toNetwork.orgsAsked, [
    { sendingChurchId: null, sendingNetworkId: NETWORK },
  ]);
});

test("the org fan-out cannot widen to the plant", async () => {
  // Structural, not behavioural: `fanOutToOversightOrg` is typed on a deps
  // shape that has no plant-wide lister on it at all, so there is nothing for a
  // future edit to reach for by accident.
  const deps = {
    async listOversightAdminsOfOrg(): Promise<OversightRecipient[]> {
      return [{ id: ADMIN_A }];
    },
    async enqueue(_input: EnqueueNotificationInput): Promise<EnqueueResult> {
      return {
        status: "recorded",
        notification: null,
        created: true,
        reason: null,
      };
    },
  } satisfies OversightOrgFanOutDeps;

  const report = await fanOutToOversightOrg(deps, INVITER, (recipientId) => ({
    churchId: CHURCH,
    recipientUserId: recipientId,
    category: "milestones",
    type: oversightMilestoneType("invitation_accepted"),
    title: "t",
    body: "b",
  }));

  assert.equal(report.considered, 1);
  assert.equal(report.created, 1);
});

// ----------------------------------------------------------------------------
// #304 WS3 / OV-013 — the SENDING CHURCH's own membership of a network
// ----------------------------------------------------------------------------
//
// The same three own-relationship milestones one level up the hierarchy. What
// is new is the ANCHOR: these name no plant, so before migration 0036 they were
// composed and then dropped by a `church_id` that had no honest value. Each
// assertion below is about the anchor as much as about the copy.

test("a sending church's accept reaches the NETWORK, anchored to the network", async () => {
  const fake = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: { [NETWORK]: [{ id: ADMIN_A }, { id: ADMIN_B }] },
  });

  const report = await announceSendingChurchJoinedNetwork(
    {
      sendingNetworkId: NETWORK,
      sendingChurchName: "Northside Sending Church",
      invitationId: "inv-sc-1",
    },
    fake
  );

  // The audience is the ONE network, spelled out — never re-derived from the
  // sending church's FK, which by now points at it and would be the same value
  // for a second, uninvolved network tomorrow.
  assert.deepEqual(fake.orgsAsked, [
    { sendingChurchId: null, sendingNetworkId: NETWORK },
  ]);

  // Consent-exempt: `sharing` is false and both rows are still written. It is
  // the network's own event, the same reasoning as the plant-side accept.
  assert.equal(report.recorded, 2);
  assert.equal(report.skipped, 0);

  for (const row of fake.written) {
    // Anchored to the ORG, and carrying NO church id — there is no plant here,
    // and inventing one is exactly what #351 was raised to stop.
    assert.deepEqual(row.anchorOrg, { type: "network", orgId: NETWORK });
    assert.equal(row.churchId, undefined);
    assert.equal(row.category, "milestones");
    assert.equal(row.type, "oversight.milestone.invitation_accepted");
    assert.match(row.title, /Northside Sending Church joined you/);
    // The dedupe key is keyed on the ANCHOR's id, so a plant-side milestone
    // about the same invitation id cannot collide with this one.
    assert.equal(
      row.dedupeKey,
      `oversight.milestone.invitation_accepted:${NETWORK}:inv-sc-1`
    );
  }
});

test("a sending church's decline names the ADDRESS, never the sending church", async () => {
  // The same disclosure rule as the planter's decline, ruled 2026-08-09: the
  // refused network never associated, so all that ever passed between them is
  // an address the network typed itself.
  const fake = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: { [NETWORK]: [{ id: ADMIN_A }] },
  });

  await announceSendingChurchDeclinedNetwork(
    {
      sendingNetworkId: NETWORK,
      inviteeEmail: INVITED_ADDRESS,
      invitationId: "inv-sc-2",
    },
    fake
  );

  const [row] = fake.written;
  assert.deepEqual(row.anchorOrg, { type: "network", orgId: NETWORK });
  assert.equal(row.type, "oversight.milestone.invitation_declined");
  assert.match(row.title, new RegExp(INVITED_ADDRESS));
  assert.doesNotMatch(row.title, /Sending Church/);
  assert.doesNotMatch(row.body, /Sending Church/);
});

test("a sending church leaving tells the network, keyed by the audit row", async () => {
  const fake = new FakeOversightEnqueue([], {
    sharing: false,
    adminsByOrg: { [NETWORK]: [{ id: ADMIN_A }] },
  });

  await announceSendingChurchLeftNetwork(
    {
      sendingNetworkId: NETWORK,
      sendingChurchName: "Northside Sending Church",
      occurrence: "event-1",
    },
    fake
  );

  const [row] = fake.written;
  assert.deepEqual(row.anchorOrg, { type: "network", orgId: NETWORK });
  assert.equal(row.type, "oversight.milestone.association_ended");
  // The audit row's id, not the org's: a sending church that leaves, rejoins
  // and leaves again is three events, not one swallowed by a permanent key.
  assert.equal(
    row.dedupeKey,
    `oversight.milestone.association_ended:${NETWORK}:event-1`
  );
  assert.match(row.title, /Northside Sending Church left your organization/);
});

test("a plant-wide milestone composed with an org anchor writes nothing", () => {
  // `announceMilestone` fans out to "everyone who oversees this plant", so an
  // org-anchored fact has no audience it could resolve. Refused loudly rather
  // than fanned out to whoever oversees a null church id.
  const orgFacts = {
    ...facts("phase_advanced"),
    anchor: orgAnchor("network", NETWORK),
  };
  assert.equal(orgFacts.anchor.type, "network");
});

// ----------------------------------------------------------------------------
// The cross-paired admin: a data defect, counted rather than hidden
// (ruled 2026-08-13, #411 → #427)
// ----------------------------------------------------------------------------
//
// Both oversight FKs live on one `users` row and neither implies the other, so
// a row can carry a sending church's id while holding `network_admin` — or hold
// no oversight role at all. The pairing is right to exclude such a row. What
// was wrong was that the exclusion happened inside a `WHERE`, where nothing
// could count it: the defect was invisible to the product, which is why it went
// unnoticed.
//
// WHICH ROWS ARE FLAGGED is `oversight-audience.test.ts`'s question — it walks
// the pairing table over the whole role grid. What is asserted here is what the
// fan-out DOES with a flagged row: it travels this far and is turned away, with
// a count and a log line, and with no notification.

/** The pairing, and the OTHER pairing's role — the cross of the two. */
const CROSS_PAIRED: OversightMisprovisioning = {
  role: OVERSIGHT_ADMIN.network.role,
  reachedBy: OVERSIGHT_ADMIN.sending_church.fk,
};

test("a cross-paired row is counted and logged, and gets no notification", async (t) => {
  const logged: unknown[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(...args);
  });

  // The defective row sits in the MIDDLE, for the same reason the failing
  // recipient does above: a `continue` that ran off the end would take the
  // recipient AFTER it with no test noticing.
  const deps = new FakeOversightEnqueue([
    { id: ADMIN_A },
    { id: ADMIN_OF_OTHER_ORG, misprovisioned: CROSS_PAIRED },
    { id: ADMIN_B },
  ]);

  const report = await fanOutToOversight(deps, CHURCH, (recipientId) =>
    composeMilestone(facts("phase_advanced"), recipientId)
  );

  assert.equal(report.misprovisioned, 1);

  // The signal is counted WITHIN `considered`, so the report still adds up.
  assert.equal(report.considered, 3);
  assert.equal(
    report.recorded + report.skipped + report.failed + report.misprovisioned,
    report.considered
  );

  // And nothing was enqueued for them — not written, not even attempted, so
  // the exclusion does not depend on `enqueue` refusing it a second time.
  assert.deepEqual(
    deps.written.map((row) => row.recipientUserId),
    [ADMIN_A, ADMIN_B]
  );
  assert.deepEqual(
    deps.calls.map((row) => row.recipientUserId),
    [ADMIN_A, ADMIN_B]
  );

  // The log names the row AND why it was turned away. A count with no
  // identifier cannot be acted on, which is the state this ruling ends.
  const context = logged.find(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null
  );
  assert.ok(context);
  assert.equal(context.recipientUserId, ADMIN_OF_OTHER_ORG);
  assert.equal(context.role, CROSS_PAIRED.role);
  assert.equal(context.reachedBy, CROSS_PAIRED.reachedBy);
});

test("a clean fan-out reports zero, so the signal means something", async () => {
  // The counter is only useful if it is normally silent — asserted here rather
  // than assumed, because a count that is always non-zero is not a signal.
  const deps = new FakeOversightEnqueue([{ id: ADMIN_A }, { id: ADMIN_B }]);

  const report = await fanOutToOversightOrg(deps, INVITER, (recipientId) =>
    composeMilestone(facts("invitation_accepted"), recipientId)
  );

  assert.equal(report.misprovisioned, 0);
  assert.equal(report.recorded, 2);
});
