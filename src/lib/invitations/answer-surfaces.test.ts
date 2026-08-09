import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  organizationInvitationTypes,
  type OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import type { UserRole } from "@/db/schema";

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
// TYPE which can name an EXISTING account has an in-app surface for the role
// that answers it. The 2026-08-04 version of that rule was satisfied trivially,
// by refusing every existing account; #304 repealed the refusal, which made the
// rule load-bearing — and #304's first build then declared it satisfied for all
// roles while having built only the planter's half. That is the dead end HR4
// found: a `sending_church_admin` was targetable by `sending_church_to_network`
// with nowhere in the product to answer.
//
// Prose cannot hold this, and neither can three hand-written cases: the failure
// mode is a type or a role somebody ADDS without noticing it needs a surface.
// So the test enumerates `organizationInvitationTypes` and
// `inviteeAccountTarget`'s whole role domain, and every claim below is checked
// for each member. A fourth type, or a third targetable role, fails here until
// its answering view exists.
//
// Two halves per type, and they fail differently:
//
//   1. WHO MAY ANSWER — executed against `verifyInvitationAuthority`, the pure
//      rule a forged POST also meets. Includes the negative that matters most
//      for WS3: a non-admin member of the target sending church.
//   2. WHERE THEY ANSWER — source-shaped, because "a surface exists for this
//      role" is a fact about which files read which list, and no unit-level
//      behaviour reveals its absence.
// ============================================================================

const APP = path.join(process.cwd(), "src", "app", "(dashboard)");

const read = (...segments: string[]) =>
  readFileSync(path.join(APP, ...segments), "utf8");

const ASSOCIATION_PAGE = read("settings", "association", "page.tsx");
const SETTINGS_PAGE = read("settings", "page.tsx");
const DASHBOARD_PAGE = read("dashboard", "page.tsx");

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const OTHER_SENDING_CHURCH = "55555555-5555-4555-8555-555555555555";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function actor(overrides: Partial<InvitationActor>): InvitationActor {
  return {
    id: USER,
    role: "planter",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  } as InvitationActor;
}

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
 * `answeredBy: null` marks a type no existing account can be targeted with —
 * there would be nobody to build a surface for. The table is checked against
 * `organizationInvitationTypes` below, so it cannot fall behind the enum.
 */
const ANSWER_CONTRACT: Record<
  OrganizationInvitationType,
  {
    answeredBy: UserRole;
    /** The actor the rule must ACCEPT. */
    answerer: InvitationActor;
    /** Actors the rule must REFUSE, and why each one is worth naming. */
    refused: { label: string; who: InvitationActor }[];
    /** The read the answering surface performs, by name. */
    surfaceRead: string;
    /** The `/settings` gate that makes the surface reachable. */
    settingsGate: string;
    /**
     * The type-to-confirm LEAVE control this role gets on the same screen, and
     * the action behind it (#304, OV-007a / OV-013).
     *
     * Part of this contract rather than a test of its own, because it is the
     * same claim one step on: a role that can be ASSOCIATED by an invitation
     * must be able to END that association from the surface it answered on.
     * The planter's two types share one control — a plant has two associations
     * and the dialog names which — so the entry repeats.
     */
    leave: { component: string; action: string };
  }
