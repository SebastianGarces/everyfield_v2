import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { sourceReader } from "@/lib/testing/source-span";

import { OVERSIGHT_ADMIN } from "./oversight-admin";

import {
  anchorId,
  anchorOfRow,
  churchAnchor,
  orgAnchor,
  toAnchorColumns,
} from "./anchor";
import { enqueueNotificationSchema, recipientAdministersOrg } from "./enqueue";
import { oversightAudienceCondition } from "./oversight";
import {
  notificationFeedQuery,
  orgNotificationFeedQuery,
  orgScopedWhere,
  orgUnreadCountQuery,
  scopedWhere,
  unreadCountQuery,
} from "./queries";

// ============================================================================
// THE NOTIFICATION ANCHOR (#304 WS3, ruling #351, migration 0036).
//
// Until 0036 every notification was about a plant and `church_id` was NOT NULL.
// The events WS3 adds — a sending church accepting, declining or leaving a
// NETWORK's invitation — name no plant, so they were composed and then dropped.
// #351 ruled for a generalized anchor on the ONE table rather than a parallel
// org-notifications table.
//
// Four properties, and they are the whole of why that is safe:
//
//   §1 EXACTLY ONE ANCHOR, and it cannot be composed wrong — the union has no
//      "both" and no "neither" value, and the schema says the same thing in a
//      CHECK.
//   §2 THE TWO TENANCY SPACES DO NOT MEET. Every church-scoped read still names
//      `church_id`; the org read names `anchor_org_id`; neither coalesces. With
//      the CHECK guaranteeing one populated column per row, the two predicates
//      partition the table.
//   §3 THE ORG GATE IS ITS OWN GATE, not `canAccessChurch` with a hole in it.
//   §4 IDEMPOTENCY SURVIVES. A second unique index, on a NON-NULL org column —
//      because NULLs never collide in a btree unique index, so two nullable
//      org columns would have silently turned `dedupeKey` back into a hint.
// ============================================================================

const CHURCH = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const SCHEMA_CODE = readFileSync(
  path.join(process.cwd(), "src/db/schema/notifications.ts"),
  "utf8"
);
const MIGRATION = readFileSync(
  path.join(
    process.cwd(),
    "src/db/migrations/0036_association_subject_and_notification_anchor.sql"
  ),
  "utf8"
);
/** The executable half — the rollback recipe in the header is `--` comments. */
const MIGRATION_STATEMENTS = MIGRATION.replace(/^--.*$/gm, "").trim();
const QUERIES_CODE = readFileSync(
  path.join(process.cwd(), "src/lib/notifications/queries.ts"),
  "utf8"
);

