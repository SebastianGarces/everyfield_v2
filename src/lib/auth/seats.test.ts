import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatFields } from "./tenancy";
import { ADMIN_PLUS, OWNER_ONLY, holdsSeatFor, type Capability } from "./seats";

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
  // Their meeting RSVP, their own task, their own team. The seat half is what
  // this asserts; the SUBJECT half — that the task is theirs, that they lead
  // that team — is asked in the export's body after the parse, and for two of
  // the three it cannot be asked yet (see the residual in
  // `memory/invariants/seats-and-tenancy.md`).
  for (const capability of [
    "tasks.own",
    "teams.own",
    "meetings.rsvp",
    "launch.milestone",
  ] as const) {
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
  "teams.own",
  "meetings.rsvp",
  "launch.milestone",
] as const satisfies readonly Capability[];

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
