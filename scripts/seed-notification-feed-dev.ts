/**
 * SEED THE OVERSIGHT NOTIFICATION FEED (N-027, #308) — development only.
 *
 * What it exists for. The oversight feed's whole contract is about rows a
 * reader must and must not see, and none of it is observable without rows: a
 * consent-governed digest for a plant that has opted in (visible), the same
 * shape for a plant that has NOT (invisible, in the list AND by direct id), an
 * org's own relationship milestone (visible whatever the toggle says), and an
 * org-anchored row (visible). It also seeds well past one page, because the
 * Lighthouse audit #308 owes is on a PAGED feed and a three-row list would
 * audit a screen nobody has.
 *
 * Why a script and not a hand-run of INSERTs: a reviewer has to be able to
 * re-create the fixture and re-run the audit, and the ids it prints are what
 * the by-id probe fetches. Re-runnable — it deletes its own rows (every one
 * carries a `dedupe_key` starting `dev-308:`) before writing them again, so a
 * second run converges rather than doubling the feed.
 *
 * SCOPE FENCE. It only ever writes: two fixture plants per oversight org (named
 * with the `NOTIF-308` prefix, matched by name so a re-run adopts its own), a
 * `church_privacy_settings` row for each, and notifications keyed `dev-308:`.
 * It deletes nothing else — `pnpm db:seed`'s wipe is a different tool with a
 * different blast radius. Point DATABASE_URL at the development branch a
 * preview reads, never at production.
 *
 * `--clean` is the same fence run backwards, and it is why this file is
 * committed rather than thrown away. The database a preview reads is SHARED, so
 * a fixture that can only be created is a mess somebody else inherits: `--clean`
 * removes exactly the three things listed above and reports what is left, so the
 * next agent to validate this feed starts from the state the last one found.
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-notification-feed-dev.ts
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-notification-feed-dev.ts --clean
 */
import { and, eq, inArray, like } from "drizzle-orm";

import { db } from "@/db";
import {
  churchPrivacySettings,
  churches,
  notifications,
  persons,
  users,
  type NotificationCategory,
} from "@/db/schema";
import {
  oversightOrgOf,
  type OversightOrg,
  type TenancyFields,
} from "@/lib/auth/tenancy";
import { OVERSIGHT_SHARING_EXEMPT_TYPES } from "@/lib/notifications/categories";

/** The two seeded oversight accounts, one per kind of org. */
const ORG_ADMINS = [
  "admin@everyfield.app",
  "sending-church-admin@everyfield.app",
] as const;

/** Everything this script writes carries it, and everything it deletes matches it. */
const FIXTURE_KEY = "dev-308:";

/**
 * Enough rows that the feed pages — the audit is on a paged screen.
 *
 * `UNREAD_SHARING_ROWS` is over thirty for the same reason: #308 owes a
 * Lighthouse audit on `/notifications` AND on `?filter=unread`, and the unread
 * tab is a DIFFERENT list. Leaving six rows unread audited a short screen on
 * one of the two URLs the acceptance criterion names. The rest arrive read, so
 * the All tab still shows both states.
 */
const SHARING_ROWS = 40;
const UNREAD_SHARING_ROWS = 34;

const MINUTE = 60_000;

type SeededOrg = {
  email: string;
  /** The account row, as `notificationViewer` reads it — never a hand-built scope. */
  account: { id: string } & TenancyFields;
  org: OversightOrg;
  sharingChurchId: string;
  quietChurchId: string;
  hiddenNotificationId: string;
  exemptNotificationId: string;
};

/** The column on `churches` that files a plant under this kind of org. */
function orgColumn(org: OversightOrg) {
  return org.type === "network"
    ? churches.sendingNetworkId
    : churches.sendingChurchId;
}

/**
 * A fixture plant under this org, adopted by name if it is already there.
 *
 * Matched on (name, org column) rather than on a fixed uuid so the script can
 * run against a database it did not create, and `onboarding_completed_at` is
 * stamped in the same INSERT — memory/invariants.md → Dev Seeds: an unstamped
 * seeded church puts its planter in the onboarding wizard.
 */
async function fixturePlant(org: OversightOrg, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: churches.id })
    .from(churches)
    .where(and(eq(churches.name, name), eq(orgColumn(org), org.id)))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(churches)
    .values({
      name,
      onboardingCompletedAt: new Date(),
      ...(org.type === "network"
        ? { sendingNetworkId: org.id }
        : { sendingChurchId: org.id }),
    })
    .returning({ id: churches.id });

  if (!created) throw new Error(`could not create the fixture plant ${name}`);
  return created.id;
}

