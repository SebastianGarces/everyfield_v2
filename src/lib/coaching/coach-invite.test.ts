// ============================================================================
// THE COACH INVITE FLOW — #496's acceptance criteria, as executable statements.
//
// The seat suite (`@/lib/invitations/seat.test.ts`) owns everything the two
// KINDS share: the token, the cap, the positional neutrality rule, the refusal
// predicate read for both kinds. This suite owns what is true of a COACH and
// false of a seat — the assignment write, the reach it grants, the reach it does
// NOT grant, and the navigation that appears with it.
//
// SQL, NOT A DATABASE. Every write here is asserted as the statement it will
// send: `db.batch` is the unit of atomicity and the ORDER of its members is the
// guard, so what has to be pinned is the SQL and the sequence, not a row that
// came back from a server that happened to be up. The live-database half is
// `@/lib/invitations/seat-invitations-live.test.ts`'s job.
// ============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CAPABILITY_BY_EXPORT } from "@/lib/auth/capability-map";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import {
  assignedPlantsNavSection,
  ASSIGNED_PLANTS_LABEL,
  coachedPlantPath,
} from "@/lib/navigation";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import { assignCoachOnAcceptStatement } from "./assignments";

const SRC = path.join(process.cwd(), "src");
const read = (...segments: string[]) =>
  readFileSync(path.join(SRC, ...segments), "utf8");

const ASSIGNMENTS = sourceReader(
  stripComments(read("lib", "coaching", "assignments.ts")),
  "coaching/assignments.ts"
);
const COACH_READ = sourceReader(
  stripComments(read("lib", "coaching", "read.ts")),
  "coaching/read.ts"
);
const ACCEPT = sourceReader(
  stripComments(read("lib", "invitations", "coach.ts")),
  "invitations/coach.ts"
);
const REGISTER = sourceReader(
  stripComments(read("app", "(auth)", "register", "actions.ts")),
  "register/actions.ts"
);

const PLANT = "11111111-1111-4111-8111-111111111111";
const OTHER_PLANT = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const INVITATION = "66666666-6666-4666-8666-666666666666";

function account(overrides: Partial<SeatFields> = {}): SeatFields {
  return {
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  };
}

/** A coach: no tenancy, no seat. The account AC 1 says a coach invitation makes. */
const COACH = account();
const PLANT_MEMBER = account({ seat: "member", churchId: PLANT });
const NETWORK_OWNER = account({ seat: "owner", sendingNetworkId: NETWORK });

// ----------------------------------------------------------------------------
// 1. THE GRANT — one assignment, gated on the claim it is batched with
// ----------------------------------------------------------------------------

test("the assignment cannot be written unless the claim it rides with won", () => {
  // The invariant (`memory/invariants.md` → Transactions): "in a batch the
  // compare-and-set goes FIRST and the dependent write's WHERE re-asserts what
  // the claim set". Here the dependent write is an INSERT, which has no WHERE of
  // its own — so it is an INSERT … SELECT, and the SELECT carries the guard.
  const { sql, params } = assignCoachOnAcceptStatement(INVITATION).toSQL();

  assert.match(sql, /^insert into "coach_assignments"/);
  assert.match(sql, /select .* from "user_invitations"/);
  assert.match(
    sql,
    /"user_invitations"\."status" = \$/,
    "the assignment must re-assert the status the claim set, or a revoked invitation still assigns"
  );
  assert.ok(params.includes("accepted"));
  assert.ok(params.includes("coach"));
  assert.ok(params.includes(INVITATION));
});

test("the coach and the plant are READ OUT OF the invitation, never passed in", () => {
  // There is no parameter here for a caller to get wrong: an assignment cannot
  // name a person the invitation did not answer, or a plant it did not come
  // from, because both columns are selected from the row itself.
  const { sql } = assignCoachOnAcceptStatement(INVITATION).toSQL();

  assert.match(sql, /"responded_by"/);
  assert.match(sql, /"church_id"/);

  // The signature is the proof: one argument, and it is the invitation.
  assert.match(
    ASSIGNMENTS.code,
    /export function assignCoachOnAcceptStatement\(invitationId: string\)/
  );
});

test("a re-accept revives an ENDED assignment instead of throwing", () => {
  // `coach_assignments_coach_church_unique` is TOTAL, not partial on `status`,
  // so an ended assignment still occupies the pair. A bare insert would answer a
  // 500 to a flow the product offers — re-inviting a coach whose assignment was
  // ended — so the write converges instead (AC 4's other half).
  const { sql } = assignCoachOnAcceptStatement(INVITATION).toSQL();

  assert.match(sql, /on conflict \("coach_user_id","church_id"\) do update/);
  assert.match(sql, /set "status" = \$/);

  // And the schema really does carry the total unique index the AC names.
  assert.match(
    read("db", "schema", "coach-assignment.ts"),
    /unique\("coach_assignments_coach_church_unique"\)\.on\(\s*table\.coachUserId,\s*table\.churchId\s*\)/
  );
});

