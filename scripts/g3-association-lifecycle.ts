/**
 * G3 harness for the ASSOCIATION LIFECYCLE (#304 — OV-007a/b, OV-010, OV-011,
 * and WS3's sending-church answering path). Real database.
 *
 * ----------------------------------------------------------------------------
 * Why this exists as its own harness
 * ----------------------------------------------------------------------------
 *
 * #304's first attempt was blocked at HR4 partly on REPRODUCIBILITY: the G3
 * report cited entity ids the verifier could not find, no `association_events`
 * row with `org_type = 'sending_church'` had ever existed, and an FK was
 * restored by direct SQL between two steps of a sequence reported as
 * browser-driven. So the headline claim — "a plant associated with BOTH a
 * sending church and a network keeps the other when one is severed" — had never
 * actually been run.
 *
 * This script is the answer to all three, and it is written to be handed to a
 * verifier verbatim:
 *
 *   * IT PRINTS EVERY ID IT USES, as it creates them, so the evidence bundle
 *     names rows that exist while the run is in flight;
 *   * IT MUTATES ONLY THROUGH THE PRODUCT PATH. Between the first assertion and
 *     the last, every write goes through `acceptInvitationAs`,
 *     `removePlantFromOrgAs` or `leaveOversightOrgAs` — the same functions the
 *     server actions call. The only raw writes are the fixture INSERTs before
 *     the sequence starts and the cleanup DELETEs after it ends, both announced;
 *   * IT LEAVES SEEDED ENTITIES AS FOUND. It creates its own network, sending
 *     church, plant and users, and deletes exactly those at the end. It never
 *     reads, updates or deletes a row it did not create, so it is safe to run
 *     against the shared development branch — unlike
 *     `scripts/g3-oversight-model.ts`, which is scratch-database only.
 *
 *   pnpm exec tsx scripts/g3-association-lifecycle.ts
 *
 * Pass `--keep` to skip the cleanup when a verifier wants to inspect the rows
 * afterwards; the ids are printed either way.
 */
import assert from "node:assert/strict";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  associationEvents,
  churchPrivacySettings,
  churches,
  notifications,
  organizationInvitations,
  sendingChurches,
  sendingNetworks,
  users,
} from "@/db/schema";
import { getAccessibleChurchIds } from "@/lib/auth/access";
import {
  NOT_AUTHORIZED_MESSAGE,
  PLANT_NOT_IN_ORG_MESSAGE,
  acceptInvitationAs,
  declineInvitationAs,
  insertInvitation,
  invitationActorFromSession,
  leaveOversightOrgAs,
  removePlantFromOrgAs,
  type InvitationActor,
} from "@/lib/invitations/core";
import { getAssociationHistoryForOrg } from "@/lib/invitations/history";
import { listOversightPlants } from "@/lib/oversight/read";

const KEEP = process.argv.includes("--keep");

function ok(label: string) {
  console.log(`PASS  ${label}`);
}

function id(label: string, value: string) {
  console.log(`ID    ${label.padEnd(28)} ${value}`);
}

type SeedUser = typeof users.$inferSelect;

function actorFor(user: SeedUser): InvitationActor {
  return invitationActorFromSession({ user });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    assert.fail("expected a refusal");
  } catch (error) {
    return (error as Error).message;
  }
}