/** The plant's consent, upserted — absence and `false` mean the same thing. */
async function setSharing(churchId: string, enabled: boolean) {
  await db
    .insert(churchPrivacySettings)
    .values({ churchId, shareActivityWithOversight: enabled })
    .onConflictDoUpdate({
      target: churchPrivacySettings.churchId,
      set: { shareActivityWithOversight: enabled, updatedAt: new Date() },
    });
}

async function seedFor(email: string): Promise<SeededOrg> {
  const [account] = await db
    .select({
      id: users.id,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
      sendingNetworkId: users.sendingNetworkId,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!account) {
    throw new Error(
      `${email} is not in this database — run scripts/seed-dev-db.ts --oversight-orgs-only first`
    );
  }

  const org = oversightOrgOf(account);
  if (!org) throw new Error(`${email} names no single oversight tenancy`);

  const label = org.type === "network" ? "Network" : "Sending Church";
  const sharingChurchId = await fixturePlant(
    org,
    `NOTIF-308 Sharing Plant (${label})`
  );
  const quietChurchId = await fixturePlant(
    org,
    `NOTIF-308 Quiet Plant (${label})`
  );

  await setSharing(sharingChurchId, true);
  await setSharing(quietChurchId, false);

  // Re-runnable: this script's own rows go before this script's own rows are
  // written, so a second run converges on the same feed instead of doubling it.
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, account.id),
        like(notifications.dedupeKey, `${FIXTURE_KEY}%`)
      )
    );

  const now = Date.now();
  const rows: (typeof notifications.$inferInsert)[] = [];

  // 1. The consent-governed rows for the plant that OPTED IN — the feed itself.
  for (let index = 0; index < SHARING_ROWS; index += 1) {
    const category: NotificationCategory =
      index % 4 === 0 ? "milestones" : "digest";
    rows.push({
      anchorType: "church",
      churchId: sharingChurchId,
      recipientUserId: account.id,
      category,
      type:
        category === "milestones"
          ? "oversight.milestone.phase_advanced"
          : "oversight.digest.daily",
      title:
        category === "milestones"
          ? `Sharing Plant reached a new stage (#${index + 1})`
          : `Sharing Plant — daily summary (#${index + 1})`,
      body: "Seeded by scripts/seed-notification-feed-dev.ts for the #308 oversight feed.",
      // Newest first, one minute apart, so the keyset cursor has a total order
      // and the pages are stable between runs.
      scheduledFor: new Date(now - (index + 1) * MINUTE),
      createdAt: new Date(now - (index + 1) * MINUTE),
      // The first `UNREAD_SHARING_ROWS` stay UNREAD, so the badge has a number,
      // mark-read has something to clear and the unread tab is long enough to
      // audit; the rest arrive read so both states are on the All tab.
      readAt:
        index < UNREAD_SHARING_ROWS ? null : new Date(now - index * MINUTE),
      dedupeKey: `${FIXTURE_KEY}sharing:${index}`,
      status: "delivered",
    });
  }

  // 2. The consent-governed row for the plant that did NOT opt in. It exists in
  //    the table and must never reach this reader — not in the list, not in the
  //    count, and not by its own id.
  rows.push({
    anchorType: "church",
    churchId: quietChurchId,
    recipientUserId: account.id,
    category: "digest",
    type: "oversight.digest.daily",
    title: "Quiet Plant — daily summary (MUST NOT BE VISIBLE)",
    body: "This plant has share_activity_with_oversight OFF. Seeing this row is the bug.",
    scheduledFor: new Date(now - 90 * MINUTE),
    createdAt: new Date(now - 90 * MINUTE),
    readAt: null,
    dedupeKey: `${FIXTURE_KEY}hidden`,
    status: "delivered",
  });

  // 3. The org's OWN relationship event about that same non-sharing plant.
  //    Consent-exempt (ruled 2026-08-01, extended by #304), so it IS visible —
  //    the arm that keeps "they accepted your invitation" from being written
  //    and never shown.
  rows.push({
    anchorType: "church",
    churchId: quietChurchId,
    recipientUserId: account.id,
    category: "milestones",
    type: OVERSIGHT_SHARING_EXEMPT_TYPES[0],
    title: "Quiet Plant accepted your invitation (consent-exempt, visible)",
    body: "Your own relationship changing is not the plant's to withhold.",
    scheduledFor: new Date(now - 91 * MINUTE),
    createdAt: new Date(now - 91 * MINUTE),
    readAt: null,
    dedupeKey: `${FIXTURE_KEY}exempt`,
    status: "delivered",
  });

  // 4. An ORG-ANCHORED row — no plant at all. Write-only in-app until #308.
  rows.push({
    anchorType: org.type,
    anchorOrgId: org.id,
    recipientUserId: account.id,
    category: "milestones",
    type: "oversight.milestone.association_ended",
    title: "Your organization's own record (org-anchored, visible)",
    body: "Filed under anchor_org_id because it names no plant.",
    scheduledFor: new Date(now - 92 * MINUTE),
    createdAt: new Date(now - 92 * MINUTE),
    readAt: null,
    dedupeKey: `${FIXTURE_KEY}org`,
    status: "delivered",
  });

  const written = await db
    .insert(notifications)
    .values(rows)
    .returning({ id: notifications.id, dedupeKey: notifications.dedupeKey });

  const idOf = (suffix: string) => {
    const row = written.find((r) => r.dedupeKey === `${FIXTURE_KEY}${suffix}`);
    if (!row) throw new Error(`the ${suffix} row was not written`);
    return row.id;
  };

  return {
    email,
    account,
    org,
    sharingChurchId,
    quietChurchId,
    hiddenNotificationId: idOf("hidden"),
    exemptNotificationId: idOf("exempt"),
  };
}

