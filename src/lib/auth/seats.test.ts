import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatFields } from "./tenancy";
import { CAPABILITY_BY_EXPORT } from "./capability-map";
import {
  ADMIN_PLUS,
  OWNER_ONLY,
  holdsSeatFor,
  type Capability,
} from "./seat-rules";

// ============================================================================
// WHO MAY DO WHAT — the ruling 185 (1) / AS-003..AS-008 matrix, asserted.
//
// `requireSeat` is `verifySession()` followed by `holdsSeatFor`, so every
// question about WHO is a question about `holdsSeatFor` and needs no session
// and no database. What a database test would add here is the mint, and
// `seat-guard.test.ts` already proves every endpoint reaches it.
//
// THE ACCOUNTS BELOW ARE THE PRODUCT'S WHOLE POPULATION. Three seats in a
// plant, three in each kind of oversight org, a coach, and the two shapes that
// are neither: the Owner who has not created their plant yet, and the
// two-tenancy data defect. Each capability is asserted against all of them, so
// a new verb cannot be added without deciding what a coach and an org Member
// get — which is the decision that gets skipped when a matrix lives per module.
// ============================================================================

const account = (fields: Partial<SeatFields>): SeatFields => ({
  seat: null,
  churchId: null,
  sendingChurchId: null,
  sendingNetworkId: null,
  ...fields,
});

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";

const plantOwner = account({ seat: "owner", churchId: PLANT });
const plantAdmin = account({ seat: "admin", churchId: PLANT });
const plantMember = account({ seat: "member", churchId: PLANT });

/** Coaching is an assignment, never a seat (AS-008): a `church_id`, no seat. */
const coach = account({ churchId: PLANT });

/** Registration mints this one; the plant arrives afterwards (AS-012). */
const ownerWithNoPlantYet = account({ seat: "owner" });

const orgOwner = account({ seat: "owner", sendingChurchId: SENDING_CHURCH });
const orgAdmin = account({ seat: "admin", sendingChurchId: SENDING_CHURCH });
const orgMember = account({ seat: "member", sendingChurchId: SENDING_CHURCH });

const networkOwner = account({ seat: "owner", sendingNetworkId: NETWORK });
const networkAdmin = account({ seat: "admin", sendingNetworkId: NETWORK });

/**
 * The row migration 0050 §1 had to repair twelve of. Nothing in the schema
 * forbids it, so every predicate has to decide what it is — and the answer is
 * NOTHING, in both directions (`memory/invariants.md` → Seats & Tenancy).
 */
const twoTenancies = account({
  seat: "owner",
  churchId: PLANT,
  sendingNetworkId: NETWORK,
});

const EVERY_ACCOUNT: [string, SeatFields][] = [
  ["plant Owner", plantOwner],
  ["plant Admin", plantAdmin],
  ["plant Member", plantMember],
  ["coach", coach],
  ["Owner with no plant yet", ownerWithNoPlantYet],
  ["sending-church Owner", orgOwner],
  ["sending-church Admin", orgAdmin],
  ["sending-church Member", orgMember],
  ["network Owner", networkOwner],
  ["network Admin", networkAdmin],
  ["two-tenancy defect", twoTenancies],
];

/** Assert exactly who carries a capability — the rest are refused. */
function only(capability: Capability, allowed: SeatFields[]) {
  for (const [name, who] of EVERY_ACCOUNT) {
    assert.equal(
      holdsSeatFor(who, capability),
      allowed.includes(who),
      `${name} ${allowed.includes(who) ? "must" : "must not"} carry ${capability}`
    );
  }
}

// ----------------------------------------------------------------------------
// AS-003 / ruling 185 (1) — the Owner-only verbs refuse an Admin, in BOTH
// tenancy kinds
// ----------------------------------------------------------------------------

test("a plant's Owner-only verbs refuse the plant's Admin and Member", () => {
  for (const capability of [
    "sharing.toggle",
    "association.leave",
    "launch.schedule",
    "phase.declare",
  ] as const) {
    only(capability, [plantOwner]);
  }
});

test("an org's Owner-only verbs refuse the org's Admin and Member", () => {
  // BOTH KINDS. `sending_church_admin` and `network_admin` were two role names
  // for one rule; under the seat model they are one rule read in two tenancies,
  // and an org Admin is a seat neither role could express — so this is the
  // assertion that the new seat is not quietly admitted where no role was.
  for (const capability of [
    "org.association.sever",
    "org.association.leave",
    "org.invitation.manage",
    "org.settings",
  ] as const) {
    only(capability, [orgOwner, networkOwner]);
  }
});

