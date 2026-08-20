import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { User } from "@/db/schema";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

import {
  OVERSIGHT_OWN_RELATIONSHIP_TYPES,
  isOwnRelationshipType,
} from "./categories";
import { recipientAdministersOrg } from "./enqueue";
import type { OversightOrgIds } from "./oversight-admin";
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

/**
 * Every cut below goes through this, never a hand-sliced offset.
 *
 * A source-shaped guard that stops matching its own subject passes SILENTLY: a
 * missing needle resolves to -1, `slice(-1, end)` hands back the empty string,
 * and every `doesNotMatch` in this file is true of nothing. That is the shape
 * `src/lib/testing/source-span.ts` exists to make impossible — a moved anchor
 * throws, naming the file and the needle.
 */
const ENQUEUE_SOURCE = sourceReader(ENQUEUE, "enqueue.ts");

/** Anchors shared by the three tests that read gate 1, declared once. */
const GATE_START = "async recipientMayBeNotified(";
const CONSENT_GATE = "if (isOversightUser(";
const GATE_END = "async insertIfAbsent(";

/** The label a failure inside the extracted gate should be grepped under. */
const GATE_LABEL = "enqueue.ts recipientMayBeNotified";

/** Gate 1's body, cut out of `enqueue.ts` — the subject of the three reads. */
function gateSource(): string {
  return ENQUEUE_SOURCE.span(GATE_START, GATE_END);
}

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
      { churchId: null, sendingChurchId: null, sendingNetworkId: null },
      CHURCH
    ),
    false
  );
});

// ----------------------------------------------------------------------------
// The pairing — the row's OWN tenancy × the org FK (#304 round 8, ruled
// 2026-08-10; re-pointed by #494)
//
// All three tenancy FKs live on ONE `users` row and nothing in the schema holds
// an account to one (memory/invariants.md → Multi-Tenancy). Round 7 found that
// this probe took the row as it came and OR'd the two oversight arms, so an
// account carrying a `sending_church_id` it does not administer satisfied the
// probe through THAT sending church's invitations — the hierarchy walk the
// invariant forbids. `recipientOrgOf` is the fix; with `users.role` dropped it
// asks `oversightOrgOf`, which answers only for a row naming EXACTLY ONE
// tenancy. Asserted over the whole domain rather than on the one case that bit.
// ----------------------------------------------------------------------------

const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const PLANT = "55555555-5555-4555-8555-555555555555";

/** A whole `users` row around the columns the pairing reads. */
function user(recipient: OversightRecipient): User {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    seat: "owner",
    name: null,
    email: "admin@example.test",
    passwordHash: "x",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...recipient,
  } as User;
}

const NO_ORG: OversightOrgIds = {
  sendingChurchId: null,
  sendingNetworkId: null,
};

/**
 * Every tenancy shape a `users` row can carry, and the org it contributes.
 *
 * The rule, not a table of coincidences: a row naming exactly one OVERSIGHT
 * tenancy contributes that org; a row naming a plant, nothing, or TWO tenancies
 * contributes nothing at all, which matches nobody rather than everybody.
 */
const TENANCIES: [string, OversightRecipient, OversightOrgIds][] = [
  ["no tenancy", { churchId: null, ...NO_ORG }, NO_ORG],
  ["a plant", { churchId: PLANT, ...NO_ORG }, NO_ORG],
  [
    "a sending church",
    { churchId: null, sendingChurchId: SENDING_CHURCH, sendingNetworkId: null },
    { sendingChurchId: SENDING_CHURCH, sendingNetworkId: null },
  ],
  [
    "a network",
    { churchId: null, sendingChurchId: null, sendingNetworkId: NETWORK },
    { sendingChurchId: null, sendingNetworkId: NETWORK },
  ],
  [
    "both oversight orgs",
    {
      churchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    },
    NO_ORG,
  ],
  [
    "a plant AND a network",
    { churchId: PLANT, sendingChurchId: null, sendingNetworkId: NETWORK },
    NO_ORG,
  ],
];

