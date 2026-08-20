import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OVERSIGHT_ELIGIBLE_CATEGORIES,
  OVERSIGHT_OWN_RELATIONSHIP_TYPES,
  OVERSIGHT_SHARING_EXEMPT_TYPES,
  oversightGateFor,
} from "./categories";
import {
  enqueueNotificationSchema,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";
import {
  ASSOCIATION_REMOVED_TYPE,
  announceRemovedFromOversightOrg,
  composeRemovedFromOrg,
  type PlantAssociationDeps,
} from "./plant-association";

// ============================================================================
// #304 / OV-007b — what the PLANT is told when its oversight org removes it.
//
// This is the one notification in the oversight story that travels INWARD, and
// the tests are about the three ways that could go wrong:
//
//   1. IT MUST NOT BE AN OVERSIGHT MESSAGE. Two lists in `./categories.ts` are
//      keyed on `type` strings and both relax a gate. A planter's message that
//      matched one of them would be relying on an exemption written for somebody
//      else, and would keep working for the wrong reason if that exemption were
//      ever narrowed.
//   2. IT MUST SURVIVE ITS OWN FAILURES. It runs AFTER a committed sever, so
//      nothing it does may throw — not an unresolvable org, not a failing
//      recipient.
//   3. IT MUST NAME THE ORG. A removal message with a blank counterparty cannot
//      be acted on, and is worse than silence.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const PLANTER = "33333333-3333-4333-8333-333333333333";
const ANOTHER_RECIPIENT = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";

const FACTS = {
  churchId: CHURCH,
  orgType: "sending_church",
  orgId: ORG,
  occurrence: EVENT,
} as const;

function recorded(created = true): EnqueueResult {
  return { status: "recorded", notification: null, created, reason: null };
}

function deps(
  overrides: Partial<PlantAssociationDeps> = {}
): PlantAssociationDeps & { sent: EnqueueNotificationInput[] } {
  const sent: EnqueueNotificationInput[] = [];
  return {
    sent,
    async enqueue(input) {
      sent.push(input);
      return recorded();
    },
    async plantOwner() {
      return { id: PLANTER };
    },
    async resolveOrgName() {
      return "Grace Sending Church";
    },
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// 1. It is a CHURCH-role notification, and cannot be mistaken for an oversight one
// ----------------------------------------------------------------------------

test("the removal notice is not an oversight type and rides no exemption", () => {
  assert.equal(ASSOCIATION_REMOVED_TYPE, "association.removed_by_org");

  // The prefix matters: everything under `oversight.milestone.` is addressed to
  // an oversight admin, and two of them carry a consent or a tenancy exemption.
  assert.doesNotMatch(ASSOCIATION_REMOVED_TYPE, /^oversight\./);
  assert.ok(
    !(OVERSIGHT_SHARING_EXEMPT_TYPES as readonly string[]).includes(
      ASSOCIATION_REMOVED_TYPE
    )
  );
  assert.ok(
    !(OVERSIGHT_OWN_RELATIONSHIP_TYPES as readonly string[]).includes(
      ASSOCIATION_REMOVED_TYPE
    )
  );

  // And if it ever DID reach an oversight recipient it would be gated like any
  // other milestone rather than exempt — the recipient here is a planter, whose
  // gate is `canAccessChurch` on their own plant and nothing more.
  assert.equal(
    oversightGateFor("milestones", ASSOCIATION_REMOVED_TYPE),
    "requires_sharing"
  );
});

test("it is filed under a category that exists and that oversight already receives", () => {
  const input = composeRemovedFromOrg(
    { ...FACTS, orgName: "Grace Sending Church" },
    PLANTER
  );

  assert.equal(input.category, "milestones");
  // Not a claim about this recipient — the planter is not an oversight user —
  // but a check that the category is a real one with copy on the preference
  // screen, which is what a planter turning it off would be turning off.
  assert.ok(
    (OVERSIGHT_ELIGIBLE_CATEGORIES as readonly string[]).includes(
      input.category as string
    )
  );
});

// ----------------------------------------------------------------------------
// 2. The message itself
// ----------------------------------------------------------------------------

test("the composed notification passes the enqueue contract", () => {
  const input = composeRemovedFromOrg(
    { ...FACTS, orgName: "Grace Sending Church" },
    PLANTER
  );

  // The parse is `enqueue`'s first statement, so a composition that fails it
  // throws inside a path that has already committed a sever.
  const parsed = enqueueNotificationSchema.parse(input);

  assert.equal(parsed.churchId, CHURCH);
  assert.equal(parsed.recipientUserId, PLANTER);
  assert.equal(parsed.type, ASSOCIATION_REMOVED_TYPE);
  // No entity reference: `notificationEntityTypes` has no member for an
  // association, and a half-reference is refused by the schema anyway.
  assert.equal(parsed.entityType, undefined);
  assert.equal(parsed.entityId, undefined);
});

test("the message names the org and says what did NOT change", () => {
  const input = composeRemovedFromOrg(
    { ...FACTS, orgName: "Grace Sending Church" },
    PLANTER
  );

  assert.match(input.title, /Grace Sending Church/);
  // The org's KIND is in the plant's own words, not the column's.
  assert.match(input.body, /sending church/);
  assert.doesNotMatch(input.body, /sending_church|network_admin/);
  // The two things a planter will otherwise assume: that their data went with
  // the association, and that they can re-join by themselves.
  assert.match(input.body, /untouched/i);
  assert.match(input.body, /invite you back/i);
});

test("a network removal says network, from the same composer", () => {
  const input = composeRemovedFromOrg(
    { ...FACTS, orgType: "network", orgName: "Frontier Network" },
    PLANTER
  );

  assert.match(input.title, /Frontier Network/);
  assert.match(input.body, /this network/);
  assert.doesNotMatch(input.body, /sending church/);
});

test("the dedupe key is per EVENT, so a plant removed twice is told twice", () => {
  const first = composeRemovedFromOrg(
    { ...FACTS, orgName: "Grace Sending Church" },
    PLANTER
  );
  const again = composeRemovedFromOrg(
    {
      ...FACTS,
      orgName: "Grace Sending Church",
      occurrence: "66666666-6666-4666-8666-666666666666",
    },
    PLANTER
  );

  assert.equal(
    first.dedupeKey,
    `${ASSOCIATION_REMOVED_TYPE}:${CHURCH}:${EVENT}`
  );
  assert.notEqual(first.dedupeKey, again.dedupeKey);

  // …and the SAME key for a DIFFERENT recipient: the key is about the event,
  // and `recipient_user_id` is what the unique index adds to it, so a replay of
  // the emitter writes nothing while a genuinely different recipient still gets
  // their own row. Composed for a second id here to assert that the key does
  // not vary by recipient — not because a plant can have two Owners; since
  // migration 0050 it cannot.
  const second = composeRemovedFromOrg(
    { ...FACTS, orgName: "Grace Sending Church" },
    ANOTHER_RECIPIENT
  );
  assert.equal(first.dedupeKey, second.dedupeKey);
});

// ----------------------------------------------------------------------------
// 3. The fan-out never throws into a committed sever
// ----------------------------------------------------------------------------

test("the plant's Owner is told — and there is only ever one", async () => {
  // THIS USED TO FAN OUT TO A LIST, with a second planter in the fixture.
  // Since migration 0050 `users_church_owner_unique_idx` makes a second Owner
  // unwritable, so that fixture described a row the database can no longer
  // hold — and a loop over it was branch coverage for a state that cannot
  // occur. One recipient, asserted as one.
  const fake = deps({
    async plantOwner() {
      return { id: PLANTER };
    },
  });

  const report = await announceRemovedFromOversightOrg(FACTS, fake);

  assert.equal(report.considered, 1);
  assert.equal(report.recorded, 1);
  assert.equal(report.created, 1);
  assert.deepEqual(
    fake.sent.map((input) => input.recipientUserId),
    [PLANTER]
  );
});

test("an org whose name does not resolve announces nothing at all", async () => {
  const fake = deps({
    async resolveOrgName() {
      return null;
    },
  });

  const report = await announceRemovedFromOversightOrg(FACTS, fake);

  // "Someone removed you" cannot be acted on. Silence is the better failure.
  assert.equal(fake.sent.length, 0);
  assert.equal(report.considered, 0);
  assert.equal(report.recorded, 0);
});

test("a plant with no Owner is not an error", async () => {
  // OB-004's `no_planter`, which is a real state and not a failure.
  const fake = deps({
    async plantOwner() {
      return null;
    },
  });

  const report = await announceRemovedFromOversightOrg(FACTS, fake);
  assert.equal(report.considered, 0);
  assert.equal(report.failed, 0);
});

test("a refused recipient is a skip, not a throw", async () => {
  const fake = deps({
    async enqueue() {
      return {
        status: "skipped",
        notification: null,
        created: false,
        reason: "outside_church",
      };
    },
  });

  const report = await announceRemovedFromOversightOrg(FACTS, fake);
  assert.equal(report.skipped, 1);
  assert.equal(report.recorded, 0);
});

test("nothing the notification does can fail the sever it follows", async () => {
  // Three independent failures, each of which runs AFTER the FK has been nulled
  // and the audit row committed. All three must resolve.
  const throwsOnEnqueue = deps({
    async enqueue() {
      throw new Error("provider down");
    },
  });
  const enqueueReport = await announceRemovedFromOversightOrg(
    FACTS,
    throwsOnEnqueue
  );
  assert.equal(enqueueReport.failed, 1);

  const throwsOnRecipients = deps({
    async plantOwner() {
      throw new Error("database down");
    },
  });
  const recipientReport = await announceRemovedFromOversightOrg(
    FACTS,
    throwsOnRecipients
  );
  assert.equal(recipientReport.recorded, 0);

  const throwsOnOrg = deps({
    async resolveOrgName() {
      throw new Error("database down");
    },
  });
  const orgReport = await announceRemovedFromOversightOrg(FACTS, throwsOnOrg);
  assert.equal(orgReport.recorded, 0);
});
