import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { userSeats } from "@/db/schema";
import {
  organizationInvitationTypes,
  type OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import type { SeatFields } from "@/lib/auth/tenancy";

import {
  NOT_AUTHORIZED_MESSAGE,
  inviteeAccountTarget,
  verifyInvitationAuthority,
  type InvitationActor,
} from "./core";

// ============================================================================
// "NO INVITATION THAT CANNOT BE ANSWERED" — proved per TYPE (#304 WS3, ruled
// 2026-08-09).
//
// The rule (`memory/invariants.md` → Multi-Tenancy) is that every invitation
// TYPE which can name an EXISTING account has an in-app surface for the account
// that answers it. The 2026-08-04 version of that rule was satisfied trivially,
// by refusing every existing account; #304 repealed the refusal, which made the
// rule load-bearing — and #304's first build then declared it satisfied for
// every targetable account while having built only the plant Owner's half. That
// is the dead end HR4 found: a sending church's own account was targetable by
// `sending_church_to_network` with nowhere in the product to answer.
//
// Prose cannot hold this, and neither can three hand-written cases: the failure
// mode is a type or an ACCOUNT SHAPE somebody ADDS without noticing it needs a
// surface. So the test enumerates `organizationInvitationTypes` and
// `inviteeAccountTarget`'s whole domain of (seat, tenancy) pairs, and every
// claim below is checked for each member. A fourth type, or a third targetable
// shape, fails here until its answering view exists.
//
// Two halves per type, and they fail differently:
//
//   1. WHO MAY ANSWER — executed against `verifyInvitationAuthority`, the pure
//      rule a forged POST also meets. Includes the negative that matters most
//      for WS3: a member of the target sending church who does not hold its
//      Owner seat.
//   2. WHERE THEY ANSWER — source-shaped, because "a surface exists for this
//      account" is a fact about which files read which list, and no unit-level
//      behaviour reveals its absence.
// ============================================================================

const APP = path.join(process.cwd(), "src", "app", "(dashboard)");

const read = (...segments: string[]) =>
  readFileSync(path.join(APP, ...segments), "utf8");

const ASSOCIATION_PAGE = read("settings", "association", "page.tsx");
const SETTINGS_PAGE = read("settings", "page.tsx");
// The FINISHED dashboard. `/dashboard` split into `page.tsx` (session,
// `?step=`, the onboarding fork) and two halves on 2026-08-12 (PR #408); the
// OV-005 reminder is a plant surface, so it lives in the plant half.
const DASHBOARD_PAGE = read("dashboard", "plant-dashboard.tsx");

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const OTHER_SENDING_CHURCH = "55555555-5555-4555-8555-555555555555";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function actor(overrides: Partial<InvitationActor>): InvitationActor {
  return {
    id: USER,
    seat: "owner",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  } as InvitationActor;
}

/**
 * THE ACCOUNT SHAPES AN ORG CAN ADDRESS — the (seat, tenancy) pairs that
 * replaced the five role names, one per shape `inviteeAccountTarget` can be
 * asked about.
 *
 * All three tenancy FKs on every one, because the seat alone does not say
 * whose Owner this is: `owner` + `church_id` is a plant's Owner and `owner` +
 * `sending_church_id` is a sending church's, and a fixture that omitted an FK
 * would be asking about a row the resolver never sees. Each names exactly ONE
 * tenancy for the same reason — a row naming two resolves to no org at all.
 */
const ACCOUNTS = {
  "the plant's Owner": {
    seat: "owner",
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
  },
  "a plant Member": {
    seat: "member",
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
  },
  "a coach, who holds no seat": {
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
  },
  "the sending church's Owner": {
    seat: "owner",
    churchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
  },
  "the network's Owner": {
    seat: "owner",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: NETWORK,
  },
  // THE NON-OWNER SEATS, so the domain is not silently the Owner seat four
  // times over. `admin` and `member` in an org are exactly the rows no role
  // ever mapped to, which is why the org-side arms must refuse them.
  "a sending church ADMIN": {
    seat: "admin",
    churchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
  },
  "a sending church MEMBER": {
    seat: "member",
    churchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
  },
  "a plant ADMIN": {
    seat: "admin",
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
  },
  "an account naming NO tenancy but holding a seat": {
    seat: "owner",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
  },
} as const satisfies Record<string, SeatFields>;

type AccountShape = keyof typeof ACCOUNTS;

test("the account domain covers every seat the column can hold", () => {
  // THE DOMAIN IS CLOSED AGAINST THE SCHEMA, not against what somebody
  // remembered to type. `userSeats` is the column's own tuple, so a fourth seat
  // fails here until this table says what it may answer — which is the whole
  // point of a table that decides authority.
  const covered = new Set(Object.values(ACCOUNTS).map((row) => row.seat));

  for (const seat of userSeats) {
    assert.ok(
      covered.has(seat),
      `no fixture holds the "${seat}" seat — the authority grid below is not asking about it`
    );
  }
  assert.ok(covered.has(null), "a coach holds no seat, and that is a value");
});

function mayAnswer(
  type: OrganizationInvitationType,
  who: InvitationActor
): boolean {
  try {
    verifyInvitationAuthority(
      {
        type,
        targetChurchId: PLANT,
        targetSendingChurchId: SENDING_CHURCH,
      },
      who
    );
    return true;
  } catch (error) {
    assert.equal((error as Error).message, NOT_AUTHORIZED_MESSAGE);
    return false;
  }
}

/**
 * The contract, one entry per invitation type: who answers it, and the read the
 * surface that offers the answer performs.
 *
 * `answeredBy` names one of the {@link ACCOUNTS} shapes rather than a role, and
 * the two tables are tied below: every shape an org can TARGET must be some
 * type's answerer. The table is checked against `organizationInvitationTypes`
 * below, so it cannot fall behind the enum either.
 */
const ANSWER_CONTRACT: Record<
  OrganizationInvitationType,
  {
    answeredBy: AccountShape;
    /** The actor the rule must ACCEPT. */
    answerer: InvitationActor;
    /** Actors the rule must REFUSE, and why each one is worth naming. */
    refused: { label: string; who: InvitationActor }[];
    /** The read the answering surface performs, by name. */
    surfaceRead: string;
    /**
     * The predicate `/settings/association` admits this account with, as source
     * text. It is a (seat, tenancy) question now rather than a role literal —
     * `isPlantOwner(user)` reads the seat AND the plant FK, `oversightOrgOf`
     * resolves the org from the FKs alone — so the string is the CALL, not a
     * comparison against a name that no longer exists.
     */
    pageGate: string;
    /** The `/settings` gate that makes the surface reachable. */
    settingsGate: string;
    /**
     * The type-to-confirm LEAVE control this account gets on the same screen,
     * and the action behind it (#304, OV-007a / OV-013).
     *
     * Part of this contract rather than a test of its own, because it is the
     * same claim one step on: an account that can be ASSOCIATED by an
     * invitation must be able to END that association from the surface it
     * answered on. The plant Owner's two types share one control — a plant has
     * two associations and the dialog names which — so the entry repeats.
     */
    leave: { component: string; action: string };
  }
> = {
  church_to_sending_church: {
    answeredBy: "the plant's Owner",
    answerer: actor(ACCOUNTS["the plant's Owner"]),
    refused: [
      {
        label: "a Member of the plant",
        who: actor(ACCOUNTS["a plant Member"]),
      },
      {
        label: "a coach of the plant",
        who: actor({
          seat: null,
          churchId: PLANT,
          sendingChurchId: null,
          sendingNetworkId: null,
        }),
      },
      {
        label: "the Owner of another plant",
        who: actor({
          seat: "owner",
          churchId: NETWORK,
          sendingChurchId: null,
          sendingNetworkId: null,
        }),
      },
      {
        label: "the inviting sending church's own Owner",
        who: actor(ACCOUNTS["the sending church's Owner"]),
      },
    ],
    surfaceRead: "getPendingInvitationsForPlant",
    pageGate: "isPlantOwner(user) && user.churchId",
    settingsGate: "isPlanterWithPlant",
    leave: { component: "LeaveOrgDialog", action: "leaveOversightOrg" },
  },
  church_to_network: {
    answeredBy: "the plant's Owner",
    answerer: actor(ACCOUNTS["the plant's Owner"]),
    refused: [
      {
        label: "a Member of the plant",
        who: actor(ACCOUNTS["a plant Member"]),
      },
      {
        label: "a coach of the plant",
        who: actor({
          seat: null,
          churchId: PLANT,
          sendingChurchId: null,
          sendingNetworkId: null,
        }),
      },
      {
        label: "the inviting network's own Owner",
        who: actor(ACCOUNTS["the network's Owner"]),
      },
    ],
    surfaceRead: "getPendingInvitationsForPlant",
    pageGate: "isPlantOwner(user) && user.churchId",
    settingsGate: "isPlanterWithPlant",
    leave: { component: "LeaveOrgDialog", action: "leaveOversightOrg" },
  },
  sending_church_to_network: {
    answeredBy: "the sending church's Owner",
    answerer: actor(ACCOUNTS["the sending church's Owner"]),
    refused: [
      // THE WS3 NEGATIVE, in the seat model's terms. `sending_church_admin`
      // meant the OWNER SEAT in this sending church, so `core.ts`'s
      // `sending_church_to_network` arm asks `isOrgOwner` AND the org id — both
      // halves, because the role named both. Two kinds of row are refused here:
      // one that names the target sending church alongside another tenancy (the
      // tie the role used to break, which now resolves to NO org), and one that
      // names it with the wrong seat (which no role ever mapped to).
      {
        label: "an account naming a plant AND the target sending church",
        who: actor({
          seat: "owner",
          churchId: PLANT,
          sendingChurchId: SENDING_CHURCH,
          sendingNetworkId: null,
        }),
      },
      {
        label: "an account naming the target sending church AND a network",
        who: actor({
          seat: "owner",
          churchId: null,
          sendingChurchId: SENDING_CHURCH,
          sendingNetworkId: NETWORK,
        }),
      },
      {
        label: "the Owner of a DIFFERENT sending church",
        who: actor({
          seat: "owner",
          churchId: null,
          sendingChurchId: OTHER_SENDING_CHURCH,
          sendingNetworkId: null,
        }),
      },
      {
        label: "an Owner whose sending church is not set",
        who: actor({
          seat: "owner",
          churchId: null,
          sendingChurchId: null,
          sendingNetworkId: null,
        }),
      },
      // The seat half, restored: both of these NAME the target sending church
      // and are refused on the seat alone. No role mapped to either.
      {
        label: "a MEMBER of the target sending church",
        who: actor(ACCOUNTS["a sending church MEMBER"]),
      },
      {
        label: "an ADMIN of the target sending church",
        who: actor(ACCOUNTS["a sending church ADMIN"]),
      },
      {
        label: "the inviting network's own Owner",
        who: actor(ACCOUNTS["the network's Owner"]),
      },
    ],
    surfaceRead: "getPendingInvitationsForSendingChurch",
    pageGate: 'org?.type === "sending_church"',
    settingsGate: "isSendingChurchAdminWithOrg",
    leave: { component: "LeaveNetworkDialog", action: "leaveNetwork" },
  },
};

// ----------------------------------------------------------------------------
// 0. The table cannot fall behind the enum
// ----------------------------------------------------------------------------

test("every invitation type the schema declares has an entry here", () => {
  assert.deepEqual(
    Object.keys(ANSWER_CONTRACT).sort(),
    [...organizationInvitationTypes].sort()
  );
});

test("every account shape that can be targeted is an answerer", () => {
  // `inviteeAccountTarget` is the whole of "which existing accounts can be
  // named". Walking the entire (seat, tenancy) domain is what makes this a
  // property rather than two remembered cases: making a third shape targetable
  // — say a plant Member, or a network's Owner — fails here until it appears as
  // the answerer of some type.
  const answerers = new Set<AccountShape>(
    Object.values(ANSWER_CONTRACT).map((entry) => entry.answeredBy)
  );

  for (const [who, account] of Object.entries(ACCOUNTS) as [
    AccountShape,
    SeatFields,
  ][]) {
    const targetable = inviteeAccountTarget(account);

    const namesAnOrg =
      targetable.ok &&
      (targetable.target.targetChurchId != null ||
        targetable.target.targetSendingChurchId != null);

    assert.equal(
      namesAnOrg,
      answerers.has(who),
      `${who}: targetable=${namesAnOrg}, has an answering surface=${answerers.has(who)}`
    );
  }
});

// ----------------------------------------------------------------------------
// 1. WHO may answer — executed, per type
// ----------------------------------------------------------------------------

for (const [type, contract] of Object.entries(ANSWER_CONTRACT) as [
  OrganizationInvitationType,
  (typeof ANSWER_CONTRACT)[OrganizationInvitationType],
][]) {
  test(`${type}: exactly one account may answer it, server-side`, () => {
    assert.equal(
      mayAnswer(type, contract.answerer),
      true,
      `${contract.answeredBy} must be able to answer ${type}`
    );

    for (const { label, who } of contract.refused) {
      assert.equal(mayAnswer(type, who), false, `${label} answered ${type}`);
    }
  });
}

// ----------------------------------------------------------------------------
// 2. WHERE they answer — the surface exists, and `/settings` reaches it
// ----------------------------------------------------------------------------

for (const [type, contract] of Object.entries(ANSWER_CONTRACT) as [
  OrganizationInvitationType,
  (typeof ANSWER_CONTRACT)[OrganizationInvitationType],
][]) {
  test(`${type}: the account that answers it has an in-app surface`, () => {
    // The association area reads a pending list for this account…
    assert.ok(
      ASSOCIATION_PAGE.includes(contract.surfaceRead),
      `/settings/association performs no ${contract.surfaceRead}`
    );

    // …the page admits it, on the (seat, tenancy) pair rather than on a role
    // name…
    assert.ok(
      ASSOCIATION_PAGE.includes(contract.pageGate),
      `/settings/association does not admit ${contract.answeredBy} (${contract.pageGate})`
    );

    // …and `/settings` links the screen for it. A surface nobody can navigate
    // to is the visible half of the dead end this whole test exists for.
    assert.ok(
      SETTINGS_PAGE.includes(contract.settingsGate),
      `/settings has no ${contract.settingsGate} gate`
    );
    assert.ok(
      SETTINGS_PAGE.includes("canManageAssociation"),
      "the association link is gated on the union of the answering accounts"
    );
  });
}

test("both answering views hand the same two actions an invitation id", () => {
  // ONE pair of endpoints for both views, so the two surfaces cannot disagree
  // about who may answer what: authority is decided per invitation TYPE inside
  // `verifyInvitationAuthority`, which is the rule tested above. A second pair
  // per answering account would be a second place to get it wrong.
  const answer = readFileSync(
    path.join(APP, "settings", "association", "invitation-answer.tsx"),
    "utf8"
  );

  assert.match(answer, /acceptAssociationInvitation/);
  assert.match(answer, /declineAssociationInvitation/);
  assert.match(answer, /action\(invitationId\)/);

  // The shared answer component is what both views render.
  const uses = ASSOCIATION_PAGE.match(/<InvitationAnswer/g) ?? [];
  assert.equal(uses.length, 1, "one answer component, rendered from one place");
});

test("the dashboard reminder stays the plant Owner's, and says so", () => {
  // A sending church's account has no dashboard of this kind — the reminder is
  // a plant surface (OV-005) and its read takes a church id. WS3 deliberately
  // did not widen it; the settings view is the sending church's whole surface,
  // and this pins that the gate was not loosened by accident.
  assert.match(
    DASHBOARD_PAGE,
    /isPlantOwner\(viewer\)\s*\?\s*getPendingInvitationsForPlant\(churchId\)/
  );
  assert.ok(!DASHBOARD_PAGE.includes("getPendingInvitationsForSendingChurch"));
});

// ----------------------------------------------------------------------------
// 3. …and they can LEAVE from the same surface (#304, OV-007a / OV-013)
// ----------------------------------------------------------------------------

const ASSOCIATION_ACTIONS = read("settings", "association", "actions.ts");

for (const [type, contract] of Object.entries(ANSWER_CONTRACT) as [
  OrganizationInvitationType,
  (typeof ANSWER_CONTRACT)[OrganizationInvitationType],
][]) {
  test(`${type}: the account that answers it can also leave, behind a type-to-confirm`, () => {
    // The answering surface renders the control…
    assert.ok(
      ASSOCIATION_PAGE.includes(`<${contract.leave.component}`),
      `/settings/association renders no ${contract.leave.component}`
    );

    // …the control types the org's name before it will submit. This is a
    // deliberateness control and never an authorization one, which is why the
    // NEXT assertion matters more than this one.
    const dialog = readFileSync(
      path.join(
        APP,
        "settings",
        "association",
        `${contract.leave.component === "LeaveNetworkDialog" ? "leave-network-dialog" : "leave-org-dialog"}.tsx`
      ),
      "utf8"
    );
    assert.match(dialog, /toLowerCase\(\) ===/, "no type-to-confirm match");
    assert.match(dialog, /disabled=\{!confirmed \|\| pending\}/);
    // Every clickable carries `cursor-pointer` (repo rule), including the
    // trigger, the cancel and the destructive confirm.
    assert.equal(
      (dialog.match(/cursor-pointer/g) ?? []).length,
      3,
      "trigger, cancel and confirm each need cursor-pointer"
    );

    // …and the action behind it exists, takes no entity id, and is the one the
    // logic layer guards. A LEAVE that took an org id would be aimable at
    // somebody else's association; both of these derive it from the session.
    assert.ok(
      ASSOCIATION_ACTIONS.includes(
        `export async function ${contract.leave.action}(`
      ),
      `no ${contract.leave.action} action`
    );
    assert.ok(
      dialog.includes(`${contract.leave.action}(`),
      `${contract.leave.component} does not call ${contract.leave.action}`
    );
  });
}

test("neither leave action accepts an id — the entity is the session's", () => {
  // The `memory/invariants.md` → Authentication rule, asserted on the two
  // signatures rather than trusted: an entity implied by the actor is never an
  // argument. The planter's takes a two-valued KIND (a plant genuinely has two
  // associations to choose between); the sending church's takes NOTHING, because
  // a sending church has exactly one.
  assert.match(
    ASSOCIATION_ACTIONS,
    /export async function leaveOversightOrg\(\s*orgType: string\s*\)/
  );
  assert.match(
    ASSOCIATION_ACTIONS,
    /export async function leaveNetwork\(\): Promise<AssociationActionResult>/
  );
  // No uuid parameter anywhere in the module's leave surface.
  assert.doesNotMatch(ASSOCIATION_ACTIONS, /leaveNetwork\([^)]+\)/);
});