> = {
  church_to_sending_church: {
    answeredBy: "planter",
    answerer: actor({ role: "planter", churchId: PLANT }),
    refused: [
      {
        label: "a team member of the plant",
        who: actor({ role: "team_member", churchId: PLANT }),
      },
      {
        label: "a coach of the plant",
        who: actor({ role: "coach", churchId: PLANT }),
      },
      {
        label: "the planter of another plant",
        who: actor({ role: "planter", churchId: NETWORK }),
      },
      {
        label: "the inviting sending church's own admin",
        who: actor({
          role: "sending_church_admin",
          sendingChurchId: SENDING_CHURCH,
        }),
      },
    ],
    surfaceRead: "getPendingInvitationsForPlant",
    settingsGate: "isPlanterWithPlant",
    leave: { component: "LeaveOrgDialog", action: "leaveOversightOrg" },
  },
  church_to_network: {
    answeredBy: "planter",
    answerer: actor({ role: "planter", churchId: PLANT }),
    refused: [
      {
        label: "a team member of the plant",
        who: actor({ role: "team_member", churchId: PLANT }),
      },
      {
        label: "a coach of the plant",
        who: actor({ role: "coach", churchId: PLANT }),
      },
      {
        label: "the inviting network's own admin",
        who: actor({ role: "network_admin", sendingNetworkId: NETWORK }),
      },
    ],
    surfaceRead: "getPendingInvitationsForPlant",
    settingsGate: "isPlanterWithPlant",
    leave: { component: "LeaveOrgDialog", action: "leaveOversightOrg" },
  },
  sending_church_to_network: {
    answeredBy: "sending_church_admin",
    answerer: actor({
      role: "sending_church_admin",
      sendingChurchId: SENDING_CHURCH,
    }),
    refused: [
      // THE WS3 NEGATIVE. A member of the target sending church who is not its
      // admin is refused server-side, not merely kept off the screen — the
      // acceptance contract at `core.ts`'s `sending_church_to_network` arm.
      {
        label: "a team member sitting under the target sending church",
        who: actor({ role: "team_member", sendingChurchId: SENDING_CHURCH }),
      },
      {
        label: "a coach sitting under the target sending church",
        who: actor({ role: "coach", sendingChurchId: SENDING_CHURCH }),
      },
      {
        label: "an admin of a DIFFERENT sending church",
        who: actor({
          role: "sending_church_admin",
          sendingChurchId: OTHER_SENDING_CHURCH,
        }),
      },
      {
        label: "an admin whose sending church is not set",
        who: actor({ role: "sending_church_admin" }),
      },
      {
        label: "the inviting network's own admin",
        who: actor({ role: "network_admin", sendingNetworkId: NETWORK }),
      },
      {
        label: "a planter of a plant under that sending church",
        who: actor({
          role: "planter",
          churchId: PLANT,
          sendingChurchId: SENDING_CHURCH,
        }),
      },
    ],
    surfaceRead: "getPendingInvitationsForSendingChurch",
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

test("every role an existing account can be targeted through is an answerer", () => {
  // `inviteeAccountTarget` is the whole of "which existing accounts can be
  // named". Walking the entire role domain is what makes this a property rather
  // than two remembered cases: adding a third role to that mapping — say a
  // coach whose plant becomes targetable — fails here until it appears as the
  // answerer of some type.
  const roles: UserRole[] = [
    "planter",
    "coach",
    "team_member",
    "sending_church_admin",
    "network_admin",
  ];

  const answerers = new Set(
    Object.values(ANSWER_CONTRACT).map((entry) => entry.answeredBy)
  );

  for (const role of roles) {
    const targetable = inviteeAccountTarget({
      role,
      churchId: PLANT,
      sendingChurchId: SENDING_CHURCH,
    });

    const namesAnOrg =
      targetable.ok &&
      (targetable.target.targetChurchId != null ||
        targetable.target.targetSendingChurchId != null);

    assert.equal(
      namesAnOrg,
      answerers.has(role),
      `${role}: targetable=${namesAnOrg}, has an answering surface=${answerers.has(role)}`
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
  test(`${type}: exactly one role may answer it, server-side`, () => {
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
  test(`${type}: the role that answers it has an in-app surface`, () => {
    // The association area reads a pending list for this role…
    assert.ok(
      ASSOCIATION_PAGE.includes(contract.surfaceRead),
      `/settings/association performs no ${contract.surfaceRead}`
    );

    // …the page admits that role…
    assert.ok(
      ASSOCIATION_PAGE.includes(`user.role === "${contract.answeredBy}"`),
      `/settings/association does not admit a ${contract.answeredBy}`
    );

    // …and `/settings` links the screen for it. A surface nobody can navigate
    // to is the visible half of the dead end this whole test exists for.
    assert.ok(
      SETTINGS_PAGE.includes(contract.settingsGate),
      `/settings has no ${contract.settingsGate} gate`
    );
    assert.ok(
      SETTINGS_PAGE.includes("canManageAssociation"),
      "the association link is gated on the union of the answering roles"
    );
  });
}

test("both answering views hand the same two actions an invitation id", () => {
  // ONE pair of endpoints for both roles, so the two surfaces cannot disagree
  // about who may answer what: authority is decided per invitation TYPE inside
  // `verifyInvitationAuthority`, which is the rule tested above. A second,
  // role-specific pair would be a second place to get it wrong.
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

test("the dashboard reminder stays the planter's, and says so", () => {
  // A sending-church admin has no dashboard of this kind — the reminder is a
  // plant surface (OV-005) and its read takes a church id. WS3 deliberately did
  // not widen it; the settings view is the sending church's whole surface, and
  // this pins that the gate was not loosened by accident.
  assert.match(
    DASHBOARD_PAGE,
    /role === "planter"\s*\?\s*getPendingInvitationsForPlant\(churchId\)/
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
  test(`${type}: the role that answers it can also leave, behind a type-to-confirm`, () => {
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