test("registration batches the assignment AFTER the claim, never before", () => {
  // AC 1's atomicity. The order is the guard, so it is asserted as an order.
  const claim = REGISTER.code.indexOf("claimUserInvitationStatement(");
  const assign = REGISTER.code.indexOf("assignCoachOnAcceptStatement(");

  assert.ok(claim > 0, "registration no longer claims the invitation");
  assert.ok(assign > 0, "registration no longer assigns the coach");
  assert.ok(
    claim < assign,
    "the assignment is pushed before the claim — a revoked invitation would still assign"
  );
});

test("accepting from an existing account is ONE batch, claim first", () => {
  // AC 2's atomicity, and the same order for the same reason.
  const batch = ACCEPT.span("await db.batch([", "]);");

  assert.ok(
    batch.indexOf("claimUserInvitationStatement") <
      batch.indexOf("assignCoachOnAcceptStatement"),
    "the accept batch assigns before it claims"
  );

  // An empty claim is a refusal, not a silent success.
  assert.match(ACCEPT.code, /if \(claimed\.length === 0\)/);
});

// ----------------------------------------------------------------------------
// 2. WHAT ACCEPTING CHANGES, AND WHAT IT MUST NOT (AC 1, AC 2)
// ----------------------------------------------------------------------------

test("a coach registration writes no tenancy and no seat", () => {
  // The planner's coach arm, read off the source it is decided in. The
  // behavioural half — the plan object itself — is asserted in the seat suite,
  // which already holds `createAccountEntities`.
  const planner = stripComments(
    read("app", "(auth)", "register", "account-entities.ts")
  );
  const coachArm = planner.slice(
    planner.indexOf('if (userInvitation.role.kind === "coach")'),
    planner.indexOf("const churchId = crypto.randomUUID()")
  );

  assert.match(coachArm, /seat: null/);
  assert.match(coachArm, /churchId: null/);
  assert.match(coachArm, /userChurchId: null/);
  assert.match(coachArm, /sendingChurchId: null/);
  assert.match(coachArm, /sendingNetworkId: null/);
  assert.match(coachArm, /linkStatements: \[\]/);
});

