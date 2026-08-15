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
 * readable, because 0029 is expand-only (see §1; the contract migration that
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
  launches,
  notifications,
  organizationInvitations,
  phaseTransitions,
  sendingChurches,
  sendingNetworks,
  tasks,
  users,
} from "@/db/schema";
import { canAccessChurch } from "@/lib/auth/access";
import {
  getLaunchForChurch,
  getLaunchJournal,
  setLaunchDate,
} from "@/lib/launch";
import {
  ALREADY_ASSOCIATED_MESSAGE,
  InvitationError,
  NOT_AUTHORIZED_MESSAGE,
  acceptInvitationAs,
  associationStatement,
  declineInvitationAs,
  insertInvitation,
  invitationActorFromSession,
  respondToInvitationQuery,
  revokeInvitationAs,
  type InvitationActor,
  type ResolvedInvitation,
} from "@/lib/invitations/core";
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
import { listOversightRecipientsForChurch } from "@/lib/notifications/oversight-audience";
import {
  isSharingActivityWithOversight,
  setSharingActivityWithOversight,
} from "@/lib/notifications/oversight-sharing";
import { persons } from "@/db/schema";

// ----------------------------------------------------------------------------
// #265 moved the invitation logic out of the `"use server"` module: the four
// browser-reachable actions (`@/lib/invitations/service`) now mint their actor
// from `verifySession()`, so a harness with no request calls the logic layer
// directly. Nothing about the behaviour under test changed — `acceptInvitationAs`
// is the function the action calls.
//
// `seedInvitation` writes a row verbatim, which §3c needs: it deliberately
// builds invitations no action would ever produce (both FK columns set) to prove
// the audience is derived from `type` and not from a stray id.
// ----------------------------------------------------------------------------

type InvitationSeed = Pick<ResolvedInvitation, "type" | "inviterUserId"> &
  Partial<ResolvedInvitation>;

async function seedInvitation(seed: InvitationSeed) {
  return insertInvitation({
    inviteeEmail: "harness-invitee@example.com",
    targetChurchId: null,
    targetSendingChurchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...seed,
  });
}