function user(overrides: Partial<User>): User {
  return {
    id: USER,
    role: "network_admin",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    name: null,
    email: "admin@example.test",
    passwordHash: "x",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

// ----------------------------------------------------------------------------
// 1. Exactly one anchor, and the union is what makes it so
// ----------------------------------------------------------------------------

test("the union becomes columns in exactly one place, and always clears the other", () => {
  assert.deepEqual(toAnchorColumns(churchAnchor(CHURCH)), {
    anchorType: "church",
    churchId: CHURCH,
    anchorOrgId: null,
  });
  assert.deepEqual(
    toAnchorColumns(orgAnchor("sending_church", SENDING_CHURCH)),
    {
      anchorType: "sending_church",
      churchId: null,
      anchorOrgId: SENDING_CHURCH,
    }
  );
  assert.deepEqual(toAnchorColumns(orgAnchor("network", NETWORK)), {
    anchorType: "network",
    churchId: null,
    anchorOrgId: NETWORK,
  });

  // …and reading one back off a row is the exact inverse.
  for (const anchor of [
    churchAnchor(CHURCH),
    orgAnchor("sending_church", SENDING_CHURCH),
    orgAnchor("network", NETWORK),
  ]) {
    assert.deepEqual(anchorOfRow(toAnchorColumns(anchor)), anchor);
  }

  // A row that satisfies neither arm cannot come from the database (the CHECK
  // forbids it), so it is reported as "no anchor" rather than guessed at.
  assert.equal(
    anchorOfRow({ anchorType: "church", churchId: null, anchorOrgId: null }),
    null
  );
  assert.equal(
    anchorOfRow({ anchorType: "network", churchId: CHURCH, anchorOrgId: null }),
    null
  );
});

test("enqueue refuses both anchors and neither, at the boundary", () => {
  const base = {
    recipientUserId: USER,
    category: "milestones" as const,
    type: "oversight.milestone.invitation_accepted",
    title: "Title",
    body: "Body",
  };

  assert.ok(
    enqueueNotificationSchema.safeParse({ ...base, churchId: CHURCH }).success
  );
  assert.ok(
    enqueueNotificationSchema.safeParse({
      ...base,
      anchorOrg: { type: "network", orgId: NETWORK },
    }).success
  );

  // Both: a row reachable from two tenants at once, which is the one thing
  // N-010 exists to prevent.
  assert.equal(
    enqueueNotificationSchema.safeParse({
      ...base,
      churchId: CHURCH,
      anchorOrg: { type: "network", orgId: NETWORK },
    }).success,
    false
  );

  // Neither: a row no read path could reach.
  assert.equal(enqueueNotificationSchema.safeParse(base).success, false);

  // An org id with no kind cannot be composed at all — the nested object is
  // what stops "an id, of some sort" reaching the writer.
  assert.equal(
    enqueueNotificationSchema.safeParse({
      ...base,
      anchorOrg: { orgId: NETWORK },
    }).success,
    false
  );
});

test("the schema states exactly-one as a CHECK, not as a convention", () => {
  assert.match(SCHEMA_CODE, /"notifications_anchor_check"/);
  assert.match(SCHEMA_CODE, /"notifications_anchor_type_check"/);
  assert.match(MIGRATION_STATEMENTS, /"notifications_anchor_check"/);

  // The CHECK's two arms, in the migration that actually ran.
  assert.match(
    MIGRATION_STATEMENTS,
    /"anchor_type" = 'church'[\s\S]*?"church_id" is not null[\s\S]*?"anchor_org_id" is null/
  );
  assert.match(
    MIGRATION_STATEMENTS,
    /"anchor_type" in \('sending_church', 'network'\)[\s\S]*?"anchor_org_id" is not null[\s\S]*?"church_id" is null/
  );

  // `church_id` is nullable now, and that is only safe BECAUSE of the CHECK
  // above — so the two are asserted together, never one without the other.
  assert.match(
    MIGRATION_STATEMENTS,
    /ALTER TABLE "notifications" ALTER COLUMN "church_id" DROP NOT NULL/
  );
});

test("the migration is expand-only and no row is rewritten", () => {
  // Two NOT NULL columns WITH A DEFAULT (catalog-only on Postgres 11+), two
  // nullable ones, two NOT NULL constraints dropped. Nothing is backfilled by a
  // statement: every pre-existing row is church-anchored, which is exactly what
  // the default gives it.
  assert.match(
    MIGRATION_STATEMENTS,
    /ADD COLUMN "anchor_type" varchar\(20\) DEFAULT 'church' NOT NULL/
  );
  assert.match(MIGRATION_STATEMENTS, /ADD COLUMN "anchor_org_id" uuid;/);
  // No data statement of any kind — `ON UPDATE no action` on an FK clause is
  // not one, so the match is anchored to a statement start.
  assert.doesNotMatch(MIGRATION_STATEMENTS, /(^|;|\n)\s*UPDATE\s/i);
  assert.doesNotMatch(MIGRATION_STATEMENTS, /(^|;|\n)\s*(INSERT|DELETE)\s/i);
  assert.doesNotMatch(MIGRATION_STATEMENTS, /\bDROP TABLE\b/i);
  assert.doesNotMatch(MIGRATION_STATEMENTS, /\bDROP COLUMN\b/i);

  // The church dedupe index is NOT touched: `dbEnqueueDeps.insertIfAbsent`
  // mirrors its predicate byte for byte and every keyed enqueue rides it.
  assert.doesNotMatch(
    MIGRATION_STATEMENTS,
    /"notifications_dedupe_key_unique_idx"/
  );

  // HR2 — the rollback is written down, in the file, and it deletes the rows
  // that could not have existed before the migration before restoring NOT NULL.
  assert.match(MIGRATION, /ROLLBACK \(HR2\)/);
  assert.match(
    MIGRATION,
    /DELETE FROM "notifications" WHERE "anchor_org_id" IS NOT NULL/
  );
  assert.match(
    MIGRATION,
    /ALTER TABLE "notifications" ALTER COLUMN "church_id" SET NOT NULL/
  );
  assert.match(
    MIGRATION,
    /DO NOT EDIT src\/db\/migrations\/meta\/_journal\.json/
  );
});

// ----------------------------------------------------------------------------
// 2. The two tenancy spaces do not meet
// ----------------------------------------------------------------------------

test("every church-scoped read still names church_id, unchanged", () => {
  const { sql, params } = orgUnreadCountQuery({
    orgId: NETWORK,
    recipientUserId: USER,
  }).toSQL();

  // The ORG read names the ORG column and never the church one…
  assert.match(sql, /"anchor_org_id" = \$\d/);
  assert.doesNotMatch(sql, /"church_id"/);
  assert.ok(params.includes(NETWORK));
  assert.ok(params.includes(USER));

  // …and the CHURCH scope is untouched by this change: both required fields,
  // both in the WHERE, and no mention of the org column.
  const church = scopedWhere({
    churchId: CHURCH,
    recipientUserId: USER,
  }).getSQL();
  const churchSql = orgNotificationFeedQuery({
    orgId: NETWORK,
    recipientUserId: USER,
  }).toSQL();
  assert.ok(church);
  assert.doesNotMatch(churchSql.sql, /"church_id"/);
});

test("neither scope is a coalesce over the two anchor columns", () => {
  // A coalesced predicate would make the two tenancy spaces one namespace, so a
  // plant's feed could contain an org's row. Each read names ONE column, and
  // the CHECK guarantees a row populates exactly one — so the two predicates
  // partition the table.
  const queriesCode = QUERIES_CODE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|\s)\/\/.*$/gm,
    "$1"
  );
  assert.doesNotMatch(queriesCode, /coalesce/i);
  assert.match(
    QUERIES_CODE,
    /eq\(notifications\.anchorOrgId, scope\.orgId\)/,
    "the org scope names anchor_org_id"
  );
  assert.match(
    QUERIES_CODE,
    /eq\(notifications\.churchId, scope\.churchId\)/,
    "the church scope names church_id"
  );

  // Both scopes require a recipient — an optional one fails OPEN precisely
  // where it must fail closed.
  const orgWhere = orgScopedWhere({
    orgId: NETWORK,
    recipientUserId: USER,
  });
  assert.ok(orgWhere);
});

