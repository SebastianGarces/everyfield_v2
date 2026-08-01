/**
 * G3 harness for the oversight notification model (issue #224, FRD N-025 +
 * N-026) — real database, scratch database only.
 *
 * Runs the SHIPPED functions — `enqueue`, the three milestone emitters, the
 * daily digest and the sharing toggle's reader/writer — against a Postgres that
 * has had every migration applied by `pnpm db:migrate`. Nothing is faked. The
 * unit tests cover the logic; this covers what the database actually does with
 * it, including the migration's own effect — the new column exists at false for
 * every church, and the two columns it SUPERSEDES are still present and still
 * readable, because 0028 is expand-only (see §1; the contract migration that
 * drops them is #255).
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
  churchMeetings,
  churchPrivacySettings,
  notifications,
  organizationInvitations,
  phaseTransitions,
  sendingNetworks,
  tasks,
  users,
} from "@/db/schema";
import { canAccessChurch } from "@/lib/auth/access";
import { setChurchLaunchDate } from "@/lib/churches/launch-date";
import { acceptInvitation, createInvitation } from "@/lib/invitations/service";
import { notificationCategories } from "@/lib/notifications/categories";
import { enqueue } from "@/lib/notifications/enqueue";
import {
  activityWindowForDay,
  dayKeyInAppZone,
  dbOversightDigestDeps,
  dbOversightDigestSweepDeps,
  digestDayKey,
  previousCompleteDayWindow,
  runDailyOversightDigest,
  runOversightDigest,
  runOversightDigestSweep,
} from "@/lib/notifications/oversight-digest";
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
      title: notifications.title,
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
  // 1. MIGRATION — the single toggle exists and defaults to false for everyone,
  //    and the two per-category columns it replaces are no longer READ.
  //
  //    0028 is expand-only: it adds without dropping. The columns it supersedes
  //    are still in the database on purpose, because this Neon branch is shared
  //    by local dev, every preview and production, and pre-0028 builds still
  //    name `share_phase`/`share_digest` in their SELECT list. So the assertion
  //    that matters is NOT "the columns are gone" — it is "the shipped schema
  //    has stopped reading them, and old code can still read them". A contract
  //    migration drops them after #224 merges.
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
  ok("0028 added the single oversight sharing column");

  // The new code no longer reads the superseded columns: they are absent from
  // the Drizzle table, so nothing Drizzle compiles can name them.
  const shippedColumns = Object.keys(churchPrivacySettings);
  assert.ok(
    !shippedColumns.includes("sharePhase") &&
      !shippedColumns.includes("shareDigest"),
    "the shipped schema still declares a superseded per-category toggle"
  );
  ok("the shipped schema no longer reads share_phase / share_digest");

  // ...and old code still can. This is the whole point of expand/contract: a
  // pre-0028 instance's exact projection must keep resolving while #224 sits in
  // review. If this fails, deploying 0028 takes production's oversight surfaces
  // down with it.
  await db.execute(sql`
    select "id", "church_id", "share_people", "share_meetings", "share_tasks",
           "share_financials", "share_ministry_teams", "share_facilities",
           "share_phase", "share_digest", "updated_at", "updated_by"
    from "church_privacy_settings" limit 1
  `);
  ok("a PRE-0028 build's column projection still resolves (no deploy window)");

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

  // RULED 2026-08-01 (amending N-026): this milestone is EXEMPT from the
  // toggle. "Your invitation was accepted" is the sending church's own event —
  // they issued the invitation and the acceptance answers it. It is also the
  // only way this milestone is ever reachable: the toggle defaults off and a
  // planter decides about sharing after joining, so gating it meant it was
  // refused in essentially every real case and never retried.
  const exemptRows = await rowsFor(plant.id);
  assert.equal(
    exemptRows.length,
    2,
    "the invitation milestone was refused with sharing off — the exemption is not wired"
  );
  assert.ok(
    exemptRows.every(
      (row) => row.type === "oversight.milestone.invitation_accepted"
    )
  );
  assert.deepEqual(
    exemptRows.map((row) => row.recipientUserId).sort(),
    [adminA.id, adminB.id].sort()
  );
  // The body has to be true for a reader who will get nothing further.
  assert.ok(
    exemptRows.every((row) => /theirs to switch on/i.test(row.body)),
    "the invitation body promises updates the plant has not agreed to send"
  );
  ok("invitation accepted, sharing OFF → still announced (consent exemption)");

  // The exemption is ONE TYPE, not a relaxation of the model: with sharing
  // still off, the other two milestones and the digest stay refused. Asserted
  // here, beside the exemption, because "we accidentally opened the gate" is
  // the failure this ruling could have caused.
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  const gatedWhileOff = await enqueue({
    churchId: plant.id,
    recipientUserId: adminA.id,
    category: "milestones",
    type: "oversight.milestone.phase_advanced",
    title: "Scratch Plant reached a new stage",
    body: "They moved up to stage 2.",
  });
  assert.equal(gatedWhileOff.status, "skipped");
  assert.equal(gatedWhileOff.reason, "oversight_privacy");
  assert.equal((await rowsFor(plant.id)).length, 0);
  ok("the exemption did not open the gate for the other milestones");

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
    (await setChurchLaunchDate(planter, plant.id, "2026-09-13")).status,
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
    (await setChurchLaunchDate(planter, plant.id, "2026-10-04")).status,
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
  const resave = await setChurchLaunchDate(planter, plant.id, "2026-10-04");
  assert.equal(resave.status, "unchanged");
  assert.equal((await rowsFor(plant.id)).length, 2);
  ok("re-saving the same launch date announces nothing");

  // ...but moving BACK to a date already announced is a real change, and was
  // being swallowed: the dedupe key is permanent, so keying it by the date
  // value meant the third move produced nothing at all. It is now keyed by the
  // change (date + the instant it was written).
  assert.equal(
    (await setChurchLaunchDate(planter, plant.id, "2026-11-15")).status,
    "changed"
  );
  assert.equal(
    (await setChurchLaunchDate(planter, plant.id, "2026-10-04")).status,
    "changed"
  );
  const afterRevert = await rowsFor(plant.id);
  assert.equal(
    afterRevert.length,
    6,
    "a launch date moved back to a previously announced one was swallowed"
  );
  ok("moving a launch date BACK to an announced one is still announced");

  // The write authorises itself. An oversight admin has church ACCESS to this
  // plant (asserted in §2) and would sail past a bare `requireChurchAccess`;
  // the role check is what stops the milestone from being able to announce
  // itself. A planter aimed at somebody else's plant fails the access check.
  await assert.rejects(
    () => setChurchLaunchDate(adminA, plant.id, "2026-11-01"),
    /Forbidden/,
    "an oversight admin set a plant's launch date"
  );
  const [foreignChurch] = await db
    .insert(churches)
    .values({ name: "Scratch Foreign Plant" })
    .returning();
  await assert.rejects(
    () => setChurchLaunchDate(planter, foreignChurch.id, "2026-11-01"),
    /Forbidden/,
    "a planter set another church's launch date"
  );
  const [unmoved] = await db
    .select({ launchDate: churches.launchDate })
    .from(churches)
    .where(eq(churches.id, plant.id));
  assert.equal(unmoved.launchDate, "2026-10-04", "a refused write still wrote");
  ok("setChurchLaunchDate refuses a non-planter and a foreign church");

  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 6. THE DIGEST — one per recipient on a day with activity, none on a quiet
  //    day, and the counts computed from REAL rows of every kind.
  //
  //    An earlier version of this harness seeded one `persons` row and nothing
  //    else, so three of the four count queries never ran against real data —
  //    which is exactly why a digest that counted cancelled meetings and phase
  //    regressions shipped as a PASS. Every source now gets a row that must be
  //    counted AND a row that must not, and the assertion is on the rendered
  //    body string, where a miscount is visible.
  // --------------------------------------------------------------------------
  const quietDay = new Date("2026-06-01T12:00:00.000Z");
  const busyDay = new Date("2026-06-02T12:00:00.000Z");

  // Explicit windows: `runDailyOversightDigest` deliberately has no way to ask
  // for a specific day (it always digests the last COMPLETE one), so a harness
  // that wants to talk about June 2nd says so. The default is exercised on its
  // own terms in §6b.
  const digestFor = (day: Date) =>
    runOversightDigest(dbOversightDigestDeps, {
      churchId: plant.id,
      window: activityWindowForDay(day),
    });

  const quiet = await digestFor(quietDay);
  assert.equal(quiet.status, "skipped");
  assert.equal(quiet.status === "skipped" && quiet.reason, "no_activity");
  assert.equal(
    (await rowsFor(plant.id)).length,
    0,
    "a quiet day sent a digest"
  );
  ok("a day with NO activity produces no digest row at all");

  // ---- One row per source, each paired with a near-miss that must NOT count.
  const at = (hhmm: string) => new Date(`2026-06-02T${hhmm}:00.000Z`);

  // Two people added. (Counts: 2.)
  await db.insert(persons).values([
    {
      churchId: plant.id,
      createdBy: planter.id,
      firstName: "Sam",
      lastName: "Rivera",
      createdAt: at("09:00"),
    },
    {
      churchId: plant.id,
      createdBy: planter.id,
      firstName: "Noor",
      lastName: "Haddad",
      createdAt: at("09:30"),
    },
  ]);

  // Three meetings on the day; exactly ONE was held. The cancelled one is the
  // finding this section exists for: it was reported to the sending church as a
  // meeting that happened, under a toggle whose copy promises "meetings held".
  await db.insert(churchMeetings).values([
    {
      churchId: plant.id,
      createdBy: planter.id,
      type: "vision_meeting" as const,
      title: "Held",
      datetime: at("19:00"),
      status: "completed" as const,
    },
    {
      churchId: plant.id,
      createdBy: planter.id,
      type: "vision_meeting" as const,
      title: "Called off",
      datetime: at("19:00"),
      status: "cancelled" as const,
    },
    {
      churchId: plant.id,
      createdBy: planter.id,
      type: "team_meeting" as const,
      title: "Still just scheduled",
      datetime: at("23:00"),
      status: "planning" as const,
    },
  ]);

  // A person added AND SOFT-DELETED inside the window. Must NOT be counted:
  // reporting "1 new person" to the oversight org for somebody who exists
  // nowhere in the planter's own app is the same class of overstatement as the
  // cancelled meeting above. `persons` is soft-deleted everywhere else in the
  // repo; this query was the exception.
  await db.insert(persons).values({
    churchId: plant.id,
    createdBy: planter.id,
    firstName: "Duplicate",
    lastName: "Entry",
    createdAt: at("09:45"),
    deletedAt: at("09:50"),
  });

  // Three tasks; one finished and kept, one finished and DELETED (must not
  // count), one never finished.
  await db.insert(tasks).values([
    {
      churchId: plant.id,
      createdById: planter.id,
      title: "Book the venue",
      status: "complete" as const,
      completedAt: at("10:00"),
    },
    {
      churchId: plant.id,
      createdById: planter.id,
      title: "Completed then deleted",
      status: "complete" as const,
      completedAt: at("10:30"),
      deletedAt: at("10:45"),
    },
    {
      churchId: plant.id,
      createdById: planter.id,
      title: "Still open",
      status: "in_progress" as const,
    },
  ]);

  // Two transitions; one advance, one CORRECTION. `oversight-events.ts` refuses
  // to announce the correction as a milestone, and the digest must not
  // re-disclose it as "a new stage" — the whole point of the shared predicate.
  await db.insert(phaseTransitions).values([
    {
      churchId: plant.id,
      fromPhase: 1,
      toPhase: 2,
      initiatedById: planter.id,
      reason: "advance",
      rubricVersion: "v0",
      createdAt: at("11:00"),
    },
    {
      churchId: plant.id,
      fromPhase: 3,
      toPhase: 2,
      initiatedById: planter.id,
      reason: "correcting an earlier mistake",
      rubricVersion: "v0",
      createdAt: at("12:00"),
    },
  ]);

  const busy = await digestFor(busyDay);
  assert.equal(busy.status, "enqueued");
  const digestRows = await rowsFor(plant.id);
  assert.equal(digestRows.length, 2, "one digest per oversight recipient");
  assert.ok(digestRows.every((row) => row.category === "digest"));
  assert.ok(
    digestRows.every((row) => row.type === "oversight.activity.digest")
  );

  // THE assertion. Nine rows of activity in the window, SIX of which must not
  // be counted: a cancelled meeting, a meeting not yet held, an unfinished
  // task, a phase regression, a soft-deleted person, a completed-then-deleted
  // task. Any of them leaking changes this string.
  const EXPECTED_BODY =
    "1 meeting, 2 new people, 1 task finished, 1 new stage.";
  for (const row of digestRows) {
    assert.equal(row.body, EXPECTED_BODY, "the digest miscounted");
  }
  ok(`the digest body is exactly "${EXPECTED_BODY}"`);

  // The title names the day, so a reader can tell what the counts are about
  // whenever the row is read.
  assert.ok(
    digestRows.every(
      (row) => row.title === "Scratch Plant — summary for Tue, Jun 2, 2026"
    ),
    "the digest title does not name its day"
  );
  assert.ok(
    digestRows.every((row) => !/today/i.test(row.title)),
    "the digest still claims to be about today"
  );
  ok("the digest title names the day it speaks for");

  // Counts, never contents: no seeded name or title may appear in a body.
  for (const needle of ["Sam", "Noor", "Held", "Book the venue"]) {
    assert.ok(
      digestRows.every((row) => !row.body.includes(needle)),
      `the digest carried "${needle}"`
    );
  }
  ok("a day WITH activity produces exactly one digest per oversight recipient");

  // Running it again the same day is idempotent — the dedupe key is (church,
  // day), arbitrated by the partial unique index, not by memory.
  await digestFor(busyDay);
  assert.equal((await rowsFor(plant.id)).length, 2);
  ok("a second run on the same day writes nothing further");

  // --------------------------------------------------------------------------
  // 6b. THE PRODUCTION DEFAULT — `runDailyOversightDigest(churchId)` with no
  //     `at`, which is how a scheduler will call it.
  //
  //     Previously every digest assertion passed an explicit historical day, so
  //     the shipped default window was never exercised at all. It defaulted to
  //     the day it was RUNNING IN: a partial day, frozen permanently by the
  //     dedupe key, and empty enough near midnight that a day with activity
  //     produced no digest.
  // --------------------------------------------------------------------------
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  await db.delete(persons).where(eq(persons.churchId, plant.id));

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);

  // One person yesterday, one today. Only yesterday's may be counted.
  await db.insert(persons).values([
    {
      churchId: plant.id,
      createdBy: planter.id,
      firstName: "Yesterday",
      lastName: "Person",
      createdAt: yesterday,
    },
    {
      churchId: plant.id,
      createdBy: planter.id,
      firstName: "Today",
      lastName: "Person",
      createdAt: now,
    },
  ]);

  const defaulted = await runDailyOversightDigest(plant.id);
  assert.equal(defaulted.status, "enqueued");
  assert.equal(
    defaulted.dayKey,
    dayKeyInAppZone(yesterday),
    "the default window is not yesterday"
  );

  const defaultRows = await rowsFor(plant.id);
  assert.equal(defaultRows.length, 2);
  assert.ok(
    defaultRows.every((row) => row.body === "1 new person."),
    `the default run counted the wrong day: ${defaultRows[0]?.body}`
  );
  ok(
    "the production default digests YESTERDAY, complete — not a partial today"
  );

  await db.delete(persons).where(eq(persons.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 6c. THE SCHEDULE — the dispatcher tick's once-a-day guard (ruled
  //     2026-08-01). The acceptance criterion in words: a day with
  //     oversight-visible activity produces exactly ONE digest per oversight
  //     recipient even when the tick fires many times that day, and a quiet day
  //     produces none.
  //
  //     This runs the SHIPPED sweep against real Postgres, including the
  //     selection query whose `NOT EXISTS` IS the guard. Two ticks the same day
  //     and a quiet day, asserted on rows rather than on return values.
  //
  //     CAUTION for anyone extending this: the sweep is fleet-wide by design —
  //     it selects EVERY church with a sending-church or network FK, not just
  //     the plant seeded above. On a scratch database that is exactly what we
  //     want to exercise; it is also why the teardown at the bottom deletes
  //     notifications for every church this run created, and why this section
  //     asserts on `rowsFor(plant.id)` rather than on a global count.
  // --------------------------------------------------------------------------
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: true,
    updatedBy: planter.id,
  });

  // Two ticks on the same date, at hours a 15-minute job really fires. Both
  // digest the day BEFORE — `sweepDay` — so one person added then is the whole
  // of the plant's activity for it.
  const firstTick = new Date("2026-06-11T00:14:00.000Z");
  const secondTick = new Date("2026-06-11T23:44:00.000Z");
  const sweepDayKey = digestDayKey(previousCompleteDayWindow(firstTick));
  assert.equal(sweepDayKey, "2026-06-10");

  await db.insert(persons).values({
    churchId: plant.id,
    createdBy: planter.id,
    firstName: "Swept",
    lastName: "Person",
    createdAt: new Date("2026-06-10T09:00:00.000Z"),
  });

  const tick1 = await runOversightDigestSweep(dbOversightDigestSweepDeps, {
    at: firstTick,
  });
  assert.equal(tick1.dayKey, sweepDayKey);
  const afterTick1 = await rowsFor(plant.id);
  assert.equal(afterTick1.length, 2, "the tick did not digest the plant");
  assert.ok(afterTick1.every((row) => row.category === "digest"));
  assert.ok(afterTick1.every((row) => row.body === "1 new person."));
  ok("tick 1 on a day WITH activity → one digest per oversight recipient");

  // THE idempotence assertion. The guard is derived from the rows tick 1 wrote,
  // so tick 2 does not select this plant at all — and even if it did, the
  // partial unique index would absorb the insert.
  const tick2 = await runOversightDigestSweep(dbOversightDigestSweepDeps, {
    at: secondTick,
  });
  assert.equal(tick2.dayKey, sweepDayKey, "two ticks disagreed about the day");
  assert.equal(
    (await rowsFor(plant.id)).length,
    2,
    "a second tick the same day sent another digest"
  );
  ok("tick 2 the same day → nothing further (the once-a-day guard holds)");

  // The plant is no longer among those owed a digest for that day — the guard
  // itself, read directly rather than inferred from the row count.
  const owedAfter = await dbOversightDigestSweepDeps.selectPlantsOwedDigest(
    sweepDayKey,
    100
  );
  assert.ok(
    !owedAfter.includes(plant.id),
    "a digested plant is still selected as owing one"
  );
  ok("the selection query stops offering a plant once its day is served");

  // A QUIET day: no activity in the window at all, so however many ticks fire,
  // nothing is written. Note the plant IS still selected (it is owed a digest
  // for that day and never gets one) — being selected and being contacted are
  // different things, and only the second one reaches a human.
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  await db.delete(persons).where(eq(persons.churchId, plant.id));

  const quietTicks = [
    new Date("2026-06-13T00:14:00.000Z"),
    new Date("2026-06-13T12:29:00.000Z"),
    new Date("2026-06-13T23:44:00.000Z"),
  ];
  for (const at of quietTicks) {
    await runOversightDigestSweep(dbOversightDigestSweepDeps, { at });
  }
  assert.equal(
    (await rowsFor(plant.id)).length,
    0,
    "a quiet day produced a digest"
  );
  ok("a quiet day produces no digest, on any tick");

  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

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

  await digestFor(laterDay);
  assert.equal((await rowsFor(plant.id)).length, 0);

  // Flip it — no deploy, no cache to clear, no job to restart.
  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: true,
    updatedBy: planter.id,
  });
  assert.equal(await isSharingActivityWithOversight(plant.id), true);

  await digestFor(laterDay);
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
  await digestFor(lastDay);
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
  const seededChurches = [plant.id, orphan.id, otherPlant.id, foreignChurch.id];
  await db
    .delete(notifications)
    .where(inArray(notifications.churchId, seededChurches));
  await db.delete(persons).where(inArray(persons.churchId, seededChurches));
  await db.delete(tasks).where(inArray(tasks.churchId, seededChurches));
  await db
    .delete(churchMeetings)
    .where(inArray(churchMeetings.churchId, seededChurches));
  await db
    .delete(phaseTransitions)
    .where(inArray(phaseTransitions.churchId, seededChurches));
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
