/**
 * G3 harness for the oversight notification model (issue #224, FRD N-025 +
 * N-026) — real database, scratch database only.
 *
 * Runs the SHIPPED functions — `enqueue`, the three milestone emitters, the
 * daily digest and the sharing toggle's reader/writer — against a Postgres that
 * has had every migration applied by `pnpm db:migrate`. Nothing is faked. The
 * unit tests cover the logic; this covers what the database actually does with
 * it, including the migration's own effect (the new column exists at false for
 * every church, and the two columns it replaced are gone).
 *
 * NEVER point it at a real database: it seeds churches and users and leaves
 * them behind. Create a scratch one first.
 *
 *   psql "$DATABASE_URL" -c 'create database scratch_oversight'
 *   export DATABASE_URL="<same url, /scratch_oversight>"
 *   pnpm db:migrate
 *   pnpm exec tsx scripts/g3-oversight-model.ts
 *   psql "<original url>" -c 'drop database scratch_oversight'
 */
import assert from "node:assert/strict";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchPrivacySettings,
  notifications,
  organizationInvitations,
  sendingNetworks,
  users,
} from "@/db/schema";
import { canAccessChurch } from "@/lib/auth/access";
import { setChurchLaunchDate } from "@/lib/churches/launch-date";
import { acceptInvitation, createInvitation } from "@/lib/invitations/service";
import { notificationCategories } from "@/lib/notifications/categories";
import { enqueue } from "@/lib/notifications/enqueue";
import { runDailyOversightDigest } from "@/lib/notifications/oversight-digest";
import { handlePhaseChangedForOversight } from "@/lib/notifications/oversight-events";
import {
  isSharingActivityWithOversight,
  setSharingActivityWithOversight,
} from "@/lib/notifications/oversight-sharing";
import { persons } from "@/db/schema";

function ok(label: string) {
  console.log(`PASS  ${label}`);
}

const GRANULAR = notificationCategories.filter(
  (category) => category !== "milestones" && category !== "digest"
);

async function rowsFor(churchId: string) {
  return db
    .select({
      id: notifications.id,
      category: notifications.category,
      type: notifications.type,
      recipientUserId: notifications.recipientUserId,
      body: notifications.body,
    })
    .from(notifications)
    .where(eq(notifications.churchId, churchId));
}