test("the two anchors' reads differ in the BOUNDARY and in nothing else", () => {
  // The other half of "partition the table": the two spaces must not meet, AND
  // the two reads must stay the same read. They were written out twice — same
  // projection, same visibility rules, same keyset predicate, same ordering,
  // same limit clamp, copied — which is how a fix to the church feed silently
  // skips the org one (memory/invariants.md: "the copy is always the one that
  // misses the fix"). They now share one builder, and this pins that: swap the
  // boundary predicate and the two statements are byte-identical.
  const now = new Date("2026-08-12T09:00:00.000Z");
  const options = {
    now,
    unreadOnly: true,
    categories: ["milestones"],
  } as const;

  const church = notificationFeedQuery(
    { churchId: CHURCH, recipientUserId: USER },
    options
  ).toSQL();
  const org = orgNotificationFeedQuery(
    { orgId: NETWORK, recipientUserId: USER },
    options
  ).toSQL();

  assert.equal(
    church.sql.replace(
      '"notifications"."church_id" = $1',
      '"notifications"."anchor_org_id" = $1'
    ),
    org.sql
  );

  const churchCount = unreadCountQuery(
    { churchId: CHURCH, recipientUserId: USER },
    { now }
  ).toSQL();
  const orgCount = orgUnreadCountQuery(
    { orgId: NETWORK, recipientUserId: USER },
    { now }
  ).toSQL();

  assert.equal(
    churchCount.sql.replace(
      '"notifications"."church_id" = $1',
      '"notifications"."anchor_org_id" = $1'
    ),
    orgCount.sql
  );
});

// ----------------------------------------------------------------------------
// 3. The org gate is its own gate
// ----------------------------------------------------------------------------

test("only an oversight admin OF the anchored org may be notified", () => {
  const networkAdmin = user({
    role: "network_admin",
    sendingNetworkId: NETWORK,
  });
  const sendingChurchAdmin = user({
    role: "sending_church_admin",
    sendingChurchId: SENDING_CHURCH,
  });

  assert.equal(
    recipientAdministersOrg(networkAdmin, orgAnchor("network", NETWORK)),
    true
  );
  assert.equal(
    recipientAdministersOrg(
      sendingChurchAdmin,
      orgAnchor("sending_church", SENDING_CHURCH)
    ),
    true
  );

  // ANOTHER org's admin — the whole "an admin of a different org cannot read
  // this one's" rule, at the notification layer.
  assert.equal(
    recipientAdministersOrg(
      user({ role: "network_admin", sendingNetworkId: SENDING_CHURCH }),
      orgAnchor("network", NETWORK)
    ),
    false
  );

  // NOT a hierarchy walk. A network admin does not receive the SENDING CHURCH's
  // own notifications: the row is filed under the sending church, which is a
  // different tenant — the same rule that keeps a plant's rows out of its
  // network's feed.
  assert.equal(
    recipientAdministersOrg(
      networkAdmin,
      orgAnchor("sending_church", SENDING_CHURCH)
    ),
    false
  );

  // A church-level role carrying a stray org FK is not an oversight user, and
  // the role half of the check is what says so.
  assert.equal(
    recipientAdministersOrg(
      user({ role: "team_member", sendingNetworkId: NETWORK }),
      orgAnchor("network", NETWORK)
    ),
    false
  );
  assert.equal(
    recipientAdministersOrg(
      user({ role: "planter", churchId: CHURCH, sendingNetworkId: NETWORK }),
      orgAnchor("network", NETWORK)
    ),
    false
  );
});

