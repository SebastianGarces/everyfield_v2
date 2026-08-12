import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  NOT_ASSOCIATED_MESSAGE,
  PLANTER_ONLY_SEVER_MESSAGE,
  auditableAssociationOrg,
  isAssociationOrgType,
  leaveOversightOrgAs,
  oversightOrgTypes,
  verifyInvitationAuthority,
  type InvitationActor,
} from "./core";
import { associationOrg } from "./audit";

// ============================================================================
// #304 / OV-007a + OV-008 — the planter's sever, and the audit that has to
// commit with it.
//
// Three things are worth a test here and they fail in three different ways:
//
//   1. THE AUTHORITY RULE (OV-010, ruled #274). Planter only, refused in the
//      logic layer so a forged call meets it. Executed — a `team_member` and a
//      `coach` are real actors here, not a mocked role string, and they are
//      refused BEFORE any read, so these tests need no database.
//   2. THE TENANCY ASSERTION on the FK write (#304's high-risk extra). Read off
//      the generated SQL: the UPDATE's WHERE names the org being left, and the
//      audit INSERT selects FROM that UPDATE rather than running beside it.
//      Neither is visible in behaviour without a live Postgres, and both are
//      exactly the kind of thing a later edit removes by accident.
//   3. THE DERIVATION of which org an event names — from the invitation's
//      `type`, never from whichever FK column happens to be set. Pure.
//
// The concurrency half (two severs, a sever racing an accept) is the G3
// harness's, on a real database; SQL text is what makes its result attributable
// to these guards.
// ============================================================================

const AUDIT_CODE = readFileSync(
  path.join(process.cwd(), "src", "lib", "invitations", "audit.ts"),
  "utf8"
);
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
    "settings",
    "association",
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
    role: "planter",
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  } as InvitationActor;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    assert.fail("expected the sever to be refused");
  } catch (error) {
    return (error as Error).message;
  }
}

// ----------------------------------------------------------------------------
// 1. Authority — OV-010, planter only, server-side
// ----------------------------------------------------------------------------

test("a team member or coach of the plant cannot sever, whatever the UI shows", async () => {
  // RULED #274 / OV-010: joining an oversight org and leaving one are both the
  // planter's decision. The refusal is the FIRST statement, so these calls never
  // read a row — which is also why they are refused identically for a plant that
  // does not exist.
  for (const role of ["team_member", "coach"] as const) {
    assert.equal(
      await refusal(leaveOversightOrgAs(actor({ role }), "sending_church")),
      PLANTER_ONLY_SEVER_MESSAGE,
      role
    );
  }

  // An oversight admin is refused by the same rule: severing from the ORG side
  // is #278's surface, with its own authority rule, and it is not this function.
  for (const role of ["sending_church_admin", "network_admin"] as const) {
    assert.equal(
      await refusal(
        leaveOversightOrgAs(
          actor({ role, churchId: null, sendingChurchId: SENDING_CHURCH }),
          "sending_church"
        )
      ),
      PLANTER_ONLY_SEVER_MESSAGE,
      role
    );
  }
});

test("the same two roles are refused ACCEPT and DECLINE, by the same rule", async () => {
  // OV-010 is one rule over three verbs, and the third is checked somewhere
  // else (`verifyInvitationAuthority`, exercised in `service.test.ts`). Stated
  // here as well because the acceptance criterion is about the three TOGETHER:
  // a team member who cannot leave but can accept has not been refused, they
  // have been slowed down.
  const invitation = {
    type: "church_to_sending_church" as const,
    targetChurchId: PLANT,
    targetSendingChurchId: null,
  };

  for (const role of ["team_member", "coach"] as const) {
    assert.throws(
      () => verifyInvitationAuthority(invitation, actor({ role })),
      /not authorized|permission/i,
      role
    );
  }

  // The planter of that same plant passes all three — so the refusals above are
  // the ROLE being checked, not the fixture being unanswerable.
  verifyInvitationAuthority(invitation, actor());
  assert.equal(
    await refusal(leaveOversightOrgAs(actor({ role: "coach" }), "network")),
    PLANTER_ONLY_SEVER_MESSAGE
  );
});

