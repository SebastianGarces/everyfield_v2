import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { db } from "@/db";
import { churches } from "@/db/schema";

import {
  NO_ORG_TO_REMOVE_FROM_MESSAGE,
  ORG_ADMIN_ONLY_SEVER_MESSAGE,
  PLANT_NOT_IN_ORG_MESSAGE,
  oversightOrgOfUser,
  plantHeldByOrg,
  removePlantFromOrgAs,
  type InvitationActor,
} from "./core";
import { associationHistoryQuery } from "./history";

// ============================================================================
// #304 / OV-007b + OV-011 — the ORG'S sever, and the audit read behind it.
//
// The mirror of `association.test.ts`, which covers the planter's side. Four
// things are worth a test here and they fail in four different ways:
//
//   1. THE AUTHORITY RULE. An admin of the org, and nobody else — refused in the
//      logic layer so a forged call meets it. Executed: a planter, a team member
//      and a coach are real actors here, refused BEFORE any read, so these tests
//      need no database.
//   2. WHICH ORG A ROLE SPEAKS FOR. `oversightOrgOfUser` is what makes the org
//      and its KIND session-derived rather than arguments; inverting its two arms
//      would let each admin aim at the OTHER of a plant's two independent
//      associations, and nothing on the page would look different.
//   3. THE TENANCY ASSERTION, read off generated SQL. The scoped read and the
//      history read both have to name the caller's own org, and the sever's own
//      WHERE is `association.test.ts`'s.
//   4. THE ARGUMENT SHAPE of the action: one church id, and nothing else — no
//      org id, no org kind, no actor.
//
// The concurrency half (a removal racing an accept, or the plant's own leave) is
// the G3 harness's, on a real database.
// ============================================================================

const CORE_CODE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "core.ts"),
  "utf8"
);
const ACTIONS_CODE = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "(dashboard)",
    "oversight",
    "plants",
    "[id]",
    "actions.ts"
  ),
  "utf8"
);

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function actor(overrides: Partial<InvitationActor> = {}): InvitationActor {
  return {
    id: USER,
    role: "sending_church_admin",
    churchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
    ...overrides,
  } as InvitationActor;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    assert.fail("expected the removal to be refused");
  } catch (error) {
    return (error as Error).message;
  }
}

// ----------------------------------------------------------------------------
// 1. Authority — an admin of the org, server-side
// ----------------------------------------------------------------------------

test("no church-level role can remove a plant from an organization", async () => {
  // The mirror of OV-010's planter-only rule: the org side is the ORG's
  // decision. A planter cannot reach into the org's directory and remove
  // themselves through this path — they have their own, `leaveOversightOrgAs`,
  // which audits and notifies the other way round.
  //
  // The refusal is the FIRST statement, so none of these calls reads a row.
  for (const role of ["planter", "team_member", "coach"] as const) {
    assert.equal(
      await refusal(
        removePlantFromOrgAs(actor({ role, churchId: PLANT }), PLANT)
      ),
      ORG_ADMIN_ONLY_SEVER_MESSAGE,
      role
    );
  }
});

test("an oversight admin with no organization has nothing to remove a plant from", async () => {
  assert.equal(
    await refusal(
      removePlantFromOrgAs(actor({ sendingChurchId: null }), PLANT)
    ),
    NO_ORG_TO_REMOVE_FROM_MESSAGE
  );

  assert.equal(
    await refusal(
      removePlantFromOrgAs(
        actor({
          role: "network_admin",
          sendingChurchId: null,
          sendingNetworkId: null,
        }),
        PLANT
      )
    ),
    NO_ORG_TO_REMOVE_FROM_MESSAGE
  );
});

test("a church id that is not a uuid is refused before anything is read", async () => {
  // And it is refused with the SAME message a plant in another org gets — see
  // `PLANT_NOT_IN_ORG_MESSAGE`. A distinguishable refusal would answer questions
  // about another org's portfolio, one guessed id at a time.
  for (const value of ["", "not-a-uuid", `${PLANT} `, "'; drop table"]) {
    assert.equal(
      await refusal(removePlantFromOrgAs(actor(), value)),
      PLANT_NOT_IN_ORG_MESSAGE,
      JSON.stringify(value)
    );
  }
});

test("the three refusals an admin can read say different things", () => {
  const messages = [
    ORG_ADMIN_ONLY_SEVER_MESSAGE,
    NO_ORG_TO_REMOVE_FROM_MESSAGE,
    PLANT_NOT_IN_ORG_MESSAGE,
  ];
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) {
    assert.ok(message.length > 20, message);
    assert.doesNotMatch(message, /error|failed|invalid/i);
  }
});

// ----------------------------------------------------------------------------
// 2. Which org a role speaks for — derived from the session, never an argument
// ----------------------------------------------------------------------------

test("a role maps to exactly one of the plant's two independent associations", () => {
  // The two oversight FKs are independent (`memory/invariants.md` →
  // Multi-Tenancy), so this mapping is the whole of "which association is this
  // admin allowed to end". Both ids are set on every actor below, so an arm that
  // read the wrong one would still return something — which is exactly how this
  // inverts silently.
  const both = {
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  };

  assert.deepEqual(
    oversightOrgOfUser({ role: "sending_church_admin", ...both }),
    { orgType: "sending_church", orgId: SENDING_CHURCH }
  );
  assert.deepEqual(oversightOrgOfUser({ role: "network_admin", ...both }), {
    orgType: "network",
    orgId: NETWORK,
  });

  // No church-level role speaks for an org, however its FK columns are filled.
  for (const role of ["planter", "team_member", "coach"] as const) {
    assert.equal(oversightOrgOfUser({ role, ...both }), null, role);
  }

  // An admin whose OWN org is missing names none — never "whichever id is set".
  assert.equal(
    oversightOrgOfUser({
      role: "sending_church_admin",
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    }),
    null
  );
  assert.equal(
    oversightOrgOfUser({
      role: "network_admin",
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    }),
    null
  );
});