async function plantRow(churchId: string) {
  const [row] = await db
    .select({
      sendingChurchId: churches.sendingChurchId,
      sendingNetworkId: churches.sendingNetworkId,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);
  return row;
}

async function main() {
  const stamp = Date.now();
  const address = (who: string) => `g3-${who}-${stamp}@example.test`;

  // --------------------------------------------------------------------------
  // FIXTURES — the only raw writes before the sequence begins.
  //
  // The shape the first build never built: ONE plant holding BOTH oversight
  // FKs. The two are independent (`memory/invariants.md` → Multi-Tenancy), so
  // this is the only configuration in which "severing one keeps the other" is
  // even a question.
  // --------------------------------------------------------------------------
  console.log("\n--- fixtures (raw inserts, before any product call) ---");

  const [network] = await db
    .insert(sendingNetworks)
    .values({ name: `G3 Network ${stamp}` })
    .returning();
  id("network", network.id);

  const [otherNetwork] = await db
    .insert(sendingNetworks)
    .values({ name: `G3 Other Network ${stamp}` })
    .returning();
  id("other network", otherNetwork.id);

  const [sendingChurch] = await db
    .insert(sendingChurches)
    .values({ name: `G3 Sending Church ${stamp}` })
    .returning();
  id("sending church", sendingChurch.id);

  const [otherSendingChurch] = await db
    .insert(sendingChurches)
    .values({ name: `G3 Other Sending Church ${stamp}` })
    .returning();
  id("other sending church", otherSendingChurch.id);

  // The dual-associated plant. BOTH FKs set, in one row.
  const [plant] = await db
    .insert(churches)
    .values({
      name: `G3 Dual Plant ${stamp}`,
      sendingChurchId: sendingChurch.id,
      sendingNetworkId: network.id,
      onboardingCompletedAt: new Date(),
    })
    .returning();
  id("plant (both FKs set)", plant.id);

  const seeded = await db
    .insert(users)
    .values([
      {
        email: address("planter"),
        passwordHash: "x",
        role: "planter" as const,
        churchId: plant.id,
      },
      {
        email: address("teammate"),
        passwordHash: "x",
        role: "team_member" as const,
        churchId: plant.id,
      },
      {
        email: address("sc-admin"),
        passwordHash: "x",
        role: "sending_church_admin" as const,
        sendingChurchId: sendingChurch.id,
      },
      {
        email: address("net-admin"),
        passwordHash: "x",
        role: "network_admin" as const,
        sendingNetworkId: network.id,
      },
      {
        email: address("other-sc-admin"),
        passwordHash: "x",
        role: "sending_church_admin" as const,
        sendingChurchId: otherSendingChurch.id,
      },
      {
        email: address("other-net-admin"),
        passwordHash: "x",
        role: "network_admin" as const,
        sendingNetworkId: otherNetwork.id,
      },
      {
        email: address("sc-teammate"),
        passwordHash: "x",
        role: "team_member" as const,
        sendingChurchId: sendingChurch.id,
      },
    ])
    .returning();

  const [
    planter,
    teammate,
    scAdmin,
    netAdmin,
    otherScAdmin,
    otherNetAdmin,
    scTeammate,
  ] = seeded;

  id("planter", planter.id);
  id("team member (plant)", teammate.id);
  id("sending church admin", scAdmin.id);
  id("network admin", netAdmin.id);
  id("other sending church admin", otherScAdmin.id);
  id("other network admin", otherNetAdmin.id);
  id("team member (sending ch.)", scTeammate.id);

  await db
    .insert(churchPrivacySettings)
    .values({ churchId: plant.id, updatedBy: planter.id });

  const createdUserIds = seeded.map((user) => user.id);
  const createdInvitationIds: string[] = [];

  try {
    console.log("\n--- 1. the fixture really is dual-associated ---");
    const before = await plantRow(plant.id);
    assert.equal(before.sendingChurchId, sendingChurch.id);
    assert.equal(before.sendingNetworkId, network.id);
    ok("the plant holds BOTH oversight FKs before anything is severed");

    // Both orgs can see it, which is what makes the sever observable.
    assert.ok((await getAccessibleChurchIds(scAdmin)).includes(plant.id));
    assert.ok((await getAccessibleChurchIds(netAdmin)).includes(plant.id));
    ok("both orgs reach the plant through getAccessibleChurchIds");

    console.log("\n--- 2. an admin of ANOTHER org cannot sever this one ---");
    // Same message a nonexistent plant gets: a distinguishable refusal would
    // answer questions about another org's portfolio, one guessed uuid at a
    // time. Nothing is written — asserted immediately below.
    assert.equal(
      await refusal(removePlantFromOrgAs(actorFor(otherScAdmin), plant.id)),
      PLANT_NOT_IN_ORG_MESSAGE
    );
    assert.equal(
      await refusal(removePlantFromOrgAs(actorFor(otherNetAdmin), plant.id)),
      PLANT_NOT_IN_ORG_MESSAGE
    );
    const afterForged = await plantRow(plant.id);
    assert.equal(afterForged.sendingChurchId, sendingChurch.id);
    assert.equal(afterForged.sendingNetworkId, network.id);
    ok("a foreign org's removal is refused and writes NOTHING");

    // …and no church-level role can use this path at all (OV-010's mirror).
    for (const who of [planter, teammate]) {
      const message = await refusal(
        removePlantFromOrgAs(actorFor(who), plant.id)
      );
      assert.match(message, /Only a sending church or network admin/);
    }
    ok("no church-level role can remove a plant from an organization");

    console.log(
      "\n--- 3. THE DUAL-ASSOCIATION AC: sever ONE, keep the other ---"
    );
    const removal = await removePlantFromOrgAs(actorFor(scAdmin), plant.id);
    assert.deepEqual(
      { orgType: removal.orgType, orgId: removal.orgId },
      { orgType: "sending_church", orgId: sendingChurch.id }
    );

    const afterSever = await plantRow(plant.id);
    assert.equal(
      afterSever.sendingChurchId,
      null,
      "the severed FK is not null"
    );
    assert.equal(
      afterSever.sendingNetworkId,
      network.id,
      "THE OTHER ASSOCIATION DID NOT SURVIVE — this is the AC"
    );
    ok("the sending church association ended; the NETWORK one survived");

    console.log("\n--- 4. the plant leaves the severing org's scope only ---");
    assert.ok(!(await getAccessibleChurchIds(scAdmin)).includes(plant.id));
    assert.ok((await getAccessibleChurchIds(netAdmin)).includes(plant.id));

    const scRoster = await listOversightPlants(scAdmin);
    const netRoster = await listOversightPlants(netAdmin);
    assert.ok(!scRoster.some((row) => row.churchId === plant.id));
    assert.ok(netRoster.some((row) => row.churchId === plant.id));
    ok("it left /oversight/plants for the sending church, not for the network");

    console.log("\n--- 5. the audit row, and who may read it ---");
    const scHistory = await getAssociationHistoryForOrg(
      { orgType: "sending_church", orgId: sendingChurch.id },
      plant.id
    );
    assert.equal(scHistory.length, 1);
    assert.equal(scHistory[0].event, "disassociated");
    id("association_events row", scHistory[0].id);

    // OV-011 with Hierarchical Access Control: reaching a plant is not
    // permission to name the orgs behind it. The network's own history of this
    // plant is empty — the sever it did not take part in is not its business.
    const netHistory = await getAssociationHistoryForOrg(
      { orgType: "network", orgId: network.id },
      plant.id
    );
    assert.equal(
      netHistory.length,
      0,
      "the network can read the sending church's sever"
    );
    ok("the history read is scoped to the caller's OWN org");

    console.log("\n--- 6. the planter's own sever, on the surviving org ---");
    // A team member of the plant may not (OV-010), and the refusal is before
    // any write.
    assert.match(
      await refusal(leaveOversightOrgAs(actorFor(teammate), "network")),
      /Only the church planter/
    );
    const afterTeammate = await plantRow(plant.id);
    assert.equal(afterTeammate.sendingNetworkId, network.id);

    await leaveOversightOrgAs(actorFor(planter), "network");
    const afterLeave = await plantRow(plant.id);
    assert.equal(afterLeave.sendingNetworkId, null);
    assert.equal(afterLeave.sendingChurchId, null);
    ok("the planter left the network; the plant is now independent");

    console.log(
      "\n--- 7. WS3: a sending church answers a network invitation ---"
    );
    const invitation = await insertInvitation({
      type: "sending_church_to_network",
      inviterUserId: netAdmin.id,
      inviteeEmail: scAdmin.email,
      targetChurchId: null,
      targetSendingChurchId: sendingChurch.id,
      sendingChurchId: null,
      sendingNetworkId: network.id,
    });
    createdInvitationIds.push(invitation.id);
    id("sc→network invitation", invitation.id);

    // A member of the target sending church who is not its admin is refused
    // SERVER-SIDE — the WS3 acceptance contract (`core.ts`, the
    // `sending_church_to_network` arm), not a hidden button.
    assert.equal(
      await refusal(acceptInvitationAs(actorFor(scTeammate), invitation.id)),
      NOT_AUTHORIZED_MESSAGE
    );
    assert.equal(
      await refusal(declineInvitationAs(actorFor(scTeammate), invitation.id)),
      NOT_AUTHORIZED_MESSAGE
    );
    // …and so is the admin of a DIFFERENT sending church.
    assert.equal(
      await refusal(acceptInvitationAs(actorFor(otherScAdmin), invitation.id)),
      NOT_AUTHORIZED_MESSAGE
    );
    ok("only the target sending church's ADMIN may answer");

    const accepted = await acceptInvitationAs(actorFor(scAdmin), invitation.id);
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.respondedBy, scAdmin.id);

    const [associatedOrg] = await db
      .select({ sendingNetworkId: sendingChurches.sendingNetworkId })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, sendingChurch.id))
      .limit(1);
    assert.equal(associatedOrg.sendingNetworkId, network.id);
    ok("accept associated the sending church with the network");

    // The documented residual (`memory/invariants.md` → Multi-Tenancy): this
    // association is recorded by the INVITATION ROW and nothing else, because
    // both `association_events.church_id` and `notifications.church_id` are NOT
    // NULL and its subject is a sending church. Asserted so the day a subject
    // column lands, this line fails and is updated deliberately.
    const scAudit = await db
      .select({ id: associationEvents.id })
      .from(associationEvents)
      .where(eq(associationEvents.sourceInvitationId, invitation.id));
    assert.equal(
      scAudit.length,
      0,
      "an association_events row appeared for a sending church — update the invariant"
    );
    ok("sc→network is recorded by the invitation row only (known residual)");

    console.log("\nALL ASSERTIONS PASSED");
  } finally {
    if (KEEP) {
      console.log("\n--kept: fixtures left in place for inspection");
      return;
    }

    console.log("\n--- cleanup (deletes ONLY the rows above) ---");
    await db.delete(notifications).where(eq(notifications.churchId, plant.id));
    await db
      .delete(associationEvents)
      .where(eq(associationEvents.churchId, plant.id));
    await db
      .delete(organizationInvitations)
      .where(inArray(organizationInvitations.inviterUserId, createdUserIds));
    await db
      .delete(churchPrivacySettings)
      .where(eq(churchPrivacySettings.churchId, plant.id));
    await db.delete(users).where(inArray(users.id, createdUserIds));
    await db.delete(churches).where(eq(churches.id, plant.id));
    await db
      .delete(sendingChurches)
      .where(
        inArray(sendingChurches.id, [sendingChurch.id, otherSendingChurch.id])
      );
    await db
      .delete(sendingNetworks)
      .where(inArray(sendingNetworks.id, [network.id, otherNetwork.id]));
    console.log("cleanup done — the database is as it was found");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
