import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { churchSubject, sendingChurchSubject, toSubjectColumns } from "./audit";
import {
  NOT_IN_A_NETWORK_MESSAGE,
  SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE,
  auditableAssociationOrg,
  invitationActorFromSession,
  leaveNetworkAsSendingChurchAdmin,
  type InvitationActor,
} from "./core";

// ============================================================================
// OV-013 — A SENDING CHURCH LEAVES ITS NETWORK (#304 WS3, ruling #351).
//
// The third member of the #274 sever family, and the one that could not ship
// until migration 0035. #274 requires three things of any sever — a
// type-to-confirm, a notification, an `association_events` row — and until 0035
// that table made a CHURCH its mandatory subject, so this sever had nowhere to
// be recorded. Shipping the button then would have been "a sever with no record
// of who ended it", which is the one thing the ruling forbids.
//
// What is asserted here, and in this order:
//
//   §1 AUTHORITY — admin only, and the sending church is the actor's OWN. No
//      argument exists that could aim it at another organization.
//   §2 THE STATEMENT — the FK null and the audit row are ONE statement, the
//      audit selects FROM the sever, and the WHERE asserts the network.
//   §3 THE SUBJECT — the row carries a sending-church subject and a null
//      `church_id`, which the CHECK is what guarantees.
//   §4 THE NOTIFICATION comes LAST, and only after a row was actually severed.
//
// The executed half runs against no database on purpose: every refusal below
// happens before the first query, which is exactly the property being claimed.
// The end-to-end path (real rows, real audit, real notification) is
// `scripts/g3-association-lifecycle.ts` §8.
// ============================================================================

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const PLANT = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";

const CORE_CODE = readFileSync(
  path.join(process.cwd(), "src/lib/invitations/core.ts"),
  "utf8"
);
const AUDIT_CODE = readFileSync(
  path.join(process.cwd(), "src/lib/invitations/audit.ts"),
  "utf8"
);

function actor(overrides: Partial<InvitationActor>): InvitationActor {
  return invitationActorFromSession({
    user: {
      id: USER,
      role: "sending_church_admin",
      churchId: null,
      sendingChurchId: null,
      sendingNetworkId: null,
      ...overrides,
    },
  } as Parameters<typeof invitationActorFromSession>[0]);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    assert.fail("expected a refusal");
  } catch (error) {
    return (error as Error).message;
  }
}

// ----------------------------------------------------------------------------
// 1. Authority — before any query runs
// ----------------------------------------------------------------------------

test("only a sending church ADMIN may leave a network", async () => {
  // A member of the sending church who is not its admin is refused in the logic
  // layer, so a forged POST straight at the action meets the same refusal the
  // button does. Hiding the control is a courtesy, never the control.
  for (const role of [
    "team_member",
    "coach",
    "planter",
    "network_admin",
  ] as const) {
    assert.equal(
      await refusal(
        leaveNetworkAsSendingChurchAdmin(
          actor({ role, sendingChurchId: SENDING_CHURCH, churchId: PLANT })
        )
      ),
      SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE,
      role
    );
  }
});

test("an admin with no sending church has nothing to leave", async () => {
  assert.equal(
    await refusal(leaveNetworkAsSendingChurchAdmin(actor({}))),
    "Set up your sending church first"
  );
});

test("the action takes NO argument — there is nothing to aim", () => {
  // The `memory/invariants.md` → Authentication rule at its strongest: the
  // sending church is the actor's own, the network is whatever that sending
  // church points at, and the org kind is fixed (a sending church associates
  // with networks and nothing else). So "only the sending church's admin may
  // sever" is structural before it is a check — unlike the planter's sever,
  // where one actor genuinely has two associations to choose between.
  assert.match(
    CORE_CODE,
    /export async function leaveNetworkAsSendingChurchAdmin\(\s*actor: InvitationActor\s*\)/
  );

  const body = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function leaveNetworkAsSendingChurchAdmin"),
    CORE_CODE.indexOf("async function announceSendingChurchLeftNetworkFor")
  );
  assert.match(body, /actor\.sendingChurchId/);
  // The network is READ, never received.
  assert.match(body, /org\.sendingNetworkId/);
  assert.doesNotMatch(body, /sendingNetworkId: string/);
});

// ----------------------------------------------------------------------------
// 2. One statement, and the audit depends on the sever
// ----------------------------------------------------------------------------

