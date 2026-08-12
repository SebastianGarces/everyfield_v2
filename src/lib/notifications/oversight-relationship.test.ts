import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { User } from "@/db/schema";

import {
  OVERSIGHT_OWN_RELATIONSHIP_TYPES,
  isOwnRelationshipType,
} from "./categories";
import { recipientAdministersOrg } from "./enqueue";
import {
  orgHasRecordedRelationshipWithChurch,
  recipientOrgOf,
  type OversightRecipient,
} from "./oversight-relationship";

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
      {
        role: "sending_church_admin",
        sendingChurchId: null,
        sendingNetworkId: null,
      },
      CHURCH
    ),
    false
  );
});

// ----------------------------------------------------------------------------
// The pairing — role × org FK (#304 round 8, ruled 2026-08-10)
//
// Both oversight FKs live on ONE `users` row and neither implies the other
// (memory/invariants.md → Multi-Tenancy). Round 7 found that this probe took the
// row as it came and OR'd the two arms, so a `network_admin` carrying a
// `sending_church_id` they do not administer satisfied it through THAT sending
// church's invitations — the hierarchy walk the invariant forbids, arriving
// through the role rather than through the FK. `recipientOrgOf` is the fix, and
// it is asserted over the whole domain rather than on the one case that bit.
// ----------------------------------------------------------------------------

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";

const ROLES = [
  "planter",
  "coach",
  "team_member",
  "sending_church_admin",
  "network_admin",
] as const;

/** A whole `users` row around the three columns the pairing reads. */
function user(recipient: OversightRecipient): User {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    churchId: null,
    name: null,
    email: "admin@example.test",
    passwordHash: "x",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...recipient,
  } as User;
}

/** Every combination of the two FKs: neither, one, the other, both. */
const ORG_FKS = [
  { sendingChurchId: null, sendingNetworkId: null },
  { sendingChurchId: SENDING_CHURCH, sendingNetworkId: null },
  { sendingChurchId: null, sendingNetworkId: NETWORK },
  { sendingChurchId: SENDING_CHURCH, sendingNetworkId: NETWORK },
] as const;

test("each role contributes exactly its own kind of org, over the whole domain", () => {
  // 5 roles × 4 FK shapes, and the expected answer is stated as a rule rather
  // than a table: the sending-church admin contributes ONLY `sendingChurchId`,
  // the network admin ONLY `sendingNetworkId`, everybody else nothing.
  for (const role of ROLES) {
    for (const fks of ORG_FKS) {
      const paired = recipientOrgOf({ role, ...fks });
      const label = `${role} + ${JSON.stringify(fks)}`;

      if (role === "sending_church_admin") {
        assert.deepEqual(
          paired,
          { sendingChurchId: fks.sendingChurchId, sendingNetworkId: null },
          label
        );
      } else if (role === "network_admin") {
        assert.deepEqual(
          paired,
          { sendingChurchId: null, sendingNetworkId: fks.sendingNetworkId },
          label
        );
      } else {
        assert.deepEqual(
          paired,
          { sendingChurchId: null, sendingNetworkId: null },
          label
        );
      }
    }
  }
});

test("a network admin carrying a foreign sending_church_id reaches no sending church", async () => {
  // The exact shape round 7 named. The recipient IS a network admin, they DO
  // carry a `sending_church_id`, and the plant's only recorded relationship is
  // an invitation that sending church issued — so the OR'd version returned
  // true and `enqueue` filed the row. With the pairing there is nothing for the
  // sending-church arm to be built from, the network arm names an org the
  // record does not mention, and the probe never asks the database at all,
  // which is why this runs without one.
  assert.equal(
    await orgHasRecordedRelationshipWithChurch(
      {
        role: "network_admin",
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: null,
      },
      CHURCH
    ),
    false
  );

  // The mirror case: a sending-church admin carrying a stray network id.
  assert.equal(
    await orgHasRecordedRelationshipWithChurch(
      {
        role: "sending_church_admin",
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      CHURCH
    ),
    false
  );
});

test("the pairing agrees with the org-anchored gate, which is the other half of the same rule", () => {
  // `recipientAdministersOrg` pairs role to anchor KIND for an org-anchored row;
  // this pairs role to org FK for a church-anchored one. Two questions, one
  // rule — and they are asserted against each other so a later edit cannot
  // relax one and leave the other looking like it still holds.
  for (const role of ROLES) {
    const recipient = {
      role,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    };
    const paired = recipientOrgOf(recipient);

    assert.equal(
      paired.sendingChurchId !== null,
      recipientAdministersOrg(user(recipient), {
        type: "sending_church",
        orgId: SENDING_CHURCH,
      }),
      `${role} — sending church`
    );
    assert.equal(
      paired.sendingNetworkId !== null,
      recipientAdministersOrg(user(recipient), {
        type: "network",
        orgId: NETWORK,
      }),
      `${role} — network`
    );
  }
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