/** The actor a session would mint for this user. */
function actorFor(user: {
  id: string;
  role: (typeof users.$inferSelect)["role"];
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}): InvitationActor {
  return invitationActorFromSession({ user });
}

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
  //    0029 is expand-only: it adds without dropping. The columns it supersedes
  //    are still in the database on purpose, because this Neon branch is shared
  //    by local dev, every preview and production, and pre-0029 builds still
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
    "0029 did not add share_activity_with_oversight"
  );
  ok("0029 added the single oversight sharing column");

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
  // pre-0029 instance's exact projection must keep resolving while #224 sits in
  // review. If this fails, deploying 0029 takes production's oversight surfaces
  // down with it.
  await db.execute(sql`
    select "id", "church_id", "share_people", "share_meetings", "share_tasks",
           "share_financials", "share_ministry_teams", "share_facilities",
           "share_phase", "share_digest", "updated_at", "updated_by"
    from "church_privacy_settings" limit 1
  `);
  ok("a PRE-0029 build's column projection still resolves (no deploy window)");

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

  const invitationOff = await seedInvitation({
    type: "church_to_network",
    inviterUserId: adminA.id,
    targetChurchId: plant.id,
    sendingNetworkId: network.id,
  });
  await acceptInvitationAs(actorFor(planter), invitationOff.id);

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

  const invitationOn = await seedInvitation({
    type: "church_to_network",
    inviterUserId: adminA.id,
    targetChurchId: plant.id,
    sendingNetworkId: network.id,
  });
  await acceptInvitationAs(actorFor(planter), invitationOn.id);

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
  // 3b. THE EXEMPTION REACHES THE INVITER, AND NOBODY ELSE.
  //
  //     The consent bypass this section exists for. `applyAssociation` sets one
  //     of a plant's two oversight FKs without clearing the other, so a plant
  //     can belong to a sending church AND a network at once. The
  //     invitation-accepted milestone is exempt from the sharing toggle, so
  //     resolving its recipients from the PLANT delivered an ungated
  //     notification to whichever org had NOT invited anybody — with sharing
  //     off and no consent of any kind.
  //
  //     Both FKs are set below, sharing stays OFF, and each direction is
  //     asserted: the invited org hears it, the other org gets zero rows.
  // --------------------------------------------------------------------------
  const [otherSendingChurch] = await db
    .insert(sendingChurches)
    .values({ name: "Scratch Sending Church" })
    .returning();

  const [sendingChurchAdmin] = await db
    .insert(users)
    .values({
      email: `sc-admin-${stamp}@example.test`,
      passwordHash: "x",
      role: "sending_church_admin" as const,
      sendingChurchId: otherSendingChurch.id,
    })
    .returning();

  // The plant now holds BOTH FKs — the reachable state the finding turned on.
  await db
    .update(churches)
    .set({ sendingChurchId: otherSendingChurch.id })
    .where(eq(churches.id, plant.id));

  await setSharingActivityWithOversight({
    churchId: plant.id,
    enabled: false,
    updatedBy: planter.id,
  });
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // Direction 1: the NETWORK invites. The sending church invited nobody.
  const networkInvitation = await seedInvitation({
    type: "church_to_network",
    inviterUserId: adminA.id,
    targetChurchId: plant.id,
    sendingNetworkId: network.id,
  });
  await acceptInvitationAs(actorFor(planter), networkInvitation.id);

  const afterNetworkInvite = await rowsFor(plant.id);
  assert.deepEqual(
    afterNetworkInvite.map((row) => row.recipientUserId).sort(),
    [adminA.id, adminB.id].sort(),
    "the network's invitation did not reach exactly the network's admins"
  );
  assert.equal(
    afterNetworkInvite.filter(
      (row) => row.recipientUserId === sendingChurchAdmin.id
    ).length,
    0,
    "an org that invited nobody was notified without consent"
  );
  ok(
    "both FKs set, sharing OFF: the network's invitation reaches ONLY the network"
  );

  // Direction 2: the SENDING CHURCH invites. The network invited nobody.
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  const sendingChurchInvitation = await seedInvitation({
    type: "church_to_sending_church",
    inviterUserId: sendingChurchAdmin.id,
    targetChurchId: plant.id,
    sendingChurchId: otherSendingChurch.id,
  });
  await acceptInvitationAs(actorFor(planter), sendingChurchInvitation.id);

  const afterSendingChurchInvite = await rowsFor(plant.id);
  assert.deepEqual(
    afterSendingChurchInvite.map((row) => row.recipientUserId),
    [sendingChurchAdmin.id],
    "the sending church's invitation did not reach exactly its own admin"
  );
  assert.equal(
    afterSendingChurchInvite.filter((row) =>
      [adminA.id, adminB.id].includes(row.recipientUserId)
    ).length,
    0,
    "the network was notified about an invitation it did not send"
  );
  ok(
    "both FKs set, sharing OFF: the sending church's invitation reaches ONLY it"
  );

  // Direction 3: THE INVITATION ROW ITSELF CARRIES BOTH IDS.
  //
  // The second half of the same bypass (ruled 2026-08-02). Narrowing the
  // audience to "the invitation's org" is only a fix if the invitation names
  // ONE org — and `organization_invitations` has both FK columns, no CHECK
  // tying either to `type`, and an insert path that validates nothing.
  // The call below is the proof of that last claim: it inserts a
  // `church_to_sending_church` row carrying a `sending_network_id` too, and is
  // accepted without complaint.
  //
  // The audience is derived from `type`, so the stray id is ignored and the
  // network — sharing still OFF, having invited nobody — hears nothing.
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  const dualIdInvitation = await seedInvitation({
    type: "church_to_sending_church",
    inviterUserId: sendingChurchAdmin.id,
    targetChurchId: plant.id,
    sendingChurchId: otherSendingChurch.id,
    sendingNetworkId: network.id,
  });
  assert.equal(
    dualIdInvitation.sendingNetworkId,
    network.id,
    "insertInvitation rejected the ambiguous row — the fixture no longer reproduces the finding"
  );
  await acceptInvitationAs(actorFor(planter), dualIdInvitation.id);

  const afterDualIdInvite = await rowsFor(plant.id);
  assert.deepEqual(
    afterDualIdInvite.map((row) => row.recipientUserId),
    [sendingChurchAdmin.id],
    "a stray FK on the invitation row widened the consent-exempt audience"
  );
  assert.equal(
    afterDualIdInvite.filter((row) =>
      [adminA.id, adminB.id].includes(row.recipientUserId)
    ).length,
    0,
    "the network was notified by an invitation whose TYPE names the sending church"
  );
  ok(
    "invitation row carrying BOTH ids: only the org its TYPE names is notified"
  );

  // ...and the mirror, so the derivation cannot be one-directional.
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));
  const dualIdToNetwork = await seedInvitation({
    type: "church_to_network",
    inviterUserId: adminA.id,
    targetChurchId: plant.id,
    sendingChurchId: otherSendingChurch.id,
    sendingNetworkId: network.id,
  });
  await acceptInvitationAs(actorFor(planter), dualIdToNetwork.id);

  const afterDualIdToNetwork = await rowsFor(plant.id);
  assert.deepEqual(
    afterDualIdToNetwork.map((row) => row.recipientUserId).sort(),
    [adminA.id, adminB.id].sort(),
    "the network's own invitation did not reach exactly the network's admins"
  );
  assert.equal(
    afterDualIdToNetwork.filter(
      (row) => row.recipientUserId === sendingChurchAdmin.id
    ).length,
    0,
    "the sending church was notified by an invitation whose TYPE names the network"
  );
  ok("...and the mirror: a network-typed row ignores its stray sending church");

  // NEGATIVE CONTROL. The two assertions above are only meaningful if the
  // audience they exclude was genuinely reachable — so prove that the
  // PLANT-wide lister, which is what the fan-out used before this fix, really
  // does return the uninvolved org's admin for this plant. Without this, the
  // section would pass just as well against a plant that only ever had one org.
  const plantWide = await listOversightRecipientsForChurch(plant.id);
  assert.deepEqual(
    plantWide.map((row) => row.id).sort(),
    [adminA.id, adminB.id, sendingChurchAdmin.id].sort(),
    "the fixture does not actually reproduce the dual-org plant"
  );
  ok("negative control: the plant-wide audience DOES span both orgs");

  // Restore the plant to network-only oversight; the sections below assert on
  // "two oversight admins" and a third would silently change every count.
  await db
    .update(churches)
    .set({ sendingChurchId: null })
    .where(eq(churches.id, plant.id));
  await db.delete(notifications).where(eq(notifications.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 3d. A LOST ACCEPT WRITES NOTHING (#265).
  //
  //     The invariant: `churches.sending_church_id` is non-null IF AND ONLY IF
  //     the invitation reads `accepted`. An accept that loses the race — to a
  //     revoke, to a decline, or to ANOTHER ACCEPT for the same free slot
  //     (case H) — must leave the plant unbound and its own invitation pending.
  //
  //     Why it needs a real database and not a unit test. `acceptInvitationAs`
  //     reads the invitation, then writes; two requests both pass that read, so
  //     the guard has to be in SQL. It is: the claim (compare-and-set on
  //     `status = 'pending'`) is statement one of a `db.batch` and the FK write
  //     is statement two, conditioned on the invitation already reading
  //     `accepted`. Ordering is the whole fix — with the FK write first, a lost
  //     claim STILL bound the plant to an oversight org (an empty `returning()`
  //     is not an error and does not roll a batch back), which put the plant
  //     inside that org's `getAccessibleChurchIds` and onto its
  //     `getOversightPlantHealth` listing with no acceptance behind it, and
  //     `disassociate*` has no entrypoint, so nothing could undo it.
  //
  //     Timing-dependent by nature: the revoke has to land inside the accept's
  //     read→write window, so every case runs several times.
  // --------------------------------------------------------------------------
  const [raceSendingChurch] = await db
    .insert(sendingChurches)
    .values({ name: "Scratch Race Sending Church" })
    .returning();

  const [raceInviter] = await db
    .insert(users)
    .values({
      email: `race-inviter-${stamp}@example.test`,
      passwordHash: "x",
      role: "sending_church_admin" as const,
      sendingChurchId: raceSendingChurch.id,
    })
    .returning();

  const [racePlant] = await db
    .insert(churches)
    .values({ name: "Scratch Race Plant" })
    .returning();

  const [racePlanter] = await db
    .insert(users)
    .values({
      email: `race-planter-${stamp}@example.test`,
      passwordHash: "x",
      role: "planter" as const,
      churchId: racePlant.id,
    })
    .returning();

  await db.insert(churchPrivacySettings).values({ churchId: racePlant.id });

  /** The two facts the invariant relates. */
  async function raceState(invitationId: string) {
    const [[church], [invitation]] = await Promise.all([
      db
        .select({ sendingChurchId: churches.sendingChurchId })
        .from(churches)
        .where(eq(churches.id, racePlant.id)),
      db
        .select({
          status: organizationInvitations.status,
          respondedBy: organizationInvitations.respondedBy,
        })
        .from(organizationInvitations)
        .where(eq(organizationInvitations.id, invitationId)),
    ]);
    return { bound: church.sendingChurchId, invitation };
  }

  /** A fresh pending invitation into the race sending church, plant unbound. */
  async function freshRaceInvitation() {
    await db
      .update(churches)
      .set({ sendingChurchId: null })
      .where(eq(churches.id, racePlant.id));
    await db
      .delete(notifications)
      .where(eq(notifications.churchId, racePlant.id));
    return seedInvitation({
      type: "church_to_sending_church",
      inviterUserId: raceInviter.id,
      targetChurchId: racePlant.id,
      sendingChurchId: raceSendingChurch.id,
    });
  }

  /** The invariant, asserted against whatever the race settled on. */
  async function assertConsistent(invitationId: string, label: string) {
    const { bound, invitation } = await raceState(invitationId);
    if (invitation.status === "accepted") {
      assert.equal(
        bound,
        raceSendingChurch.id,
        `${label}: the invitation reads accepted but the plant is not bound`
      );
      assert.equal(invitation.respondedBy, racePlanter.id, label);
    } else {
      assert.equal(
        bound,
        null,
        `${label}: the plant is bound to an oversight org with no accepted invitation (status=${invitation.status})`
      );
    }
    return invitation.status;
  }

  // Case A — deterministic: the revoke has already COMMITTED when the accept
  // runs. The accept must be refused and must change nothing at all.
  const revokedFirst = await freshRaceInvitation();
  await revokeInvitationAs(actorFor(raceInviter), revokedFirst.id);
  await assert.rejects(
    () => acceptInvitationAs(actorFor(racePlanter), revokedFirst.id),
    InvitationError
  );
  const afterRevokedFirst = await raceState(revokedFirst.id);
  assert.equal(afterRevokedFirst.invitation.status, "revoked");
  assert.equal(
    afterRevokedFirst.bound,
    null,
    "an accept refused after a revoke still bound the plant"
  );
  assert.equal(
    (await rowsFor(racePlant.id)).length,
    0,
    "a refused accept announced a milestone"
  );
  ok("a revoked invitation cannot be accepted, and writes nothing");

  // Case B — the exact window, deterministically. Case A's revoke was already
  // committed when the accept STARTED, so the accept never reached its write:
  // the read refused it. The window that produced the finding is narrower —
  // the read saw `pending`, then a revoke committed, and then the write ran. So
  // run the accept's own two statements against an already-revoked invitation,
  // which is that state exactly, and assert the pair applies all-or-nothing.
  const lostClaim = await freshRaceInvitation();
  await revokeInvitationAs(actorFor(raceInviter), lostClaim.id);

  const [claimRows] = await db.batch([
    respondToInvitationQuery(actorFor(racePlanter), lostClaim.id, "accepted"),
    associationStatement(
      {
        type: "church_to_sending_church",
        targetChurchId: racePlant.id,
        targetSendingChurchId: null,
        sendingChurchId: raceSendingChurch.id,
        sendingNetworkId: null,
      },
      lostClaim.id
    ),
  ]);

  assert.equal(claimRows.length, 0, "the claim matched a non-pending row");
  const afterLostClaim = await raceState(lostClaim.id);
  assert.equal(afterLostClaim.invitation.status, "revoked");
  assert.equal(
    afterLostClaim.bound,
    null,
    "the association was written even though the claim matched no row — the batch is not the guard, the ordering is"
  );
  ok("the accept's write pair: a lost claim writes NOTHING (both statements)");

  // Case C — the actual race, N times: the revoke is fired while the accept is
  // in flight, so it lands somewhere around the accept's read→write window.
  // Which side wins is timing, hence the repetition; the invariant is asserted
  // either way, and the accept's refusal message says which window it hit.
  const RACE_RUNS = 8;
  const outcomes: string[] = [];
  const refusals: string[] = [];

  for (let run = 0; run < RACE_RUNS; run += 1) {
    const invitation = await freshRaceInvitation();

    const accept = acceptInvitationAs(actorFor(racePlanter), invitation.id);
    const revoke = revokeInvitationAs(actorFor(raceInviter), invitation.id);
    const [acceptResult, revokeResult] = await Promise.allSettled([
      accept,
      revoke,
    ]);

    // Exactly one of the two may win: both statements compare-and-set on
    // `pending`, so the loser matches no row and raises.
    assert.notEqual(
      acceptResult.status === "fulfilled",
      revokeResult.status === "fulfilled",
      `run ${run}: accept and revoke both ${acceptResult.status}`
    );
    if (acceptResult.status === "rejected") {
      assert.ok(acceptResult.reason instanceof InvitationError);
      refusals.push(acceptResult.reason.message);
    }

    const status = await assertConsistent(
      invitation.id,
      `accept/revoke ${run}`
    );
    outcomes.push(status);

    // ...and the milestone follows the winner, not the attempt.
    const announced = await rowsFor(racePlant.id);
    assert.equal(
      announced.length > 0,
      status === "accepted",
      `run ${run}: milestone rows disagree with status=${status}`
    );
  }

  ok(
    `accept vs revoke, ${RACE_RUNS} runs: the plant is bound IFF the invitation reads accepted (${outcomes.join(", ")})`
  );
  console.log(
    `      accept refusals: ${refusals.length ? refusals.join(" | ") : "none — the accept won every run"}`
  );

  // Case D — accept vs DECLINE, the same shape from the plant's own side (a
  // double-clicked response). The planter is the authority for both, so this is
  // reachable from one session.
  for (let run = 0; run < RACE_RUNS; run += 1) {
    const invitation = await freshRaceInvitation();

    const accept = acceptInvitationAs(actorFor(racePlanter), invitation.id);
    const decline = declineInvitationAs(actorFor(racePlanter), invitation.id);
    const [acceptResult, declineResult] = await Promise.allSettled([
      accept,
      decline,
    ]);

    assert.notEqual(
      acceptResult.status === "fulfilled",
      declineResult.status === "fulfilled",
      `run ${run}: accept and decline both ${acceptResult.status}`
    );

    await assertConsistent(invitation.id, `accept/decline ${run}`);
  }

  ok(`accept vs decline, ${RACE_RUNS} runs: same invariant holds`);

  // Case E — an expiry can never overwrite a recorded answer. The auto-expire
  // write is a compare-and-set on `pending` too, so a request that read the row
  // as pending a moment before the expiry instant cannot stamp `expired` over
  // the `accepted` a concurrent request committed.
  const expiring = await freshRaceInvitation();
  await acceptInvitationAs(actorFor(racePlanter), expiring.id);
  await db
    .update(organizationInvitations)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(organizationInvitations.id, expiring.id));
  await assert.rejects(
    () => declineInvitationAs(actorFor(racePlanter), expiring.id),
    InvitationError
  );
  const afterExpiryAttempt = await raceState(expiring.id);
  assert.equal(
    afterExpiryAttempt.invitation.status,
    "accepted",
    "a past-expiry read overwrote a committed acceptance with `expired`"
  );
  assert.equal(afterExpiryAttempt.bound, raceSendingChurch.id);
  ok("a past-expiry response cannot stamp `expired` over a recorded answer");

  // Case F — a foreign actor learns nothing and writes nothing. The status word
  // used to leak (`Invitation is already accepted` vs `not found` vs `expired`),
  // and the auto-expire write ran with no authority check at all, so any
  // authenticated user could flip an arbitrary past-expiry invitation.
  const foreignActor = actorFor(planter); // a planter, but of a different plant
  const pastExpiry = await freshRaceInvitation();
  await db
    .update(organizationInvitations)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(organizationInvitations.id, pastExpiry.id));

  for (const attempt of [acceptInvitationAs, declineInvitationAs]) {
    await assert.rejects(
      () => attempt(foreignActor, pastExpiry.id),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === NOT_AUTHORIZED_MESSAGE,
      "a foreign actor was told something other than 'not authorized'"
    );
  }

  const afterForeign = await raceState(pastExpiry.id);
  assert.equal(
    afterForeign.invitation.status,
    "pending",
    "a foreign actor triggered the auto-expire write"
  );
  assert.equal(afterForeign.bound, null);
  ok(
    "a foreign actor learns nothing from an expired invitation, and writes nothing"
  );

  // ...and the same for every settled status: no status word reaches a caller
  // with no authority over the target.
  for (const status of [
    "accepted",
    "declined",
    "revoked",
    "expired",
  ] as const) {
    const settled = await freshRaceInvitation();
    await db
      .update(organizationInvitations)
      .set({ status })
      .where(eq(organizationInvitations.id, settled.id));

    await assert.rejects(
      () => acceptInvitationAs(foreignActor, settled.id),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === NOT_AUTHORIZED_MESSAGE,
      `the status \`${status}\` leaked to a foreign actor`
    );
  }
  ok(
    "no invitation status leaks to a caller without authority over the target"
  );

  // Case G — A SECOND ACCEPT NEVER REPLACES AN ASSOCIATION (#265, ruled
  // 2026-08-03; sever rules #274 / FRD OV-007). The case `assertConsistent`
  // cannot see: it only ever inspects ONE invitation, so two accepted
  // invitations for the same slot satisfy "bound IFF accepted" vacuously.
  //
  // Reachable with no forgery at all: `createInvitation` checks no membership,
  // so a second sending church may invite a plant that already belongs to one,
  // and the plant's own planter has authority over that invitation too.
  // Accepting it used to set `churches.sending_church_id` to the newcomer and
  // sever the incumbent with no type-to-confirm, no notification to it and no
  // `association_events` row — while its invitation still read `accepted` and it
  // had already been sent the acceptance milestone. Now the accept is REFUSED
  // and writes nothing; severing is #277/#278's audited job.
  const [rivalSendingChurch] = await db
    .insert(sendingChurches)
    .values({ name: "Scratch Rival Sending Church" })
    .returning();

  const [rivalInviter] = await db
    .insert(users)
    .values({
      email: `rival-inviter-${stamp}@example.test`,
      passwordHash: "x",
      role: "sending_church_admin" as const,
      sendingChurchId: rivalSendingChurch.id,
    })
    .returning();

  const incumbent = await freshRaceInvitation();
  await acceptInvitationAs(actorFor(racePlanter), incumbent.id);
  assert.equal(
    (await raceState(incumbent.id)).bound,
    raceSendingChurch.id,
    "the first accept did not bind the plant"
  );
  const milestonesBefore = (await rowsFor(racePlant.id)).length;

  const rival = await seedInvitation({
    type: "church_to_sending_church",
    inviterUserId: rivalInviter.id,
    targetChurchId: racePlant.id,
    sendingChurchId: rivalSendingChurch.id,
  });

  await assert.rejects(
    () => acceptInvitationAs(actorFor(racePlanter), rival.id),
    (error: unknown) =>
      error instanceof InvitationError &&
      error.message === ALREADY_ASSOCIATED_MESSAGE,
    "a second accept for an already-bound slot was not refused — or was refused with the message a LOST CLAIM gets, which is a different fact"
  );

  const [afterRival] = await db
    .select({
      status: organizationInvitations.status,
      respondedBy: organizationInvitations.respondedBy,
    })
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, rival.id));

  assert.equal(
    afterRival.status,
    "pending",
    "the refused accept claimed the invitation anyway — it is now accepted with no association behind it"
  );
  assert.equal(afterRival.respondedBy, null);

  const afterIncumbent = await raceState(incumbent.id);
  assert.equal(
    afterIncumbent.bound,
    raceSendingChurch.id,
    "the refused accept severed the association it was not allowed to replace"
  );
  assert.equal(afterIncumbent.invitation.status, "accepted");
  assert.equal(
    (await rowsFor(racePlant.id)).length,
    milestonesBefore,
    "the refused accept announced a milestone to the newcomer"
  );
  ok("a second accept is refused, and the incumbent association survives it");

  // ...and re-accepting the SAME org's slot is still the idempotent no-op the
  // replay path depends on: the guard is `IS NULL OR = this org`, not `IS NULL`.
  const sameOrgAgain = await seedInvitation({
    type: "church_to_sending_church",
    inviterUserId: raceInviter.id,
    targetChurchId: racePlant.id,
    sendingChurchId: raceSendingChurch.id,
  });
  await acceptInvitationAs(actorFor(racePlanter), sameOrgAgain.id);
  assert.equal(
    (await raceState(sameOrgAgain.id)).bound,
    raceSendingChurch.id,
    "re-accepting the org the plant already belongs to was refused"
  );
  ok("re-binding the org the plant already belongs to is still allowed");

  // Case H — ACCEPT vs ACCEPT (#265 r3, HR4 evidence 2026-08-03). The race Case G
  // cannot see and cases C/D cannot either: TWO invitations, from two different
  // orgs, for ONE free slot, accepted at the same moment.
  //
  // Why it slipped past the guard Case G proves. The slot rule on the claim is
  // `EXISTS (SELECT … FROM churches WHERE … fk IS NULL OR fk = <this org>)` — a
  // subquery, which reads a snapshot and takes NO lock. The two claims update two
  // DIFFERENT rows of `organization_invitations`, so they contend on nothing:
  // both EXISTS were true when evaluated, both claims committed `accepted`, and
  // READ COMMITTED's re-check made the second association's UPDATE match nothing.
  // Result, reproduced 6/10 runs on the previous revision: an invitation reading
  // `accepted` with no association behind it AND an oversight milestone announced
  // to an org the plant never joined — the one state with no product repair path
  // until severing ships (#277/#278).
  //
  // Closed by `lockTargetRow` — `SELECT … FOR UPDATE` on the plant's own row as
  // statement ONE of the accept batch. The loser blocks until the winner commits,
  // then evaluates the slot rule against what the winner wrote and is refused.
  // Asserted here on a real database because there is nothing to assert in SQL
  // text: the bug was two snapshots, not a missing predicate.
  const ACCEPT_RACE_RUNS = 10;
  const acceptRaceWinners: string[] = [];
  const acceptRaceRefusals: string[] = [];

  for (let run = 0; run < ACCEPT_RACE_RUNS; run += 1) {
    // Resets the plant to unbound and clears its notifications.
    const incumbentSide = await freshRaceInvitation();
    const rivalSide = await seedInvitation({
      type: "church_to_sending_church",
      inviterUserId: rivalInviter.id,
      targetChurchId: racePlant.id,
      sendingChurchId: rivalSendingChurch.id,
    });

    const [first, second] = await Promise.allSettled([
      acceptInvitationAs(actorFor(racePlanter), incumbentSide.id),
      acceptInvitationAs(actorFor(racePlanter), rivalSide.id),
    ]);

    assert.notEqual(
      first.status === "fulfilled",
      second.status === "fulfilled",
      `run ${run}: both accepts ${first.status} — two orgs claimed one slot`
    );

    for (const settled of [first, second]) {
      if (settled.status === "rejected") {
        assert.ok(
          settled.reason instanceof InvitationError,
          `run ${run}: the losing accept failed for a non-product reason`
        );
        acceptRaceRefusals.push(settled.reason.message);
      }
    }

    const [[boundTo], both] = await Promise.all([
      db
        .select({ sendingChurchId: churches.sendingChurchId })
        .from(churches)
        .where(eq(churches.id, racePlant.id)),
      db
        .select({
          id: organizationInvitations.id,
          status: organizationInvitations.status,
          respondedBy: organizationInvitations.respondedBy,
          sendingChurchId: organizationInvitations.sendingChurchId,
        })
        .from(organizationInvitations)
        .where(
          inArray(organizationInvitations.id, [incumbentSide.id, rivalSide.id])
        ),
    ]);

    const accepted = both.filter((row) => row.status === "accepted");
    assert.equal(
      accepted.length,
      1,
      `run ${run}: ${accepted.length} of the two invitations read accepted — one slot, one acceptance`
    );
    assert.equal(
      boundTo.sendingChurchId,
      accepted[0].sendingChurchId,
      `run ${run}: the plant is bound to an org whose invitation does not read accepted`
    );
    acceptRaceWinners.push(
      accepted[0].sendingChurchId === raceSendingChurch.id
        ? "incumbent"
        : "rival"
    );

    // The loser wrote NOTHING — not even its own status. It stays `pending`, so
    // the plant can still accept it after severing (#277), which is exactly the
    // order OV-007 wants.
    const [loser] = both.filter((row) => row.status !== "accepted");
    assert.equal(
      loser.status,
      "pending",
      `run ${run}: the refused accept still answered its own invitation (status=${loser.status})`
    );
    assert.equal(
      loser.respondedBy,
      null,
      `run ${run}: the refused accept stamped responded_by`
    );

    // ...and no milestone reached the org that lost. This is the half that made
    // the race a privacy fault and not merely a data fault: the acceptance
    // milestone is the ONE oversight notification that bypasses the sharing
    // toggle, so announcing it to an org the plant never joined cannot be
    // undone by a preference.
    const loserAdmin =
      loser.sendingChurchId === raceSendingChurch.id
        ? raceInviter.id
        : rivalInviter.id;
    const announced = await rowsFor(racePlant.id);

    assert.ok(
      announced.length > 0,
      `run ${run}: the winning accept announced no milestone at all`
    );
    assert.ok(
      !announced.some((row) => row.recipientUserId === loserAdmin),
      `run ${run}: the refused accept announced the acceptance milestone to its own org`
    );
  }

  ok(
    `accept vs accept, ${ACCEPT_RACE_RUNS} runs: exactly one accept commits and the plant is bound to that org (${acceptRaceWinners.join(", ")})`
  );
  ok(
    `accept vs accept, ${ACCEPT_RACE_RUNS} runs: the losing accept writes NOTHING — its invitation is still pending and its org was never announced to`
  );
  console.log(
    `      losing-accept refusals: ${acceptRaceRefusals.join(" | ") || "none"}`
  );

  await db
    .update(churches)
    .set({ sendingChurchId: null })
    .where(eq(churches.id, racePlant.id));
  await db
    .delete(organizationInvitations)
    .where(eq(organizationInvitations.targetChurchId, racePlant.id));
  await db
    .delete(notifications)
    .where(eq(notifications.churchId, racePlant.id));

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
    (await setLaunchDate(planter, plant.id, "2026-09-13")).status,
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
    (await setLaunchDate(planter, plant.id, "2026-10-04")).status,
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
  const resave = await setLaunchDate(planter, plant.id, "2026-10-04");
  assert.equal(resave.status, "unchanged");
  assert.equal((await rowsFor(plant.id)).length, 2);
  ok("re-saving the same launch date announces nothing");

  // ...but moving BACK to a date already announced is a real change, and was
  // being swallowed: the dedupe key is permanent, so keying it by the date
  // value meant the third move produced nothing at all. It is now keyed by the
  // change (date + the instant it was written).
  assert.equal(
    (await setLaunchDate(planter, plant.id, "2026-11-15")).status,
    "changed"
  );
  assert.equal(
    (await setLaunchDate(planter, plant.id, "2026-10-04")).status,
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
    () => setLaunchDate(adminA, plant.id, "2026-11-01"),
    /Forbidden/,
    "an oversight admin set a plant's launch date"
  );
  const [foreignChurch] = await db
    .insert(churches)
    .values({ name: "Scratch Foreign Plant" })
    .returning();
  await assert.rejects(
    () => setLaunchDate(planter, foreignChurch.id, "2026-11-01"),
    /Forbidden/,
    "a planter set another church's launch date"
  );
  // Rewritten against the ENTITY (#305/LS-001): the date this used to read off
  // `churches.launch_date` now lives on `launches.target_date`, and the column
  // is gone. Same assertion, same reason — a refused write must not have moved
  // the day — read from the row that owns it.
  const unmoved = await getLaunchForChurch(plant.id);
  assert.equal(
    unmoved?.targetDate,
    "2026-10-04",
    "a refused write still wrote"
  );
  ok("setLaunchDate refuses a non-planter and a foreign church");

  // LS-002 — the journal. Every set/move above is recorded with actor, old → new
  // and the status either side, and the FIRST commitment is `scheduled` while
  // every later move is `moved` (a `postponed` arm exists for the postpone flow
  // and is not exercised from this harness). The refused writes must appear
  // nowhere: a journal that records attempts is not a journal of what happened.
  const journal = await getLaunchJournal(unmoved!.id, plant.id);
  assert.deepEqual(
    journal.map((row) => row.event),
    ["scheduled", "moved", "moved", "moved"],
    "the launch journal did not match the four dates that were actually written"
  );
  assert.equal(
    journal[0].previousTargetDate,
    null,
    "first commitment had a from-date"
  );
  assert.equal(journal[0].targetDate, "2026-09-13");
  assert.equal(journal[0].previousStatus, "planning");
  assert.equal(journal[0].status, "scheduled");
  assert.equal(journal[1].previousTargetDate, "2026-09-13");
  assert.equal(journal[1].targetDate, "2026-10-04");
  assert.ok(
    journal.every((row) => row.actorUserId === planter.id),
    "the journal attributed a change to somebody other than the planter"
  );
  ok(
    "every launch-date change is journaled with actor and old → new; refusals are not"
  );

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
  const owedAfter = await dbOversightDigestSweepDeps.selectPlantsOwedDigest({
    dayKey: sweepDayKey,
    window: previousCompleteDayWindow(firstTick),
    limit: 100,
    afterChurchId: null,
  });
  assert.ok(
    !owedAfter.includes(plant.id),
    "a digested plant is still selected as owing one"
  );
  ok("the selection query stops offering a plant once its day is served");

  // A QUIET day: no activity in the window at all, so however many ticks fire,
  // nothing is written. The plant is not even OFFERED now — the selection query
  // carries the same activity conditions the counts use, so a quiet plant is
  // excluded in SQL rather than summarised 96 times to rediscover the same
  // zero. That is half of the starvation fix; §6d asserts the other half.
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
  await db.delete(persons).where(eq(persons.churchId, plant.id));

  // --------------------------------------------------------------------------
  // 6d. STARVATION — an eligible plant BEYOND the batch, behind a wall of
  //     permanently-owed ones. The regression for the CRITICAL correctness
  //     finding of 2026-08-01.
  //
  //     The old sweep took the first N owed plants by `churches.id` on every
  //     tick, and a plant left the owed set only by having a digest row
  //     written. Anything that could never write one — quiet, sharing off (the
  //     default for every plant), no oversight admins — therefore held the head
  //     of the stable ordering all day, and the plants behind it were never
  //     reached on any of the day's 96 ticks.
  //
  //     Five plants are seeded here with EXPLICIT, ascending uuids, so "id
  //     order" is a fact of the fixture rather than a hope about
  //     `gen_random_uuid()`. The three that come first are ineligible for the
  //     three different reasons; the two behind them are eligible, and the page
  //     size is ONE, so the second of them is beyond the batch by construction.
  // --------------------------------------------------------------------------
  const starveId = (n: number) => `aaaaaaa${n}-0000-4000-8000-00000000000${n}`;
  const [quietPlant, notSharingPlant, noAdminPlant, eligibleA, eligibleB] = [
    1, 2, 3, 4, 5,
  ].map(starveId);

  // An org with NO oversight admins, so `noAdminPlant` has nobody to digest to.
  const [emptyNetwork] = await db
    .insert(sendingNetworks)
    .values({ name: "Scratch Empty Network" })
    .returning();

  await db.insert(churches).values([
    { id: quietPlant, name: "Starve Quiet", sendingNetworkId: network.id },
    {
      id: notSharingPlant,
      name: "Starve Not Sharing",
      sendingNetworkId: network.id,
    },
    {
      id: noAdminPlant,
      name: "Starve No Admins",
      sendingNetworkId: emptyNetwork.id,
    },
    { id: eligibleA, name: "Starve Eligible A", sendingNetworkId: network.id },
    { id: eligibleB, name: "Starve Eligible B", sendingNetworkId: network.id },
  ]);

  await db.insert(churchPrivacySettings).values([
    { churchId: quietPlant, shareActivityWithOversight: true },
    { churchId: notSharingPlant, shareActivityWithOversight: false },
    { churchId: noAdminPlant, shareActivityWithOversight: true },
    { churchId: eligibleA, shareActivityWithOversight: true },
    { churchId: eligibleB, shareActivityWithOversight: true },
  ]);

  // A day nothing else in this run has activity on, so the fleet-wide sweep
  // below is answering a question about exactly these five plants.
  const starveTick = new Date("2026-05-21T00:14:00.000Z");
  const starveWindow = previousCompleteDayWindow(starveTick);
  const starveDayKey = digestDayKey(starveWindow);
  assert.equal(starveDayKey, "2026-05-20");

  // Everyone but the quiet one has activity in the window.
  await db.insert(persons).values(
    [notSharingPlant, noAdminPlant, eligibleA, eligibleB].map((churchId) => ({
      churchId,
      createdBy: planter.id,
      firstName: "Starve",
      lastName: "Person",
      createdAt: new Date("2026-05-20T09:00:00.000Z"),
    }))
  );

  // The selection itself, before any sweeping: only the two eligible plants,
  // in id order. This is the clause-by-clause proof — three different reasons
  // for permanent owing, all excluded.
  const owedStarve = await dbOversightDigestSweepDeps.selectPlantsOwedDigest({
    dayKey: starveDayKey,
    window: starveWindow,
    limit: 100,
    afterChurchId: null,
  });
  assert.deepEqual(
    owedStarve.filter((id) =>
      [
        quietPlant,
        notSharingPlant,
        noAdminPlant,
        eligibleA,
        eligibleB,
      ].includes(id)
    ),
    [eligibleA, eligibleB],
    "the selection still offers plants that can never produce a digest"
  );
  ok("the selection excludes quiet, non-sharing and admin-less plants");

  // NEGATIVE CONTROL for the ORDERING. The fixture only reproduces the finding
  // if the three ineligible plants really do sort ahead of the eligible ones —
  // otherwise "the eligible plant was reached" proves nothing. Assert the id
  // order directly, then assert that the FIRST page of one is the eligible
  // plant rather than the quiet one that precedes it.
  assert.deepEqual(
    [quietPlant, notSharingPlant, noAdminPlant, eligibleA, eligibleB],
    [quietPlant, notSharingPlant, noAdminPlant, eligibleA, eligibleB]
      .slice()
      .sort(),
    "the starvation fixture is not in ascending id order"
  );
  const firstOwedPage = await dbOversightDigestSweepDeps.selectPlantsOwedDigest(
    {
      dayKey: starveDayKey,
      window: starveWindow,
      limit: 1,
      afterChurchId: null,
    }
  );
  assert.deepEqual(
    firstOwedPage,
    [eligibleA],
    "the head of the owed set is still a plant that can never be digested"
  );
  ok(
    "negative control: the ineligible plants sort FIRST and are skipped anyway"
  );

  // PAGE SIZE ONE. Under the old shape this tick would have digested nothing
  // at all: the batch was the selection window and three ineligible plants sat
  // in front. Here the batch bounds the WORK and the keyset walks past them.
  const starveSweep = await runOversightDigestSweep(
    dbOversightDigestSweepDeps,
    { at: starveTick, limit: 1 }
  );
  assert.equal(starveSweep.dayKey, starveDayKey);
  assert.ok(
    starveSweep.pages >= 2,
    `the sweep did not page past its batch (pages=${starveSweep.pages})`
  );

  const eligibleARows = await rowsFor(eligibleA);
  const eligibleBRows = await rowsFor(eligibleB);
  assert.equal(eligibleARows.length, 2, "the first eligible plant was skipped");
  assert.equal(
    eligibleBRows.length,
    2,
    "the eligible plant BEYOND the batch was starved"
  );
  assert.ok(eligibleBRows.every((row) => row.body === "1 new person."));
  for (const starved of [quietPlant, notSharingPlant, noAdminPlant]) {
    assert.equal(
      (await rowsFor(starved)).length,
      0,
      "a plant that should never be digested was"
    );
  }
  ok(
    "an eligible plant beyond the batch is digested behind three permanently-owed ones"
  );

  // Same-day idempotence survives the fix: a second tick offers nothing.
  const starveSecond = await runOversightDigestSweep(
    dbOversightDigestSweepDeps,
    { at: new Date("2026-05-21T23:44:00.000Z"), limit: 1 }
  );
  assert.equal(starveSecond.dayKey, starveDayKey);
  assert.equal((await rowsFor(eligibleA)).length, 2);
  assert.equal((await rowsFor(eligibleB)).length, 2);
  ok("a second tick the same day adds nothing — idempotence is intact");

  // --------------------------------------------------------------------------
  // 6e. A FAILED RECIPIENT IS RE-OFFERED — the per-recipient owed clause.
  //
  //     `fanOutTo` swallows one recipient's `enqueue` throw so the others still
  //     get theirs. With the selection asking whether ANY digest row existed for
  //     (church, day), a plant with two oversight admins wrote one row, left the
  //     owed set, and the admin whose insert failed never got that day's digest
  //     on any later tick — while `summary.digested` counted the plant as
  //     served. A transient failure became a permanent, invisible one.
  //
  //     `eligibleA` already has both admins' rows for `starveDayKey`. Deleting
  //     ONE of them is exactly the state a swallowed per-recipient failure
  //     leaves behind, and it is asserted against the REAL selection query.
  // --------------------------------------------------------------------------
  const digestedRows = await rowsFor(eligibleA);
  assert.equal(digestedRows.length, 2, "the fixture is not a two-admin plant");
  const failedRecipient = digestedRows[0].recipientUserId;
  const servedRecipient = digestedRows[1].recipientUserId;
  await db
    .delete(notifications)
    .where(eq(notifications.id, digestedRows[0].id));

  const owedAfterPartial =
    await dbOversightDigestSweepDeps.selectPlantsOwedDigest({
      dayKey: starveDayKey,
      window: starveWindow,
      limit: 100,
      afterChurchId: null,
    });
  assert.ok(
    owedAfterPartial.includes(eligibleA),
    "a plant with one recipient still missing the day's digest was not re-offered"
  );
  ok("a partially-delivered plant is still owed — the clause is per recipient");

  const retryTick = await runOversightDigestSweep(dbOversightDigestSweepDeps, {
    at: new Date("2026-05-21T23:59:00.000Z"),
    limit: 10,
  });
  assert.equal(retryTick.dayKey, starveDayKey);

  const afterRetry = await rowsFor(eligibleA);
  assert.equal(
    afterRetry.length,
    2,
    "the retry did not restore exactly one row per recipient"
  );
  assert.equal(
    afterRetry.filter((row) => row.recipientUserId === failedRecipient).length,
    1,
    "the failed recipient was never retried"
  );
  assert.equal(
    afterRetry.filter((row) => row.recipientUserId === servedRecipient).length,
    1,
    "the recipient who already had their digest was sent a second copy"
  );
  ok("the failed recipient is retried; the successful one is not duplicated");

  // ...and once everyone has theirs, the plant leaves the owed set again.
  const owedAfterRetry =
    await dbOversightDigestSweepDeps.selectPlantsOwedDigest({
      dayKey: starveDayKey,
      window: starveWindow,
      limit: 100,
      afterChurchId: null,
    });
  assert.ok(
    !owedAfterRetry.includes(eligibleA),
    "a fully-served plant is still being offered"
  );
  ok("...and a fully-served plant drops out of the owed set again");

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
  const seededChurches = [
    plant.id,
    orphan.id,
    otherPlant.id,
    foreignChurch.id,
    racePlant.id,
    quietPlant,
    notSharingPlant,
    noAdminPlant,
    eligibleA,
    eligibleB,
  ];
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
    .where(inArray(organizationInvitations.targetChurchId, seededChurches));
  // The launch entity (#305/LS-001). Deleting the launch cascades its journal,
  // milestones and milestone/task links — but it must happen BEFORE `users`
  // below, because `launch_events.actor_user_id` points at the planter and that
  // FK does not cascade.
  await db.delete(launches).where(inArray(launches.churchId, seededChurches));

  // ...and then the ENTITIES themselves, innermost FK first. Deleting only the
  // child rows left every seeded church, user, network and sending church
  // behind, which made a second run on the same scratch database fail on the
  // starvation fixture's FIXED uuids — and, when this was ever pointed at a
  // shared database, salted it permanently.
  await db
    .delete(churchPrivacySettings)
    .where(inArray(churchPrivacySettings.churchId, seededChurches));
  await db.delete(users).where(
    inArray(
      users.id,
      [
        planter,
        adminA,
        adminB,
        sendingChurchAdmin,
        raceInviter,
        racePlanter,
      ].map((row) => row.id)
    )
  );
  await db.delete(churches).where(inArray(churches.id, seededChurches));
  await db
    .delete(sendingChurches)
    .where(
      inArray(sendingChurches.id, [otherSendingChurch.id, raceSendingChurch.id])
    );
  await db
    .delete(sendingNetworks)
    .where(inArray(sendingNetworks.id, [network.id, emptyNetwork.id]));

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