test("the sever and its audit row are one statement, for both subjects", () => {
  const sever = AUDIT_CODE.slice(
    AUDIT_CODE.indexOf(
      "export async function severAssociationWithAuditStatement"
    ),
    AUDIT_CODE.indexOf("export function associationOrg")
  );

  // `memory/invariants.md` → Transactions / Atomicity: the dependent write must
  // be a DEPENDENCY of the CTE. An UPDATE that matched nothing is not a batch
  // error, so a sibling INSERT would have committed an audit row for a sever
  // that never happened.
  assert.match(sever, /with severed as \(/);
  assert.match(sever, /from severed/);
  assert.doesNotMatch(sever, /db\.batch/);

  // The tenancy assertion, and the subject is now parameterised so ONE
  // statement serves the plant's sever and the sending church's.
  assert.match(sever, /where "id" = \$\{target\.id\}::uuid/);
  assert.match(sever, /and \$\{target\.fk\} = \$\{facts\.orgId\}::uuid/);
  assert.match(sever, /\$\{target\.subjectColumn\}/);
  assert.match(sever, /\$\{target\.subjectTypeLiteral\}::varchar/);
});

test("a sending church can only be severed FROM a network", () => {
  // A sending church has exactly one association FK. Asking to sever it from a
  // "sending_church" is a caller bug, and it throws rather than quietly nulling
  // the network association under the wrong label.
  const subjectSql = AUDIT_CODE.slice(
    AUDIT_CODE.indexOf("function subjectSql("),
    AUDIT_CODE.indexOf("export function acceptedAssociationEventStatement")
  );
  assert.match(subjectSql, /orgType !== "network"/);
  assert.match(subjectSql, /throw new Error/);
  assert.match(subjectSql, /sql\.raw\("sending_network_id"\)/);
});

// ----------------------------------------------------------------------------
// 3. The subject, and the CHECK behind it
// ----------------------------------------------------------------------------

test("a sending-church sever writes a sending-church subject and no church id", () => {
  assert.deepEqual(toSubjectColumns(sendingChurchSubject(SENDING_CHURCH)), {
    subjectType: "sending_church",
    churchId: null,
    subjectSendingChurchId: SENDING_CHURCH,
  });
  assert.deepEqual(toSubjectColumns(churchSubject(PLANT)), {
    subjectType: "church",
    churchId: PLANT,
    subjectSendingChurchId: null,
  });
});

test("the accept side audits the same subject, from the invitation's type", () => {
  // The write that CREATES the association and the write that ends it must name
  // the same subject, or a sending church's history reads as two unrelated
  // halves. Both derive it from a closed union rather than from whichever FK
  // happens to be set.
  assert.deepEqual(
    auditableAssociationOrg({
      type: "sending_church_to_network",
      targetChurchId: null,
      targetSendingChurchId: SENDING_CHURCH,
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    }),
    {
      subject: sendingChurchSubject(SENDING_CHURCH),
      orgType: "network",
      orgId: NETWORK,
    }
  );
});

// ----------------------------------------------------------------------------
// 4. The network is told LAST, and only for a sever that happened
// ----------------------------------------------------------------------------

test("the announcement follows the committed sever, never precedes it", () => {
  const body = CORE_CODE.slice(
    CORE_CODE.indexOf("export async function leaveNetworkAsSendingChurchAdmin"),
    CORE_CODE.indexOf("async function announceSendingChurchLeftNetworkFor")
  );

  const severAt = body.indexOf("severAssociationWithAuditStatement");
  const guardAt = body.indexOf("if (!severed)");
  const announceAt = body.indexOf("announceSendingChurchLeftNetworkFor");

  assert.ok(severAt > -1 && guardAt > severAt && announceAt > guardAt);

  // The refusal when the UPDATE matched nothing is the honest one: nothing was
  // written — not the null, not the row — so nobody is told anything.
  assert.match(body, /throw new InvitationError\(NOT_IN_A_NETWORK_MESSAGE\)/);

  // Best-effort: a notification failure never undoes a committed sever.
  const announcer = CORE_CODE.slice(
    CORE_CODE.indexOf("async function announceSendingChurchLeftNetworkFor")
  );
  assert.match(announcer.slice(0, 600), /try \{[\s\S]*?\} catch \(error\) \{/);
});

test("the two refusals a sending church admin can read say different things", () => {
  assert.notEqual(
    SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE,
    NOT_IN_A_NETWORK_MESSAGE
  );
  // Neither names anything outside the actor's own account — a refusal that
  // described the network's state would be a fact about another tenant.
  for (const message of [
    SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE,
    NOT_IN_A_NETWORK_MESSAGE,
  ]) {
    assert.doesNotMatch(message, /\b[0-9a-f]{8}-/i);
  }
});
