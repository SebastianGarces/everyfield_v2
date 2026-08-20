import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { db } from "@/db";
import { churches } from "@/db/schema";
import type { TenancyFields } from "@/lib/auth/tenancy";

import {
  ORG_ADMIN_ONLY_SEVER_MESSAGE,
  PLANT_NOT_IN_ORG_MESSAGE,
  oversightOrgOfUser,
  plantHeldByOrg,
  removePlantFromOrgAs,
  type InvitationActor,
} from "./core";
import { associationHistoryQuery } from "./history";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

// ============================================================================
// #304 / OV-007b + OV-011 — the ORG'S sever, and the audit read behind it.
//
// The mirror of `association.test.ts`, which covers the planter's side. Four
// things are worth a test here and they fail in four different ways:
//
//   1. THE AUTHORITY RULE. An account whose own tenancy IS the org, and nobody
//      else — refused in the logic layer so a forged call meets it. Executed:
//      a plant's Owner, a plant Member and a coach are real actors here,
//      refused BEFORE any read, so these tests need no database.
//   2. WHICH ORG A TENANCY SPEAKS FOR. `oversightOrgOfUser` is what makes the
//      org and its KIND session-derived rather than arguments; inverting its two
//      arms would let each admin aim at the OTHER of a plant's two independent
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

/**
 * The readers, and the ONLY way this file cuts a declaration out of a module.
 * `span` / `after` throw naming the missing needle (`@/lib/testing/source-span`); a bare
 * `indexOf` returns -1 and turns an assertion about one function into one about
 * the whole file, silently.
 */
const CORE = sourceReader(CORE_CODE, "core.ts");
const ACTIONS = sourceReader(ACTIONS_CODE, "oversight/plants/[id]/actions.ts");

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function actor(overrides: Partial<InvitationActor> = {}): InvitationActor {
  return {
    id: USER,
    seat: "owner",
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

test("no church-level account can remove a plant from an organization", async () => {
  // The mirror of OV-010's Owner-only rule: the org side is the ORG's decision.
  // A plant's Owner cannot reach into the org's directory and remove themselves
  // through this path — they have their own, `leaveOversightOrgAs`, which
  // audits and notifies the other way round.
  //
  // The refusal is the FIRST statement, so none of these calls reads a row. The
  // last row is the one the role used to settle: a plant tenancy alongside an
  // oversight FK names NO org now, so it is refused rather than admitted on
  // whichever id happens to be set.
  const churchLevel: [string, Partial<InvitationActor>][] = [
    ["the plant's Owner", { seat: "owner", churchId: PLANT }],
    ["a plant Member", { seat: "member", churchId: PLANT }],
    ["a coach, who names no tenancy at all", { seat: null }],
    [
      "an account naming a plant AND a sending church",
      { seat: "owner", churchId: PLANT, sendingChurchId: SENDING_CHURCH },
    ],
    // THE SEAT HALF, restored. `sending_church_admin` meant the Owner seat in
    // a sending church, so no role ever mapped to either of these rows and the
    // allowlist this replaced refused them. They are here because a migration
    // that admitted them would be a widening wearing a rename's clothes.
    [
      "a MEMBER of the sending church",
      { seat: "member", sendingChurchId: SENDING_CHURCH },
    ],
    [
      "an ADMIN of the sending church",
      { seat: "admin", sendingChurchId: SENDING_CHURCH },
    ],
    [
      "a seatless account carrying the org FK",
      { seat: null, sendingChurchId: SENDING_CHURCH },
    ],
  ];

  for (const [who, fields] of churchLevel) {
    assert.equal(
      await refusal(
        removePlantFromOrgAs(
          actor({ sendingChurchId: null, sendingNetworkId: null, ...fields }),
          PLANT
        )
      ),
      ORG_ADMIN_ONLY_SEVER_MESSAGE,
      who
    );
  }
});

test("an account with no organization has nothing to remove a plant from", async () => {
  // ONE refusal, because there is now one guard. Under the role model these
  // were independent — a `sending_church_admin` with a null FK passed "is this
  // an oversight role" and failed "which org" — and both now come from the
  // same `isOrgOwner`/`oversightOrgOf` resolution, so the second was
  // unreachable and has been deleted along with its message.
  assert.equal(
    await refusal(
      removePlantFromOrgAs(actor({ sendingChurchId: null }), PLANT)
    ),
    ORG_ADMIN_ONLY_SEVER_MESSAGE
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

test("the two refusals an admin can read say different things", () => {
  const messages = [ORG_ADMIN_ONLY_SEVER_MESSAGE, PLANT_NOT_IN_ORG_MESSAGE];
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) {
    assert.ok(message.length > 20, message);
    assert.doesNotMatch(message, /error|failed|invalid/i);
  }
});

// ----------------------------------------------------------------------------
// 2. Which org a tenancy speaks for — derived from the session, never an argument
// ----------------------------------------------------------------------------

/** A tenancy with all three FKs named, which is what `TenancyFields` requires. */
function tenancy(fields: Partial<TenancyFields> = {}): TenancyFields {
  return {
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...fields,
  };
}

test("a tenancy maps to exactly one of the plant's two independent associations", () => {
  // The two oversight FKs are independent (`memory/invariants.md` →
  // Multi-Tenancy), so this mapping is the whole of "which association is this
  // account allowed to end". The KIND is asserted beside the id, so an arm that
  // read the wrong column answers with the other kind rather than returning
  // something plausible — which is exactly how this inverts silently.
  assert.deepEqual(
    oversightOrgOfUser(tenancy({ sendingChurchId: SENDING_CHURCH })),
    { orgType: "sending_church", orgId: SENDING_CHURCH }
  );
  assert.deepEqual(oversightOrgOfUser(tenancy({ sendingNetworkId: NETWORK })), {
    orgType: "network",
    orgId: NETWORK,
  });

  // BOTH FKs SET NAMES NEITHER, and that is what replaced the role. The role
  // used to break the tie; a precedence order would break it wrongly, handing
  // one org's reach to an account with a competing claim on the other. So the
  // defect resolves to no org and reaches nothing.
  const both = tenancy({
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  });
  assert.equal(oversightOrgOfUser(both), null);

  // No church-level tenancy speaks for an org, however its FK columns are
  // filled — and a plant FK alongside an oversight one is the same defect.
  const churchLevel: [string, TenancyFields][] = [
    ["a seat in a plant", tenancy({ churchId: PLANT })],
    ["a coach, who names no tenancy at all", tenancy()],
    ["a plant tenancy carrying a stray org FK", { ...both, churchId: PLANT }],
    [
      "a plant tenancy carrying a stray sending-church FK",
      tenancy({ churchId: PLANT, sendingChurchId: SENDING_CHURCH }),
    ],
  ];

  for (const [who, fields] of churchLevel) {
    assert.equal(oversightOrgOfUser(fields), null, who);
  }
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
  const remove = ACTIONS.after("export async function removePlantFromOrg(");

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
  const remove = CORE.span(
    "export async function removePlantFromOrgAs",
    "async function announcePlantRemovedFor"
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
  assertInOrder(
    remove,
    "core.ts → removePlantFromOrgAs",
    [
      "severAssociationWithAuditStatement",
      "if (!severed)",
      "announcePlantRemovedFor",
    ],
    "the planter must not be told before the sever commits, and a refused removal announces nothing"
  );

  // The org is passed to the sever from the session-derived value, never
  // re-read off the plant — which is how the OTHER of a plant's two
  // associations would get severed.
  assert.match(remove, /orgType: org\.orgType/);
  assert.match(remove, /orgId: org\.orgId/);
});