test("a planter with no plant has nothing to sever", async () => {
  assert.match(
    await refusal(
      leaveOversightOrgAs(actor({ churchId: null }), "sending_church")
    ),
    /church plant/i
  );
});

test("the org kind is a closed set — there is no id to aim", () => {
  assert.deepEqual([...oversightOrgTypes], ["sending_church", "network"]);

  for (const value of [
    "church",
    "sending_church ",
    "SENDING_CHURCH",
    PLANT,
    "",
    null,
    undefined,
    7,
  ]) {
    assert.equal(isAssociationOrgType(value), false, JSON.stringify(value));
  }
});

test("the action takes a KIND, never a church or an org id", () => {
  // The rule from `memory/invariants.md` → Authentication: an entity implied by
  // the actor is not an argument. `leaveOversightOrg` therefore has one
  // parameter, and it is the two-valued enum above — so there is no field a
  // forged POST could put another plant's id into.
  const leave = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("export async function leaveOversightOrg("),
    ACTIONS_CODE.indexOf("export async function leaveNetwork(")
  );

  assert.match(leave, /leaveOversightOrg\(\s*orgType: string\s*\)/);
  assert.match(leave, /orgTypeSchema\.safeParse\(orgType\)/);
  assert.doesNotMatch(leave, /churchId/);
  assert.doesNotMatch(leave, /orgId/);

  // And every action in the module mints its actor from the session rather than
  // accepting one.
  const mints = ACTIONS_CODE.match(
    /const actor = invitationActorFromSession\(await verifySession\(\)\);/g
  );
  assert.equal(
    mints?.length,
    4,
    "each of the four writes mints its own actor — accept, decline, and the two leaves"
  );
  assert.doesNotMatch(ACTIONS_CODE, /actor: InvitationActor/);
});

// ----------------------------------------------------------------------------
// 2. The tenancy assertion and the atomicity, read off the SQL
// ----------------------------------------------------------------------------

test("the sever nulls the FK only while it still points at the org being left", () => {
  const sever = AUDIT_CODE.slice(
    AUDIT_CODE.indexOf(
      "export async function severAssociationWithAuditStatement"
    ),
    AUDIT_CODE.indexOf("export function associationOrg")
  );

  // The whole tenancy assertion: BOTH the subject and the org are in the WHERE.
  // Without the second predicate this is the old `disassociate*` primitive —
  // "null whatever is there" — which severs the wrong org for a plant that
  // belongs to two, and severs anything at all for a caller aiming wrongly.
  //
  // The subject is `target.id` since migration 0036 (#304 WS3): the statement
  // serves a PLANT leaving an oversight org and a SENDING CHURCH leaving a
  // network, and `subjectSql` is the single place the two differ.
  assert.match(sever, /where "id" = \$\{target\.id\}::uuid/);
  assert.match(sever, /and \$\{target\.fk\} = \$\{facts\.orgId\}::uuid/);

  // The OTHER FK is never mentioned, so a plant that belongs to a sending church
  // AND a network keeps the one it is not leaving.
  assert.equal(
    (sever.match(/\$\{target\.fk\}/g) ?? []).length,
    2,
    "exactly one column is touched, in the SET and in the WHERE"
  );

  // The identifiers are chosen from closed maps, never interpolated from input:
  // `subjectSql` derives the table, the subject column and the FK from the two
  // closed unions, and the church arm still reads `OVERSIGHT_FK_COLUMN`.
  assert.match(
    AUDIT_CODE,
    /function subjectSql\(subject: AssociationSubject, orgType: AssociationOrgType\)/
  );
  assert.match(AUDIT_CODE, /sql\.raw\(OVERSIGHT_FK_COLUMN\[orgType\]\)/);
  // Nothing a request carried is ever spliced into the text — every `sql.raw`
  // argument in the module is a literal or a closed-union lookup.
  for (const raw of AUDIT_CODE.match(/sql\.raw\(([^)]*)\)/g) ?? []) {
    assert.doesNotMatch(raw, /facts\.|subject\.|input\./, raw);
  }
});