test("accepting from an existing account touches ONLY coach_assignments", () => {
  // AC 2: an account that already holds a seat elsewhere keeps it. The proof is
  // that the accept path's whole write surface is two statements and neither of
  // them is an UPDATE on `users` — there is no `users` write to snapshot around,
  // because there is none to make.
  assert.doesNotMatch(ACCEPT.code, /update\(users\)/);
  assert.doesNotMatch(ACCEPT.code, /\.set\(\{[^}]*churchId/);
  assert.doesNotMatch(ACCEPT.code, /\.set\(\{[^}]*seat/);

  // …and the statement it does issue names one table.
  const { sql } = assignCoachOnAcceptStatement(INVITATION).toSQL();
  assert.doesNotMatch(sql, /update "users"/);
});

test("a forwarded link cannot be spent by whoever it reached", () => {
  // The token is bound to the invited address, checked against the SESSION
  // rather than against anything a form said.
  assert.match(
    ACCEPT.code,
    /described\.inviteeEmail\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(ACCEPT.code, /user\.email \?\? ""/);
  assert.match(ACCEPT.code, /invited !== answering/);
});

test("every refusal on the accept path is the ONE sentence", () => {
  // Unknown, expired, revoked, answered, wrong address, seat-not-coach: one
  // message, so a forwarded link learns what a guessed one does.
  const thrown =
    ACCEPT.code.match(/throw new InvitationError\(([^)]+)\)/g) ?? [];

  assert.ok(thrown.length >= 3, "the accept path stopped refusing");
  for (const site of thrown) {
    assert.match(
      site,
      /COACH_INVITATION_NOT_ANSWERABLE_MESSAGE/,
      `a second sentence reached the accept path: ${site}`
    );
  }
});

// ----------------------------------------------------------------------------
// 3. THE REACH — the plant's own records, ungated (AC 5, AC 6, AC 7)
// ----------------------------------------------------------------------------

test("the coach read is gated by the ASSIGNMENT and by no share_* toggle", () => {
  // AC 5. The six toggles gate what OVERSIGHT may pull; a coach's consent is the
  // assignment the plant wrote by name. A `canAccessFeatureData` call here would
  // in fact answer `true` anyway — a coach names no tenancy, so
  // `isChurchLevelUser` admits them — which is exactly why its ABSENCE is the
  // assertion: a no-op that reads like a gate is worse than no gate.
  assert.doesNotMatch(COACH_READ.code, /canAccessFeatureData/);
  assert.doesNotMatch(COACH_READ.code, /share_/);
  assert.doesNotMatch(COACH_READ.code, /churchPrivacySettings/);

  // The gate that IS there runs before anything is read.
  const body = COACH_READ.after("export async function readCoachedPlant");
  assert.ok(
    body.indexOf("coachesPlant(user.id, churchId)") <
      body.indexOf("listPeople"),
    "the plant is read before the assignment is checked"
  );
  assert.match(
    body,
    /if \(!\(await coachesPlant\(user\.id, churchId\)\)\) return null/
  );
});

test("the coach read returns the plant's OWN records, not aggregates", () => {
  // AC 7 (i), and the line that separates this reader from `@/lib/oversight/read`,
  // whose own header forbids exactly what this one requires.
  assert.match(COACH_READ.code, /people: PersonForClient\[\]/);
  assert.match(COACH_READ.code, /listPeople\(churchId/);
  assert.match(COACH_READ.code, /listTasks\(churchId/);
});

test("the two reaches read two different lists of church ids", () => {
  // AC 7. An oversight seat holder who also coaches a plant gets both answers,
  // each in its own scope, because neither reader borrows the other's list: the
  // oversight one starts from the ORG (`getAccessibleChurchIds`), this one from
  // the ASSIGNMENTS (`coachesPlant`).
  assert.doesNotMatch(COACH_READ.code, /getAccessibleChurchIds/);

  const oversight = stripComments(read("lib", "oversight", "read.ts"));
  assert.match(oversight, /getAccessibleChurchIds/);
  assert.doesNotMatch(oversight, /coachesPlant|assignedChurchIds/);

  // …and "which plants does a coach reach" has ONE implementation, which the
  // access check delegates to rather than copying.
  assert.match(
    stripComments(read("lib", "auth", "access.ts")),
    /return assignedChurchIds\(coachUserId\)/
  );
});

test("a coach can write nothing, and the refusal is structural", () => {
  // AC 6. Every write verb is `tenancy: "plant"`, which demands a non-null
  // `church_id`; a coach has none. So this is not a rule the coach surfaces have
  // to remember — it is one they cannot get wrong.
  for (const verb of [
    "people.write",
    "tasks.write",
    "meetings.write",
    "teams.write",
    "communication.send",
    "seat.invitation.manage",
    "coach.assignment.manage",
  ] as const) {
    assert.equal(
      holdsSeatFor(COACH, verb),
      false,
      `a coach may ${verb} — a seatless account must reach no plant write`
    );
  }

  // …and the coach's own view issues none either.
  assert.doesNotMatch(COACH_READ.code, /db\.insert|db\.update|db\.delete/);
});

test("an oversight seat holder who coaches still cannot write on the coached plant", () => {
  // The other half of AC 7: the two reaches do not borrow each other's scope, and
  // a write verb is a PLANT verb, which an oversight tenancy fails outright.
  for (const verb of ["people.write", "tasks.write"] as const) {
    assert.equal(holdsSeatFor(NETWORK_OWNER, verb), false, verb);
  }

  // A plant Member holds their OWN plant's writes and nothing names another's:
  // the coach view resolves its church from the URL and checks the assignment,
  // and no write action does — every one of them reads `user.churchId`.
  assert.equal(holdsSeatFor(PLANT_MEMBER, "tasks.own"), true);
  assert.match(
    stripComments(
      read("app", "(dashboard)", "coaching", "[churchId]", "page.tsx")
    ),
    /readCoachedPlant\(user, churchId\)/
  );
});

// ----------------------------------------------------------------------------
// 4. THE NAVIGATION (AC 8)
// ----------------------------------------------------------------------------

test("the Assigned plants section appears when there is at least one assignment", () => {
  const section = assignedPlantsNavSection([
    { churchId: PLANT, churchName: "Grace City" },
    { churchId: OTHER_PLANT, churchName: "Hope Chapel" },
  ]);

  assert.ok(section);
  assert.equal(section.title, ASSIGNED_PLANTS_LABEL);
  assert.deepEqual(
    section.items.map((item) => [item.title, item.href]),
    [
      ["Grace City", coachedPlantPath(PLANT)],
      ["Hope Chapel", coachedPlantPath(OTHER_PLANT)],
    ]
  );
});

test("…and is omitted ENTIRELY when there are none", () => {
  // `null`, not an empty group with a heading: a planter who has never been asked
  // to coach anybody must not carry a permanent empty shelf.
  assert.equal(assignedPlantsNavSection([]), null);

  // The sidebar renders the section it is given, so the null IS the omission —
  // one decision, not a heading in one file and a list in another.
  assert.match(
    stripComments(read("components", "app-sidebar.tsx")),
    /\{coaching && \(/
  );
});

// ----------------------------------------------------------------------------
// 5. THE ENDPOINTS (AC 9)
// ----------------------------------------------------------------------------

test("inviting a coach and answering one are checked in against their verbs", () => {
  assert.equal(
    CAPABILITY_BY_EXPORT[
      "src/app/(dashboard)/settings/team/actions.ts → createCoachInvitationAction"
    ],
    "coach.assignment.manage"
  );
  assert.equal(
    CAPABILITY_BY_EXPORT[
      "src/app/(auth)/coach-invitation/actions.ts → acceptCoachInvitationAction"
    ],
    "coach.invitation.answer"
  );
});

test("a seat token cannot be answered at the coach surface, and vice versa", () => {
  // One query key carries both kinds, so each surface refuses the other's token
  // rather than acting on it — and refuses it with its own ordinary "no".
  assert.match(ACCEPT.code, /described\.role\.kind !== "coach"/);
  assert.match(
    stripComments(read("lib", "invitations", "seat.ts")),
    /row\.kind === "coach"\s*\?\s*\{ kind: "coach" \}/
  );
});