/**
 * What the reads actually answer, run here rather than trusted — the backend
 * half of the validation.
 *
 * The viewer is MINTED, not assembled: `notificationViewer` is the same
 * function the page and the layout call, so what this reports is the boundary a
 * real request gets. A hand-built scope would prove the query and skip the
 * thing most likely to be wrong — which tenancy the session resolves to.
 */
async function report(seeded: SeededOrg) {
  const {
    loadNotificationFeedScreen,
    loadUnreadBadgeCount,
    notificationViewer,
  } = await import("@/lib/notifications/feed");
  const { getNotificationById } = await import("@/lib/notifications/queries");

  const viewer = notificationViewer({ user: seeded.account });
  if (!viewer) throw new Error(`${seeded.email} minted no viewer`);

  const screen = await loadNotificationFeedScreen(viewer, { limit: 30 });
  const badge = await loadUnreadBadgeCount(viewer);
  const hidden = await getNotificationById(
    viewer.scope,
    seeded.hiddenNotificationId
  );
  const exempt = await getNotificationById(
    viewer.scope,
    seeded.exemptNotificationId
  );

  console.log(`\n=== ${seeded.email} (${seeded.org.type} ${seeded.org.id})`);
  console.log(`  sharing plant : ${seeded.sharingChurchId} (opted in)`);
  console.log(`  quiet plant   : ${seeded.quietChurchId} (NOT opted in)`);
  console.log(
    `  page rows     : ${screen.rows.length} (next cursor: ${screen.nextCursor ? "yes" : "none"})`
  );
  console.log(`  unread badge  : ${badge}`);
  console.log(`  hasAny        : ${screen.hasAny}`);
  console.log(
    `  hidden row by direct id -> ${hidden === null ? "null (correct)" : "VISIBLE — BUG"} [${seeded.hiddenNotificationId}]`
  );
  console.log(
    `  exempt row by direct id -> ${exempt ? "visible (correct)" : "NULL — BUG"} [${seeded.exemptNotificationId}]`
  );
  console.log(
    `  quiet-plant rows on the page: ${
      screen.rows.filter((row) => row.title.includes("MUST NOT BE VISIBLE"))
        .length
    } (must be 0)`
  );
}

/** The fixture plants this script owns, found the way it finds them. */
const FIXTURE_PLANT_NAME = "NOTIF-308 %";

// ----------------------------------------------------------------------------
// `--click-race`: the fixture #228 needs, which the oversight fixture cannot be
//
// #228 reports that a feed row's click sometimes marks read and does not
// navigate. Reproducing that needs rows that LINK somewhere, and the oversight
// rows above deliberately do not: they name no entity, so `notificationEntityHref`
// returns null and the row renders as plain text with no anchor to click.
//
// So this mode seeds for a PLANT account instead — the reader #228 was observed
// with — and points each row at a real person in that planter's own church, so
// the destination is a page that exists and the assertion "did the URL change"
// has one right answer. Same `dev-308:` key, so `--clean` takes these too.
// ----------------------------------------------------------------------------