test("each anchor kind admits exactly the role that administers it", () => {
  // #304 ruling 4, item 6. "An oversight role" was too coarse. Both org FKs
  // live on the SAME `users` row, so a `network_admin` who also carries a
  // `sending_church_id` — a founder who administers both, or a row where the
  // second FK was set once and never cleared — passed the sending-church arm
  // and received that sending church's own notifications. That is the
  // hierarchy walk the invariant forbids, arriving through the role rather
  // than through the FK.
  const dualFk = user({
    role: "network_admin",
    sendingNetworkId: NETWORK,
    sendingChurchId: SENDING_CHURCH,
  });

  assert.equal(
    recipientAdministersOrg(dualFk, orgAnchor("network", NETWORK)),
    true
  );
  assert.equal(
    recipientAdministersOrg(
      dualFk,
      orgAnchor("sending_church", SENDING_CHURCH)
    ),
    false
  );

  // The mirror image: a sending-church admin carrying a network FK.
  const dualFkOther = user({
    role: "sending_church_admin",
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  });

  assert.equal(
    recipientAdministersOrg(
      dualFkOther,
      orgAnchor("sending_church", SENDING_CHURCH)
    ),
    true
  );
  assert.equal(
    recipientAdministersOrg(dualFkOther, orgAnchor("network", NETWORK)),
    false
  );

  // The whole role × anchor domain, enumerated: for each anchor kind exactly
  // ONE role qualifies, whatever FKs the row carries. A role added to the
  // product later fails this rather than defaulting into an audience.
  const everyRole = [
    "planter",
    "team_member",
    "coach",
    "sending_church_admin",
    "network_admin",
  ] as const;

  for (const role of everyRole) {
    const carriesBoth = user({
      role,
      churchId: CHURCH,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    });

    assert.equal(
      recipientAdministersOrg(
        carriesBoth,
        orgAnchor("sending_church", SENDING_CHURCH)
      ),
      role === "sending_church_admin",
      `sending_church anchor / ${role}`
    );
    assert.equal(
      recipientAdministersOrg(carriesBoth, orgAnchor("network", NETWORK)),
      role === "network_admin",
      `network anchor / ${role}`
    );
  }
});