test("a row contributes exactly its own tenancy's org, over the whole domain", () => {
  for (const [what, row, expected] of TENANCIES) {
    assert.deepEqual(recipientOrgOf(row), expected, what);
  }
});

test("a row naming TWO tenancies contributes nothing, so it reaches nobody", () => {
  // The hierarchy walk, closed from the other side. While `users.role` existed
  // the role broke the tie; with it gone, a row carrying a network's id AND a
  // sending church's resolves to neither, so neither org's recorded
  // relationship can be reached through it.
  assert.deepEqual(
    recipientOrgOf({
      churchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    }),
    NO_ORG
  );
});

test("an account carrying a foreign sending_church_id reaches no sending church", async () => {
  // The exact shape round 7 named. The recipient administers a NETWORK, they DO
  // carry a `sending_church_id`, and the plant's only recorded relationship is
  // an invitation that sending church issued — so the OR'd version returned
  // true and `enqueue` filed the row. Now the row names two tenancies, resolves
  // to neither, and the probe never asks the database at all, which is why this
  // runs without one.
  assert.equal(
    await orgHasRecordedRelationshipWithChurch(
      {
        churchId: null,
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: NETWORK,
      },
      CHURCH
    ),
    false
  );

  // The mirror case: a plant tenancy carrying a stray network id.
  assert.equal(
    await orgHasRecordedRelationshipWithChurch(
      { churchId: PLANT, sendingChurchId: null, sendingNetworkId: NETWORK },
      CHURCH
    ),
    false
  );
});

test("the pairing agrees with the org-anchored gate, which is the other half of the same rule", () => {
  // `recipientAdministersOrg` resolves the row's tenancy against an anchor
  // KIND for an org-anchored row; this resolves it against an org FK for a
  // church-anchored one. Two questions, one rule — and they are asserted
  // against each other over every tenancy shape, so a later edit cannot relax
  // one and leave the other looking like it still holds.
  for (const [what, recipient] of TENANCIES) {
    const paired = recipientOrgOf(recipient);

    assert.equal(
      paired.sendingChurchId !== null,
      recipientAdministersOrg(user(recipient), {
        type: "sending_church",
        orgId: SENDING_CHURCH,
      }),
      `${what} — sending church`
    );
    assert.equal(
      paired.sendingNetworkId !== null,
      recipientAdministersOrg(user(recipient), {
        type: "network",
        orgId: NETWORK,
      }),
      `${what} — network`
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
  const gate = gateSource();

  assertInOrder(
    gate,
    GATE_LABEL,
    [
      "await canAccessChurch(recipient, churchId)",
      "orgHasRecordedRelationshipWithChurch",
    ],
    "the fallback must never be able to answer the tenancy question first"
  );

  // And it sits INSIDE the refusal branch, so the ordinary path — every
  // notification in the product except two — never reaches it and never pays
  // for its two probes.
  const branch = sourceReader(gate, GATE_LABEL).span(
    "await canAccessChurch(recipient, churchId)",
    CONSENT_GATE
  );
  assert.match(branch, /orgHasRecordedRelationshipWithChurch/);
});

test("all three conjuncts are required, and the refusal is unchanged", () => {
  const fallback = sourceReader(gateSource(), GATE_LABEL).span(
    "const mayRestOnRecord",
    CONSENT_GATE
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
  //
  // Read through the reader, not a bare `indexOf`: this is a `doesNotMatch`
  // pair, so a start anchor that moved would slice the EMPTY STRING and both
  // assertions would pass against nothing. The guard has to fail on its own
  // subject or it is not a guard.
  const gate = ENQUEUE_SOURCE.span(CONSENT_GATE, GATE_END);

  assert.doesNotMatch(gate, /orgHasRecordedRelationshipWithChurch/);
  assert.doesNotMatch(gate, /isOwnRelationshipType/);
});
