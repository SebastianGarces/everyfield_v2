import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  OVERSIGHT_OWN_RELATIONSHIP_TYPES,
  isOwnRelationshipType,
} from "./categories";
import { orgHasRecordedRelationshipWithChurch } from "./oversight-relationship";

// ============================================================================
// #304 — the recorded-relationship tenancy basis, and the ordering that keeps
// it from being a bypass.
//
// `enqueue`'s gate 1 is the only tenancy check a notification passes, and this
// unit added an alternative way of satisfying it. That is a security change, so
// the properties that make it narrow are pinned rather than described:
//
//   1. it is asked ONLY after `canAccessChurch` has already refused;
//   2. it applies to TWO server-composed types and nothing else;
//   3. it applies only to an OVERSIGHT recipient;
//   4. it requires a row in the database, and an org that names no id matches
//      nothing rather than everything.
//
// (4) is executed. (1)-(3) are read off `enqueue.ts`, because what they pin IS
// the shape of that branch — a rearrangement that made the fallback the first
// question, or dropped one of its conjuncts, would still type-check and would
// still pass every behavioural test in `enqueue.test.ts`.
// ============================================================================

const ENQUEUE = readFileSync(
  path.join(process.cwd(), "src", "lib", "notifications", "enqueue.ts"),
  "utf8"
);

const CHURCH = "11111111-1111-4111-8111-111111111111";

// ----------------------------------------------------------------------------
// The fallback's own refusal — no org, no relationship
// ----------------------------------------------------------------------------

test("a recipient with no org of their own matches nothing, and asks the DB nothing", async () => {
  // The `false`-not-`undefined` rule this repo applies to every org predicate
  // (`invitingOrgFilter` in the invitation logic layer): an `and()` with an
  // undefined arm collapses to "every row in the product", which here would mean
  // "every plant is your relationship". The early return also means a
  // church-level user never costs a round trip — this runs with no database.
  assert.equal(
    await orgHasRecordedRelationshipWithChurch(
      { sendingChurchId: null, sendingNetworkId: null },
      CHURCH
    ),
    false
  );
});

// ----------------------------------------------------------------------------
// What the fallback covers
// ----------------------------------------------------------------------------

test("exactly two types may rest on a recorded relationship", () => {
  assert.equal(OVERSIGHT_OWN_RELATIONSHIP_TYPES.length, 2);

  // Both are events that END the relationship — the two cases where
  // `canAccessChurch` is false BY CONSTRUCTION and no ordering of the writes
  // could make it true.
  assert.deepEqual(
    [...OVERSIGHT_OWN_RELATIONSHIP_TYPES],
    [
      "oversight.milestone.invitation_declined",
      "oversight.milestone.association_ended",
    ]
  );

  // A type nobody composes gets nothing. `type` is a free string on the enqueue
  // input, so the closed list is what stops it being an input surface.
  for (const type of [
    "",
    "oversight.milestone.",
    "oversight.milestone.invitation_declined ",
    "OVERSIGHT.MILESTONE.INVITATION_DECLINED",
    "task.overdue",
    "oversight.activity.digest",
  ]) {
    assert.equal(isOwnRelationshipType(type), false, JSON.stringify(type));
  }
});

// ----------------------------------------------------------------------------
// Where the fallback sits, read off the gate itself
// ----------------------------------------------------------------------------

test("the fallback is asked only AFTER canAccessChurch has refused", () => {
  const gate = ENQUEUE.slice(
    ENQUEUE.indexOf("async recipientMayBeNotified("),
    ENQUEUE.indexOf("async insertIfAbsent(")
  );

  const access = gate.indexOf("await canAccessChurch(recipient, churchId)");
  const fallback = gate.indexOf("orgHasRecordedRelationshipWithChurch");

  assert.ok(access >= 0, "the tenancy check is gone");
  assert.ok(fallback >= 0, "the fallback is gone");
  assert.ok(
    access < fallback,
    "the fallback must never be able to answer the tenancy question first"
  );

  // And it sits INSIDE the refusal branch, so the ordinary path — every
  // notification in the product except two — never reaches it and never pays
  // for its two probes.
  const branch = gate.slice(access, gate.indexOf("if (isOversightUser("));
  assert.match(branch, /orgHasRecordedRelationshipWithChurch/);
});

test("all three conjuncts are required, and the refusal is unchanged", () => {
  const gate = ENQUEUE.slice(
    ENQUEUE.indexOf("async recipientMayBeNotified("),
    ENQUEUE.indexOf("async insertIfAbsent(")
  );

  const fallback = gate.slice(
    gate.indexOf("const mayRestOnRecord"),
    gate.indexOf("if (isOversightUser(")
  );

  // Type, role, record — an `&&` chain, so dropping any one of them is a diff a
  // reviewer sees rather than a behaviour they have to infer.
  assert.match(fallback, /isOwnRelationshipType\(type\)/);
  assert.match(fallback, /isOversightUser\(recipient\)/);
  assert.match(
    fallback,
    /await orgHasRecordedRelationshipWithChurch\(recipient, churchId\)/
  );
  assert.equal(fallback.match(/&&/g)?.length, 2, fallback);

  // A recipient the fallback does not rescue is refused with the SAME reason
  // the check has always used — this adds no new refusal a caller has to learn.
  assert.match(
    fallback,
    /return \{ allowed: false, reason: "outside_church" \}/
  );
});

test("the fallback cannot reach the consent gate's decision", () => {
  // The two gates stay independent: this one is about WHICH TENANT a row may be
  // filed under, `oversightGateFor` is about consent. If the fallback were
  // consulted inside the oversight block it could relax the sharing question for
  // a plant it had never been given access to.
  const gate = ENQUEUE.slice(
    ENQUEUE.indexOf("if (isOversightUser("),
    ENQUEUE.indexOf("async insertIfAbsent(")
  );

  assert.doesNotMatch(gate, /orgHasRecordedRelationshipWithChurch/);
  assert.doesNotMatch(gate, /isOwnRelationshipType/);
});