/** The plant account the click-race rows are seeded for. */
const CLICK_RACE_EMAIL = "planter-dayspring@eval.phase-engine.everyfield.app";

/** One click per row, and the AC asks for at least twenty. */
const CLICK_RACE_ROWS = 25;

async function seedClickRace() {
  const [account] = await db
    .select({ id: users.id, churchId: users.churchId })
    .from(users)
    .where(eq(users.email, CLICK_RACE_EMAIL))
    .limit(1);

  if (!account?.churchId) {
    throw new Error(`${CLICK_RACE_EMAIL} has no church in this database`);
  }

  const people = await db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.churchId, account.churchId))
    .limit(CLICK_RACE_ROWS);

  if (people.length === 0) {
    throw new Error(`${CLICK_RACE_EMAIL}'s church has no people to link to`);
  }

  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, account.id),
        like(notifications.dedupeKey, `${FIXTURE_KEY}%`)
      )
    );

  const now = Date.now();

  await db.insert(notifications).values(
    Array.from({ length: CLICK_RACE_ROWS }, (_, index) => ({
      anchorType: "church" as const,
      churchId: account.churchId!,
      recipientUserId: account.id,
      category: "milestones" as NotificationCategory,
      type: "person.first_timer.recorded",
      entityType: "person" as const,
      entityId: people[index % people.length]!.id,
      title: `Click-race row #${index + 1}`,
      body: "Seeded by scripts/seed-notification-feed-dev.ts --click-race (#228).",
      scheduledFor: new Date(now - (index + 1) * MINUTE),
      createdAt: new Date(now - (index + 1) * MINUTE),
      readAt: null,
      dedupeKey: `${FIXTURE_KEY}click:${index}`,
      status: "delivered" as const,
    }))
  );

  console.log(
    `seeded ${CLICK_RACE_ROWS} linked unread rows for ${CLICK_RACE_EMAIL} (church ${account.churchId})`
  );
}

/**
 * Remove everything this script writes, and prove it removed it.
 *
 * Ordered by the FKs: the notifications reference the plants, and the privacy
 * row references the plant too, so the churches go last. Every predicate is the
 * same one the seed writes under — a `dedupe_key` prefix and a name prefix —
 * so this cannot reach a row it did not create.
 */
async function clean() {
  const plants = await db
    .select({ id: churches.id, name: churches.name })
    .from(churches)
    .where(like(churches.name, FIXTURE_PLANT_NAME));

  const removedNotifications = await db
    .delete(notifications)
    .where(like(notifications.dedupeKey, `${FIXTURE_KEY}%`))
    .returning({ id: notifications.id });

  const plantIds = plants.map((plant) => plant.id);

  if (plantIds.length > 0) {
    await db
      .delete(churchPrivacySettings)
      .where(inArray(churchPrivacySettings.churchId, plantIds));
    await db.delete(churches).where(inArray(churches.id, plantIds));
  }

  // Read back rather than trust the deletes: the point of this mode is that the
  // next reader of this database finds nothing, so it asserts nothing.
  const strayRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(like(notifications.dedupeKey, `${FIXTURE_KEY}%`));
  const strayPlants = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, FIXTURE_PLANT_NAME));

  console.log(`removed notifications: ${removedNotifications.length}`);
  console.log(`removed plants       : ${plantIds.length}`, plants);
  console.log(
    `left behind          : ${strayRows.length} rows, ${strayPlants.length} plants (both must be 0)`
  );

  if (strayRows.length > 0 || strayPlants.length > 0) {
    throw new Error("the fixture did not come out clean");
  }
}

async function main() {
  if (process.argv.includes("--clean")) {
    await clean();
    return;
  }

  if (process.argv.includes("--click-race")) {
    await seedClickRace();
    return;
  }

  const seeded: SeededOrg[] = [];
  for (const email of ORG_ADMINS) {
    seeded.push(await seedFor(email));
  }

  for (const one of seeded) {
    await report(one);
  }

  // The plants this script created, so a reader can find them in the UI.
  const fixturePlants = await db
    .select({ id: churches.id, name: churches.name })
    .from(churches)
    .where(
      inArray(
        churches.id,
        seeded.flatMap((one) => [one.sharingChurchId, one.quietChurchId])
      )
    );
  console.log("\nfixture plants:", fixturePlants);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