test("the audit row is written FROM the sever, not beside it", () => {
  const sever = AUDIT_CODE.slice(
    AUDIT_CODE.indexOf(
      "export async function severAssociationWithAuditStatement"
    ),
    AUDIT_CODE.indexOf("export function associationOrg")
  );

  // `memory/invariants.md` → Transactions / Atomicity: the dependent write must
  // be a DEPENDENCY of the CTE. `select … from severed` is that dependency — an
  // audit row exists if and only if a row was severed. A sibling INSERT would
  // have committed an audit row for a sever that matched nothing, and an empty
  // `returning()` rolls nothing back.
  assert.match(sever, /with severed as \(/);
  assert.match(sever, /returning "id"\s*\)/);
  assert.match(sever, /from severed/);
  assert.match(sever, /'disassociated'::varchar/);

  // The ACTOR is the session's user, read off the branded actor — there is no
  // parameter a caller could name somebody else in.
  assert.match(sever, /\$\{actor\.id\}::uuid/);
  assert.doesNotMatch(sever, /facts\.actorUserId/);
});

test("the accept's audit row re-asserts the association it claims to record", () => {
  const accept = AUDIT_CODE.slice(
    AUDIT_CODE.indexOf("export function acceptedAssociationEventStatement"),
    AUDIT_CODE.indexOf(
      "export async function severAssociationWithAuditStatement"
    )
  );

  // Batched with the claim and the association, so it must not trust either: an
  // empty `returning()` is not an error and does not roll a batch back.
  assert.match(
    accept,
    /\$\{target\.table\}\.\$\{target\.fk\} = \$\{facts\.orgId\}::uuid/
  );
  assert.match(accept, /oi\."status" = 'accepted'/);
  // …and it must not write a SECOND row when an already-accepted invitation is
  // retried: the claim loses, but both predicates above are still true.
  assert.match(accept, /not exists \(/);
  assert.match(accept, /ae\."event" = 'associated'/);
  assert.match(accept, /'associated'::varchar/);
});

test("the accept batches the audit rather than following it with a second call", () => {
  const accept = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function acceptInvitationAs"),
    CORE_CODE.indexOf("async function announceInvitationAcceptedForChurch")
  );

  assert.match(accept, /db\.batch\(\[lock, claim, association, audit\]\)/);
  // The audit-less batch survives only for a row whose type-implied ids are
  // missing (`auditableAssociationOrg` → null). Since migration 0036 all THREE
  // invitation types audit, the sending-church subject included.
  assert.match(accept, /db\.batch\(\[lock, claim, association\]\)/);
  assert.doesNotMatch(accept, /recordAssociationEvent/);
});

test("the sever announces AFTER the write, and the decline announces at all", () => {
  const leave = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function leaveOversightOrgAs"),
    CORE_CODE.indexOf("async function announceAssociationEndedFor")
  );

  // Order is load-bearing twice over: announcing first would say a plant had
  // left before it had, and the announcement's tenancy basis is the audit row
  // this statement writes.
  assert.ok(
    leave.indexOf("severAssociationWithAuditStatement") <
      leave.indexOf("announceAssociationEndedFor"),
    "the org must not be told before the sever commits"
  );
  // No audit row means the UPDATE matched nothing — nothing was written, so the
  // refusal is honest and no announcement goes out.
  assert.match(leave, /if \(!severed\)/);

  const decline = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function declineInvitationAs"),
    CORE_CODE.indexOf("async function announceInvitationDeclinedForChurch")
  );
  assert.match(decline, /announceInvitationDeclinedForChurch\(updated\)/);
  // Only after the compare-and-set actually recorded the answer.
  assert.ok(
    decline.indexOf("if (!updated)") <
      decline.indexOf("announceInvitationDeclinedForChurch")
  );
});