test("answering an association reaches both sides' Owners and nobody else", () => {
  // `any` tenancy, OWNER_ONLY seats: a plant answers a sending church or a
  // network, and a sending church answers a network. WHICH side this caller is
  // on is matched against the invitation's target downstream — the seat half is
  // all that can be settled before the parse.
  only("association.answer", [
    plantOwner,
    ownerWithNoPlantYet,
    orgOwner,
    networkOwner,
  ]);
});

test("seat management is the Owner's in every tenancy (AS-015/016/017)", () => {
  only("seat.manage", [
    plantOwner,
    ownerWithNoPlantYet,
    orgOwner,
    networkOwner,
  ]);
});

test("creating the plant admits the Owner who has none yet, and only them", () => {
  // `church-level`, not `plant`: registration mints an Owner with `church_id`
  // null who creates the plant from the dashboard afterwards. A `plant` tenancy
  // here would refuse the only account that ever calls it.
  only("church.create", [plantOwner, ownerWithNoPlantYet]);
});

// ----------------------------------------------------------------------------
// AS-004 / AS-006 — Admin-and-above refuses a Member, across the four domains
// ----------------------------------------------------------------------------

test("the feature-data writes refuse a plant Member (AS-004)", () => {
  for (const capability of [
    "people.write",
    "meetings.write",
    "tasks.write",
    "teams.write",
    "communication.send",
    "church.profile",
    "phase.signal",
  ] as const) {
    only(capability, [plantOwner, plantAdmin]);
  }
});

test("a Member's own-duty writes still succeed (AS-006)", () => {
  // THE SEAT HALF ONLY. `tasks.own`'s subject half is asked after the parse by
  // `assertMayActOnTask`, which this cannot see; `own-duty.test.ts` drives the
  // action for that.
  //
  // The other two own-duty writes AS-006 names — a Member's meeting RSVP and
  // their own ministry team — are NOT here, and their absence is the point.
  // `ministry_teams.leader_id` and the meeting guest list reference
  // `persons.id`, and nothing links a person row to an account until AS-013, so
  // a `SEATED` capability for them would be a floor with nothing above it:
  // every Member reaching every team and every RSVP. They sit at
  // `teams.write` / `meetings.write` until the link exists.
  for (const capability of ["tasks.own", "launch.milestone"] as const) {
    only(capability, [plantOwner, plantAdmin, plantMember]);
  }
});

// ----------------------------------------------------------------------------
// AS-007 / AS-008 — the two read-only populations
// ----------------------------------------------------------------------------

test("an org Member reads everything and changes nothing (AS-007)", () => {
  assert.equal(holdsSeatFor(orgMember, "read"), true);

  for (const capability of EVERY_STATE_CHANGING_CAPABILITY) {
    assert.equal(
      holdsSeatFor(orgMember, capability),
      false,
      `an org Member must be refused ${capability}`
    );
  }
});

test("a coach is refused every write on the plant they are assigned to", () => {
  // A coach holds a `church_id` and NO seat — "in this plant, holding nothing".
  // Every write is therefore refused by the seat half alone, including the
  // own-duty verbs: a coach has no duties in a plant, only sight of it.
  assert.equal(holdsSeatFor(coach, "read"), true);

  for (const capability of EVERY_STATE_CHANGING_CAPABILITY) {
    assert.equal(
      holdsSeatFor(coach, capability),
      false,
      `a coach must be refused ${capability}`
    );
  }
});

test("a row naming two tenancies reaches nothing in either direction", () => {
  // The READS too, which is the half a `tenancy: "any"` capability would
  // otherwise wave through — and did, until this suite said so. A row carrying
  // `church_id` AND `sending_network_id` has a competing claim on both, and
  // handing it either one is the hierarchy walk multi-tenancy forbids.
  assert.equal(holdsSeatFor(twoTenancies, "read"), false);
  assert.equal(holdsSeatFor(twoTenancies, "self.write"), false);
  assert.equal(holdsSeatFor(twoTenancies, "church.claim"), false);

  for (const capability of EVERY_STATE_CHANGING_CAPABILITY) {
    assert.equal(
      holdsSeatFor(twoTenancies, capability),
      false,
      `the two-tenancy defect must be refused ${capability}`
    );
  }
});