async function main() {
  const stamp = Date.now();

  // --------------------------------------------------------------------------
  // Seed: a network, a plant beneath it, its planter, and two oversight admins.
  // --------------------------------------------------------------------------
  const [network] = await db
    .insert(sendingNetworks)
    .values({ name: "Scratch Network" })
    .returning();

  const [plant] = await db
    .insert(churches)
    .values({ name: "Scratch Plant", sendingNetworkId: network.id })
    .returning();

  const [planter] = await db
    .insert(users)
    .values({
      email: `planter-${stamp}@example.test`,
      passwordHash: "x",
      role: "planter",
      churchId: plant.id,
    })
    .returning();

  const [adminA, adminB] = await db
    .insert(users)
    .values([
      {
        email: `admin-a-${stamp}@example.test`,
        passwordHash: "x",
        role: "network_admin" as const,
        sendingNetworkId: network.id,
      },
      {
        email: `admin-b-${stamp}@example.test`,
        passwordHash: "x",
        role: "network_admin" as const,
        sendingNetworkId: network.id,
      },
    ])
    .returning();

  // The plant's settings row, exactly as church creation writes it.
  await db.insert(churchPrivacySettings).values({
    churchId: plant.id,
    updatedBy: planter.id,
  });

  // --------------------------------------------------------------------------
  // 1. MIGRATION — the single toggle exists, defaults to false for everyone,
  //    and the two per-category columns it replaced are gone.
  // --------------------------------------------------------------------------
  const columns = await db.execute<{ column_name: string }>(sql`
    select column_name from information_schema.columns
    where table_name = 'church_privacy_settings'
  `);
  const columnNames = (columns.rows ?? columns).map(
    (row: { column_name: string }) => row.column_name
  );
  assert.ok(
    columnNames.includes("share_activity_with_oversight"),
    "0028 did not add share_activity_with_oversight"
  );
  assert.ok(!columnNames.includes("share_phase"), "share_phase survived 0028");
  assert.ok(
    !columnNames.includes("share_digest"),
    "share_digest survived 0028"
  );
  ok("0028 replaced the per-category oversight toggles with one column");

  // Read back through the shipped reader — every church starts at OFF, which is
  // the substance of the ruling, not a detail of the DDL.
  assert.equal(await isSharingActivityWithOversight(plant.id), false);
  const [defaults] = await db
    .select({ enabled: churchPrivacySettings.shareActivityWithOversight })
    .from(churchPrivacySettings)
    .where(eq(churchPrivacySettings.churchId, plant.id));
  assert.equal(defaults.enabled, false);
  ok("the migrated setting reads back as OFF for an existing church");

  // The `milestones` category is accepted by the widened CHECK constraint.
  assert.ok(notificationCategories.includes("milestones"));

  // --------------------------------------------------------------------------
  // 2. GRANULAR CATEGORIES — never enqueued to oversight, toggle either way.
  // --------------------------------------------------------------------------
  assert.equal(await canAccessChurch(adminA, plant.id), true);

  for (const sharing of [false, true]) {
    await setSharingActivityWithOversight({
      churchId: plant.id,
      enabled: sharing,
      updatedBy: planter.id,
    });

    for (const category of GRANULAR) {
      const result = await enqueue({
        churchId: plant.id,
        recipientUserId: adminA.id,
        category,
        type: `${category}.update`,
        title: "Something happened",
        body: "No contact in 30 days: Jane Doe, 555-1234.",
      });
      assert.equal(
        result.status,
        "skipped",
        `${category} with sharing=${sharing}`
      );
      assert.equal(result.reason, "oversight_privacy");
    }
  }

  const afterGranular = await rowsFor(plant.id);
  assert.equal(
    afterGranular.length,
    0,
    "a granular category reached an oversight recipient"
  );
  ok("no granular category is ever enqueued to oversight, sharing on or off");

  // The plant's own team is unaffected — N-025 narrows what LEAVES the plant.
  const forPlanter = await enqueue({
    churchId: plant.id,
    recipientUserId: planter.id,
    category: "tasks",
    type: "task.overdue",
    title: "Book the venue is overdue",
    body: "It was due yesterday.",
  });
  assert.equal(forPlanter.status, "recorded");
  ok("the plant's own team still receives the per-event stream");

  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 3. MILESTONE 1 — the planter accepted an invitation.
  // --------------------------------------------------------------------------
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: false,
    updatedBy: planter.id,
  });

  const invitationOff = await createInvitation({
    type: "church_to_network",
    inviterUserId: adminA.id,
    targetChurchId: plant.id,
    sendingNetworkId: network.id,
  });
  await acceptInvitation(invitationOff.id, planter);
  assert.equal(
    (await rowsFor(plant.id)).length,
    0,
    "an invitation milestone leaked with sharing off"
  );
  ok("invitation accepted, sharing OFF → nothing enqueued");

  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: true,
    updatedBy: planter.id,
  });

  const invitationOn = await createInvitation({
    type: "church_to_network",
    inviterUserId: adminA.id,
    targetChurchId: plant.id,
    sendingNetworkId: network.id,
  });
  await acceptInvitation(invitationOn.id, planter);

  const afterInvitation = await rowsFor(plant.id);
  assert.equal(afterInvitation.length, 2, "one row per oversight admin");
  assert.ok(afterInvitation.every((row) => row.category === "milestones"));
  assert.ok(
    afterInvitation.every(
      (row) => row.type === "oversight.milestone.invitation_accepted"
    )
  );
  assert.deepEqual(
    afterInvitation.map((row) => row.recipientUserId).sort(),
    [adminA.id, adminB.id].sort()
  );
  ok("invitation accepted, sharing ON → one milestone per oversight admin");

  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 4. MILESTONE 2 — the plant advanced a stage.
  // --------------------------------------------------------------------------
  const phaseEvent = {
    type: "phase.changed" as const,
    churchId: plant.id,
    fromPhase: 1,
    toPhase: 2,
    initiatedById: planter.id,
    rubricVersion: "v0",
    timestamp: new Date(),
  };

  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: false,
    updatedBy: planter.id,
  });
  await handlePhaseChangedForOversight(phaseEvent);
  assert.equal((await rowsFor(plant.id)).length, 0);
  ok("phase advanced, sharing OFF → nothing enqueued");

  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: true,
    updatedBy: planter.id,
  });
  await handlePhaseChangedForOversight(phaseEvent);
  const afterPhase = await rowsFor(plant.id);
  assert.equal(afterPhase.length, 2);
  assert.ok(
    afterPhase.every((row) => row.type === "oversight.milestone.phase_advanced")
  );
  ok("phase advanced, sharing ON → one milestone per oversight admin");

  // A regression is a correction, not an event to report outward.
  await handlePhaseChangedForOversight({
    ...phaseEvent,
    fromPhase: 2,
    toPhase: 1,
  });
  assert.equal(
    (await rowsFor(plant.id)).length,
    2,
    "a regression was reported"
  );
  ok("a phase REGRESSION is never announced");

  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 5. MILESTONE 3 — a launch date was set or changed.
  // --------------------------------------------------------------------------
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: false,
    updatedBy: planter.id,
  });
  assert.equal(
    (await setChurchLaunchDate(plant.id, "2026-09-13")).status,
    "changed"
  );
  assert.equal((await rowsFor(plant.id)).length, 0);
  ok("launch date set, sharing OFF → nothing enqueued");

  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: true,
    updatedBy: planter.id,
  });
  assert.equal(
    (await setChurchLaunchDate(plant.id, "2026-10-04")).status,
    "changed"
  );
  const afterLaunch = await rowsFor(plant.id);
  assert.equal(afterLaunch.length, 2);
  assert.ok(
    afterLaunch.every(
      (row) => row.type === "oversight.milestone.launch_date_changed"
    )
  );
  ok("launch date changed, sharing ON → one milestone per oversight admin");

  // Re-saving the same date is not a milestone, and writes nothing.
  const resave = await setChurchLaunchDate(plant.id, "2026-10-04");
  assert.equal(resave.status, "unchanged");
  assert.equal((await rowsFor(plant.id)).length, 2);
  ok("re-saving the same launch date announces nothing");

  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 6. THE DIGEST — one per recipient on a day with activity, none on a quiet
  //    day. The count assertion is on ROWS WRITTEN, both days.
  // --------------------------------------------------------------------------
  const quietDay = new Date("2026-06-01T12:00:00.000Z");
  const busyDay = new Date("2026-06-02T12:00:00.000Z");

  const quiet = await runDailyOversightDigest(plant.id, quietDay);
  assert.equal(quiet.status, "skipped");
  assert.equal(quiet.status === "skipped" && quiet.reason, "no_activity");
  assert.equal(
    (await rowsFor(plant.id)).length,
    0,
    "a quiet day sent a digest"
  );
  ok("a day with NO activity produces no digest row at all");

  // One person added, dated into the busy day.
  await db.insert(persons).values({
    churchId: plant.id,
    createdBy: planter.id,
    firstName: "Sam",
    lastName: "Rivera",
    createdAt: new Date("2026-06-02T09:00:00.000Z"),
  });

  const busy = await runDailyOversightDigest(plant.id, busyDay);
  assert.equal(busy.status, "enqueued");
  const digestRows = await rowsFor(plant.id);
  assert.equal(digestRows.length, 2, "one digest per oversight recipient");
  assert.ok(digestRows.every((row) => row.category === "digest"));
  assert.ok(
    digestRows.every((row) => row.type === "oversight.activity.digest")
  );
  // Counts, never contents: the seeded person's name must not be in the body.
  assert.ok(
    digestRows.every((row) => !row.body.includes("Sam")),
    "the digest carried a person's name"
  );
  ok("a day WITH activity produces exactly one digest per oversight recipient");

  // Running it again the same day is idempotent — the dedupe key is (church,
  // day), arbitrated by the partial unique index, not by memory.
  await runDailyOversightDigest(plant.id, busyDay);
  assert.equal((await rowsFor(plant.id)).length, 2);
  ok("a second run on the same day writes nothing further");

  // --------------------------------------------------------------------------
  // 7. THE TOGGLE TAKES EFFECT AT THE NEXT ENQUEUE.
  // --------------------------------------------------------------------------
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: false,
    updatedBy: planter.id,
  });

  const laterDay = new Date("2026-06-03T12:00:00.000Z");
  await db.insert(persons).values({
    churchId: plant.id,
    createdBy: planter.id,
    firstName: "Dana",
    lastName: "Okafor",
    createdAt: new Date("2026-06-03T09:00:00.000Z"),
  });

  await runDailyOversightDigest(plant.id, laterDay);
  assert.equal((await rowsFor(plant.id)).length, 0);

  // Flip it — no deploy, no cache to clear, no job to restart.
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: true,
    updatedBy: planter.id,
  });
  assert.equal(await isSharingActivityWithOversight(plant.id), true);

  await runDailyOversightDigest(plant.id, laterDay);
  assert.equal((await rowsFor(plant.id)).length, 2);

  // ...and back off again, for the day after.
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: false,
    updatedBy: planter.id,
  });
  const lastDay = new Date("2026-06-04T12:00:00.000Z");
  await db.insert(persons).values({
    churchId: plant.id,
    createdBy: planter.id,
    firstName: "Ada",
    lastName: "Nwosu",
    createdAt: new Date("2026-06-04T09:00:00.000Z"),
  });
  await runDailyOversightDigest(plant.id, lastDay);
  assert.equal((await rowsFor(plant.id)).length, 2, "the flip-off was ignored");
  ok("a toggle flip is honoured by the very next enqueue, both directions");

  // --------------------------------------------------------------------------
  // 8. The upsert path — a church with NO settings row can still opt in.
  // --------------------------------------------------------------------------
  const [orphan] = await db
    .insert(churches)
    .values({ name: "Scratch Orphan", sendingNetworkId: network.id })
    .returning();
  assert.equal(await isSharingActivityWithOversight(orphan.id), false);
  await setSharingActivityWithOversight({
    churchId: orphan.id,
    enabled: true,
    updatedBy: planter.id,
  });
  assert.equal(await isSharingActivityWithOversight(orphan.id), true);
  const orphanRows = await db
    .select({ id: churchPrivacySettings.id })
    .from(churchPrivacySettings)
    .where(eq(churchPrivacySettings.churchId, orphan.id));
  assert.equal(orphanRows.length, 1, "the upsert wrote a duplicate row");
  ok("a church with no settings row can opt in, and gets exactly one row");

  // --------------------------------------------------------------------------
  // 9. Per plant, never the union — a second plant's toggle is its own.
  // --------------------------------------------------------------------------
  const [otherPlant] = await db
    .insert(churches)
    .values({ name: "Scratch Plant Two", sendingNetworkId: network.id })
    .returning();
  await db.insert(churchPrivacySettings).values({ churchId: otherPlant.id });

  const acrossPlants = await enqueue({
    churchId: otherPlant.id,
    recipientUserId: adminA.id,
    category: "milestones",
    type: "oversight.milestone.phase_advanced",
    title: "Scratch Plant Two reached a new stage",
    body: "They moved up to stage 2.",
  });
  assert.equal(acrossPlants.status, "skipped");
  assert.equal(acrossPlants.reason, "oversight_privacy");
  ok("an admin over two plants gets what each plant granted, not the union");

  // --------------------------------------------------------------------------
  // Cleanup of the rows this run created, so a re-run on the same scratch DB
  // starts from the same place.
  // --------------------------------------------------------------------------
  const seededChurches = [plant.id, orphan.id, otherPlant.id];
  await db
    .delete(notifications)
    .where(inArray(notifications.churchId, seededChurches));
  await db.delete(persons).where(inArray(persons.churchId, seededChurches));
  await db
    .delete(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.targetChurchId, plant.id),
        eq(organizationInvitations.status, "accepted")
      )
    );

  console.log(
    "\nALL PASS — the oversight model behaves against real Postgres."
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