// ----------------------------------------------------------------------------
// 3. The scoping, read off the generated SQL
// ----------------------------------------------------------------------------

function whereOf(sql: { sql: string; params: unknown[] }) {
  return { text: sql.sql, params: sql.params };
}

test("`ours` is a predicate on the FK the org's KIND names", () => {
  const asSendingChurch = whereOf(
    db
      .select({ id: churches.id })
      .from(churches)
      .where(
        plantHeldByOrg({ orgType: "sending_church", orgId: SENDING_CHURCH })
      )
      .toSQL()
  );

  assert.match(asSendingChurch.text, /"sending_church_id" = \$1/);
  assert.doesNotMatch(asSendingChurch.text, /sending_network_id/);
  assert.deepEqual(asSendingChurch.params, [SENDING_CHURCH]);

  const asNetwork = whereOf(
    db
      .select({ id: churches.id })
      .from(churches)
      .where(plantHeldByOrg({ orgType: "network", orgId: NETWORK }))
      .toSQL()
  );

  assert.match(asNetwork.text, /"sending_network_id" = \$1/);
  assert.doesNotMatch(asNetwork.text, /sending_church_id/);
  assert.deepEqual(asNetwork.params, [NETWORK]);
});

test("the history read is scoped to the plant AND the caller's own org", () => {
  // OV-011 with `memory/invariants.md` → Hierarchical Access Control: reaching a
  // plant is not permission to name the orgs behind it. Dropping the org half of
  // this WHERE is a two-character edit that would show a network admin the
  // history of the plant's dealings with a sending church in another network,
  // and nothing on the page would look wrong.
  const { sql, params } = associationHistoryQuery(
    { orgType: "network", orgId: NETWORK },
    PLANT
  ).toSQL();

  assert.match(sql, /"church_id" = \$1/);
  assert.match(sql, /"org_type" = \$2/);
  assert.match(sql, /"org_id" = \$3/);
  assert.deepEqual(params, [PLANT, "network", NETWORK]);

  // Newest first, and the actor's name is the ONLY column taken off `users` —
  // answering "who" must not pull `password_hash` into application memory.
  assert.match(sql, /order by .*"created_at" desc/i);
  assert.match(sql, /left join "users"/);
  assert.doesNotMatch(sql, /password/i);
});

// ----------------------------------------------------------------------------
// 4. The shapes an edit would have to break deliberately
// ----------------------------------------------------------------------------

test("the removal takes a church id and derives everything else from the session", () => {
  const remove = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("export async function removePlantFromOrg(")
  );

  assert.match(remove, /removePlantFromOrg\(\s*churchId: string\s*\)/);
  assert.match(remove, /churchIdSchema\.safeParse\(churchId\)/);
  assert.match(
    remove,
    /const actor = invitationActorFromSession\(await verifySession\(\)\);/
  );

  // The org, its kind and the actor are NOT parameters — that is the rule from
  // `memory/invariants.md` → Authentication, and it is what makes "an admin of a
  // different org cannot sever this org's association" true by construction
  // rather than by a check somebody has to remember.
  assert.doesNotMatch(remove, /orgId/);
  assert.doesNotMatch(remove, /orgType/);
  assert.doesNotMatch(ACTIONS_CODE, /actor: InvitationActor/);

  // Exactly one export: every export of a `"use server"` module is a POSTable
  // endpoint. (`service.test.ts` walks the whole module graph; this pins the
  // module's own surface where it is written.)
  const exports = ACTIONS_CODE.match(/^export (async function|type|const) /gm);
  assert.deepEqual(exports, ["export type ", "export async function "]);
});

test("the plant's own read is scoped by the same predicate the write is", () => {
  const remove = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function removePlantFromOrgAs"),
    CORE_CODE.indexOf("async function announcePlantRemovedFor")
  );

  // A read is never the guard, but a read scoped MORE LOOSELY than the write is
  // a leak on its own: this one returns the plant's name, and an unscoped
  // lookup would hand another org's plant name to whoever guessed its id.
  assert.match(
    remove,
    /and\(eq\(churches\.id, churchId\), plantHeldByOrg\(org\)\)/
  );

  // The write, its refusal and the announcement, in that order. Announcing first
  // would tell a planter they had been removed while they still had not been.
  assert.ok(
    remove.indexOf("severAssociationWithAuditStatement") <
      remove.indexOf("announcePlantRemovedFor"),
    "the planter must not be told before the sever commits"
  );
  assert.match(remove, /if \(!severed\)/);
  assert.ok(
    remove.indexOf("if (!severed)") < remove.indexOf("announcePlantRemovedFor"),
    "a refused removal announces nothing"
  );

  // The org is passed to the sever from the session-derived value, never
  // re-read off the plant — which is how the OTHER of a plant's two
  // associations would get severed.
  assert.match(remove, /orgType: org\.orgType/);
  assert.match(remove, /orgId: org\.orgId/);
});