test("the decline tells the refused org an address, and never reads the plant's name", () => {
  // RULED 2026-08-09 (#304, HR4). The org that was refused never associated
  // with this plant; the only identifier it may be given back is the address it
  // typed itself. The absent READ is the assertion — `plantNameOf` still exists
  // for the ACCEPT path, so a later edit could easily "restore symmetry"
  // between the two announcers and hand the name over again.
  const announce = CORE_CODE.slice(
    CORE_CODE.indexOf("async function announceInvitationDeclinedForChurch"),
    CORE_CODE.indexOf("async function plantNameOf")
  );

  assert.match(announce, /inviteeEmail,/);
  assert.doesNotMatch(announce, /plantNameOf|plantName/);

  // A row with no recorded address (pre-#23) names nobody, so nothing is sent —
  // rather than falling back to the one name it must not use.
  assert.match(announce, /if \(!inviteeEmail\) return;/);

  // The ACCEPT keeps the plant's name, because by then the org is associated
  // with it. The two announcers are deliberately asymmetric.
  const accepted = CORE_CODE.slice(
    CORE_CODE.indexOf("async function announceInvitationAcceptedForChurch"),
    CORE_CODE.indexOf("async function lostClaimReason")
  );
  assert.match(accepted, /const plantName = await plantNameOf\(churchId\)/);
});

// ----------------------------------------------------------------------------
// 3. Which org an event names — derived from `type`, never from a stray FK
// ----------------------------------------------------------------------------

test("the audited org comes from the invitation's type", () => {
  // A row can carry BOTH FKs: `insertInvitation` validates nothing and there is
  // no CHECK constraint. Reading whichever is set would attribute an association
  // to an org that associated nobody — the same fault
  // `invitingOrgForInvitation` exists to prevent on the notification side.
  assert.deepEqual(
    auditableAssociationOrg({
      type: "church_to_sending_church",
      targetChurchId: PLANT,
      targetSendingChurchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    {
      subject: { subjectType: "church", churchId: PLANT },
      orgType: "sending_church",
      orgId: SENDING_CHURCH,
    }
  );

  assert.deepEqual(
    auditableAssociationOrg({
      type: "church_to_network",
      targetChurchId: PLANT,
      targetSendingChurchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    {
      subject: { subjectType: "church", churchId: PLANT },
      orgType: "network",
      orgId: NETWORK,
    }
  );
});

test("a sending church joining a network audits with a SENDING CHURCH subject", () => {
  // #304 WS3 / ruling #351, migration 0036. This arm used to return `null` —
  // not on its merits, but because `association_events.church_id` was NOT NULL
  // and the third invitation type names no church. The table now carries a
  // subject discriminator, so the arm returns the real subject and the accept
  // batch audits all three types.
  assert.deepEqual(
    auditableAssociationOrg({
      type: "sending_church_to_network",
      targetChurchId: null,
      targetSendingChurchId: SENDING_CHURCH,
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    }),
    {
      subject: {
        subjectType: "sending_church",
        sendingChurchId: SENDING_CHURCH,
      },
      orgType: "network",
      orgId: NETWORK,
    }
  );

  // `null` now means only "this row's type-implied ids are missing" — never
  // "this kind of association goes unrecorded".
  assert.equal(
    auditableAssociationOrg({
      type: "sending_church_to_network",
      targetChurchId: null,
      targetSendingChurchId: SENDING_CHURCH,
      sendingChurchId: null,
      sendingNetworkId: null,
    }),
    null
  );

  // And a row whose type-implied id is missing names no org rather than half of
  // one — reachable, since nothing validates the row on the way in.
  assert.equal(
    auditableAssociationOrg({
      type: "church_to_network",
      targetChurchId: PLANT,
      targetSendingChurchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    }),
    null
  );
});

test("associationOrg still refuses to guess when a plant holds two", () => {
  // The audit's own helper, unchanged by this unit and asserted alongside the
  // new one so the two readings of "which org" cannot drift: a plant with BOTH
  // FKs set is not one association, and a precedence rule would silently
  // attribute a sever to the wrong org.
  assert.equal(
    associationOrg({
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    null
  );
  assert.equal(
    associationOrg({ sendingChurchId: null, sendingNetworkId: null }),
    null
  );
});

test("the two refusals a planter can read say different things", () => {
  assert.notEqual(NOT_ASSOCIATED_MESSAGE, PLANTER_ONLY_SEVER_MESSAGE);
  for (const message of [NOT_ASSOCIATED_MESSAGE, PLANTER_ONLY_SEVER_MESSAGE]) {
    assert.ok(message.length > 20, message);
    assert.doesNotMatch(message, /error|failed|invalid/i);
  }
});