/**
 * Every verb that changes state — the two seat sets plus the own-duty ones.
 *
 * Written out rather than derived from the table's keys so that adding a
 * capability is a decision made HERE too: a new verb that nobody adds to this
 * list is a verb whose answer for a coach and an org Member was never asked.
 */
const EVERY_STATE_CHANGING_CAPABILITY = [
  "sharing.toggle",
  "association.answer",
  "association.leave",
  "org.association.leave",
  "org.association.sever",
  "org.invitation.manage",
  "launch.schedule",
  "seat.manage",
  "org.settings",
  "church.create",
  "phase.declare",
  "church.profile",
  "people.write",
  "meetings.write",
  "tasks.write",
  "teams.write",
  "communication.send",
  "phase.signal",
  "tasks.own",
  "launch.milestone",
] as const satisfies readonly Capability[];

// ----------------------------------------------------------------------------
// The named endpoints, by the capability they are actually guarded with
// ----------------------------------------------------------------------------

test("the endpoints #498's review re-pointed refuse a plant Member", () => {
  // THE TWO HALVES, JOINED. `seat-guard.test.ts` pins which capability each
  // endpoint is guarded with; the matrix above pins who each capability admits.
  // Neither alone answers "may a Member assign a ministry-team member?" — the
  // first is a string and the second is a set — so this reads the real mapping
  // and asks the real predicate, endpoint by endpoint.
  //
  // These five are the ones the review moved. Each sat on a capability whose
  // floor was `SEATED` with no subject check above it (`teams.own`,
  // `meetings.rsvp`) or on `"read"` (`previewImportAction`, which parses an
  // uploaded file), so a Member reached all of them.
  for (const label of [
    "src/app/(dashboard)/teams/actions.ts → assignMemberAction",
    "src/app/(dashboard)/teams/actions.ts → removeMemberAction",
    "src/app/(dashboard)/teams/actions.ts → markTrainingCompleteAction",
    "src/app/(dashboard)/meetings/actions.ts → updateRsvpStatusAction",
    "src/app/(dashboard)/people/import-export-actions.ts → previewImportAction",
  ]) {
    const capability = CAPABILITY_BY_EXPORT[label];

    assert.ok(capability, `${label} is not in the checked-in mapping`);
    assert.equal(
      holdsSeatFor(plantMember, capability as Capability),
      false,
      `${label} is guarded with "${capability}", which a plant Member carries`
    );
    assert.equal(
      holdsSeatFor(plantAdmin, capability as Capability),
      true,
      `${label} is guarded with "${capability}", which a plant Admin does not carry — that is narrower than AS-004`
    );
  }
});

test("the endpoints a Member must still reach admit one", () => {
  // The other direction, so the fix above cannot have been "refuse everybody".
  // A Member reads the directory, completes the task they were given, and ticks
  // a launch milestone (LS-007).
  for (const label of [
    "src/app/(dashboard)/tasks/actions.ts → completeTaskAction",
    "src/app/(dashboard)/tasks/actions.ts → reopenTaskAction",
    "src/app/(dashboard)/launch/actions.ts → completeMilestoneAction",
    "src/app/(dashboard)/people/actions.ts → checkForDuplicatesAction",
  ]) {
    const capability = CAPABILITY_BY_EXPORT[label];

    assert.ok(capability, `${label} is not in the checked-in mapping`);
    assert.equal(
      holdsSeatFor(plantMember, capability as Capability),
      true,
      `${label} is guarded with "${capability}", which locks a Member out of their own duty (AS-006)`
    );
  }
});

test("the two sets are what the ruling says, and neither is empty", () => {
  assert.deepEqual([...OWNER_ONLY], ["owner"]);
  assert.deepEqual([...ADMIN_PLUS], ["owner", "admin"]);

  // `self.write` and `church.claim` are the two writes that are NOT in either
  // set, and both are deliberate: a self-scoped row reaches no other account,
  // and the OB-010 claim GRANTS a seat rather than spending one. Asserting the
  // membership here is what stops a later reader "fixing" them into a set.
  assert.equal(holdsSeatFor(coach, "self.write"), true);
  assert.equal(holdsSeatFor(orgMember, "self.write"), true);
  assert.equal(holdsSeatFor(plantMember, "church.claim"), true);
  assert.equal(holdsSeatFor(orgOwner, "church.claim"), false);
});