test("the fan-out asks the same question the per-recipient gate does", () => {
  // Three places decide who administers an org — the audience
  // (`listOversightAdminsOfOrg` / `listOversightRecipientsForChurch`), the
  // digest sweep's "who is still owed a row", and `recipientAdministersOrg`,
  // which vets each recipient at enqueue time. They must not answer
  // differently: an audience WIDER than the gate produces plants that are
  // forever owed a digest nobody can be written (the starvation, asserted as
  // SQL in `oversight-digest.test.ts`), and one NARROWER produces notifications
  // nobody was told about.
  //
  // Asserted on the RENDERED SQL rather than on the source text of the audience
  // function. The previous version of this test sliced `oversight.ts` with a
  // bare `indexOf` on `if (reaches.length === 0)` — the exact rot
  // `src/lib/testing/source-span.ts` documents, one refactor away from
  // `slice(0, -1)` and a module-wide claim that passes by luck.
  const { sql, params } = db
    .select({ id: users.id })
    .from(users)
    .where(
      oversightAudienceCondition(users, {
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: NETWORK,
      })
    )
    .toSQL();

  const normalised = sql.replace(/"/g, "");

  // Each arm pairs the role with ITS OWN FK. Both org FKs live on one `users`
  // row and neither implies the other, so an unpaired `or(fk, fk) and role in
  // (...)` admits a network admin carrying a stray `sending_church_id` into
  // that sending church's audience — the hierarchy walk memory/invariants.md
  // forbids, arriving through the role instead of through the FK.
  assert.match(
    normalised,
    /users\.role = \$\d+ and users\.sending_church_id = \$\d+/
  );
  assert.match(
    normalised,
    /users\.role = \$\d+ and users\.sending_network_id = \$\d+/
  );

  // The bound values say which role went with which FK — and they are the whole
  // parameter list, so an arm cannot carry a role predicate the pairing above
  // did not pair.
  assert.deepEqual(params, [
    "sending_church_admin",
    SENDING_CHURCH,
    "network_admin",
    NETWORK,
  ]);

  // …and BOTH encodings read that pairing off one table. The SQL arms bind
  // whatever `OVERSIGHT_ADMIN` says, and `recipientAdministersOrg` accepts
  // exactly the role for the anchor's kind and no other — so the audience and
  // the gate cannot drift, which is the drift that starved a plant.
  assert.deepEqual(params, [
    OVERSIGHT_ADMIN.sending_church.role,
    SENDING_CHURCH,
    OVERSIGHT_ADMIN.network.role,
    NETWORK,
  ]);

  for (const [orgType, orgId] of [
    ["sending_church", SENDING_CHURCH],
    ["network", NETWORK],
  ] as const) {
    const admin = user({
      role: OVERSIGHT_ADMIN[orgType].role,
      churchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    });

    assert.equal(
      recipientAdministersOrg(admin, orgAnchor(orgType, orgId)),
      true,
      `${orgType}: the gate admits the role the audience binds`
    );
  }
});

test("an org-anchored notification that is not consent-exempt is refused", () => {
  // Fail-closed floor. There is no plant whose `share_activity_with_oversight`
  // could be read for an org-anchored row, so a category that REQUIRES sharing
  // has no honest answer and gets the refusing one. Today only the three
  // own-relationship milestones are org-anchored, so this is a floor rather
  // than a live path — asserted on the source, since the gate is inside the
  // production dep.
  const enqueueCode = readFileSync(
    path.join(process.cwd(), "src/lib/notifications/enqueue.ts"),
    "utf8"
  );
  // Through the reader, not a bare `indexOf`: a moved anchor THROWS instead of
  // returning -1 and turning the three `doesNotMatch` assertions below into
  // claims about almost the whole module (`src/lib/testing/source-span.ts`).
  const orgArm = sourceReader(enqueueCode, "enqueue.ts").span(
    'if (anchor.type !== "church") {',
    "const churchId = anchor.churchId;"
  );

  assert.match(orgArm, /recipientAdministersOrg\(recipient, anchor\)/);
  assert.match(orgArm, /gate !== "exempt"/);
  // The org arm never consults the plant-shaped questions, because none of them
  // has a plant to be about.
  assert.doesNotMatch(orgArm, /canAccessChurch/);
  assert.doesNotMatch(orgArm, /canAccessFeatureData/);
  assert.doesNotMatch(orgArm, /orgHasRecordedRelationshipWithChurch/);
});

// ----------------------------------------------------------------------------
// 4. Idempotency survives the new anchor
// ----------------------------------------------------------------------------

test("org-anchored dedupe has an index of its own, on a NON-NULL column", () => {
  // The reason `anchor_org_id` is ONE column and not two nullable FKs: a NULL
  // in a btree unique index never collides, so an index over two per-kind
  // columns would let every org-anchored `dedupeKey` write a second row.
  assert.match(
    MIGRATION_STATEMENTS,
    /CREATE UNIQUE INDEX "notifications_org_dedupe_key_unique_idx" ON "notifications" USING btree \("anchor_org_id","recipient_user_id","dedupe_key"\)/
  );
  assert.match(
    MIGRATION_STATEMENTS,
    /WHERE "notifications"\."anchor_org_id" is not null and "notifications"\."dedupe_key" is not null and "notifications"\."status" <> 'cancelled'/
  );
  assert.doesNotMatch(
    SCHEMA_CODE,
    /sendingChurchId: uuid\("sending_church_id"\)/
  );
});

test("the dedupe key carries the ANCHOR's id, so the two spaces cannot collide", () => {
  // `composeMilestone` keys `<type>:<anchorId>:<occurrence>`. Using a church id
  // there for an org-anchored row would put two tenants' events in one key
  // space — and the occurrence (an invitation id) is shared between the plant
  // and the org sides of the same handshake.
  assert.equal(anchorId(churchAnchor(CHURCH)), CHURCH);
  assert.equal(anchorId(orgAnchor("network", NETWORK)), NETWORK);

  const oversightCode = readFileSync(
    path.join(process.cwd(), "src/lib/notifications/oversight.ts"),
    "utf8"
  );
  assert.match(
    oversightCode,
    /dedupeKey: `\$\{oversightMilestoneType\(facts\.kind\)\}:\$\{anchorId\(facts\.anchor\)\}/
  );
});
