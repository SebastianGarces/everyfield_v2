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

import { and, eq, inArray, like } from "drizzle-orm";

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
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  NOT_AUTHORIZED_MESSAGE,
  PLANT_NOT_IN_ORG_MESSAGE,
  acceptInvitationAs,
  createInvitationAs,
  declineInvitationAs,
  insertInvitation,
  NOT_IN_A_NETWORK_MESSAGE,
  SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE,
  invitationActorFromSession,
  leaveNetworkAsSendingChurchAdmin,
  leaveOversightOrgAs,
  removePlantFromOrgAs,
  type InvitationActor,
  type InvitationRequest,
} from "@/lib/invitations/core";
import { getAssociationHistoryForOrg } from "@/lib/invitations/history";
import { listOversightAdminsOfOrg } from "@/lib/notifications/oversight";
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
      // A SECOND admin of the SAME sending church. §9's bypass needs two
      // addresses that resolve to one organization — which is the whole reason
      // an address-scoped cap was not the cap (#304 ruling 4, fix 4).
      {
        email: address("sc-admin-2"),
        passwordHash: "x",
        role: "sending_church_admin" as const,
        sendingChurchId: sendingChurch.id,
      },
      // A NETWORK admin carrying a stray `sending_church_id`. Both org FKs live
      // on one `users` row, and this row is the one item 6 exists for: under
      // "any oversight role" it qualified as an admin of the SENDING CHURCH and
      // received that org's own notifications.
      {
        email: address("dual-fk-net-admin"),
        passwordHash: "x",
        role: "network_admin" as const,
        sendingNetworkId: otherNetwork.id,
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
    scAdmin2,
    dualFkNetAdmin,
  ] = seeded;

  id("planter", planter.id);
  id("team member (plant)", teammate.id);
  id("sending church admin", scAdmin.id);
  id("network admin", netAdmin.id);
  id("other sending church admin", otherScAdmin.id);
  id("other network admin", otherNetAdmin.id);
  id("team member (sending ch.)", scTeammate.id);
  id("sending church admin #2", scAdmin2.id);
  id("network admin w/ stray SC fk", dualFkNetAdmin.id);

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

    // THE DECLINE HALF FIRST, so the accept below needs no reset. Declining
    // leaves `sending_churches.sending_network_id` untouched, which is exactly
    // the state the second invitation needs — nulling it between the two would
    // be an out-of-band write mid-sequence, the reproducibility failure that
    // blocked this issue's first build.
    const declined = await declineInvitationAs(
      actorFor(scAdmin),
      invitation.id
    );
    assert.equal(declined.status, "declined");
    assert.equal(declined.respondedBy, scAdmin.id);
    const [notAssociated] = await db
      .select({ sendingNetworkId: sendingChurches.sendingNetworkId })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, sendingChurch.id))
      .limit(1);
    assert.equal(notAssociated.sendingNetworkId, null);
    ok("the sending church's admin declined; nothing was associated");

    const acceptInvite = await insertInvitation({
      type: "sending_church_to_network",
      inviterUserId: netAdmin.id,
      inviteeEmail: scAdmin.email,
      targetChurchId: null,
      targetSendingChurchId: sendingChurch.id,
      sendingChurchId: null,
      sendingNetworkId: network.id,
    });
    createdInvitationIds.push(acceptInvite.id);
    id("sc→network invitation (2)", acceptInvite.id);

    const accepted = await acceptInvitationAs(
      actorFor(scAdmin),
      acceptInvite.id
    );
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.respondedBy, scAdmin.id);

    const [associatedOrg] = await db
      .select({ sendingNetworkId: sendingChurches.sendingNetworkId })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, sendingChurch.id))
      .limit(1);
    assert.equal(associatedOrg.sendingNetworkId, network.id);
    ok("accept associated the sending church with the network");

    // ------------------------------------------------------------------------
    // THE ACCEPTANCE CRITERION, NOW REQUIRED — #351 LANDED (migration 0035).
    //
    // #304's WS3 AC has three clauses across the two answers:
    //
    //   "Accept associates the sending church with the network via the existing
    //    service contract, WRITES AN `association_events` ROW, and NOTIFIES THE
    //    NETWORK on the milestone rail; decline updates status and NOTIFIES,
    //    mirroring the planter flow."
    //
    // Until 0035 this block PRINTED the miss and asserted the ABSENCE of all
    // three rows, because both target tables made a CHURCH their mandatory
    // tenant and a sending church joining a network names none. Ruling #351
    // settled the shape — a subject discriminator on `association_events`, a
    // recipient anchor on `notifications` — and the three assertions are
    // therefore flipped to REQUIRE the rows, exactly as the tripwire said they
    // would have to be. A green run of this section is now evidence FOR the AC
    // rather than a documented miss.
    // ------------------------------------------------------------------------
    const scAudit = await db
      .select({
        subjectType: associationEvents.subjectType,
        churchId: associationEvents.churchId,
        subjectSendingChurchId: associationEvents.subjectSendingChurchId,
        orgType: associationEvents.orgType,
        orgId: associationEvents.orgId,
        event: associationEvents.event,
        actorUserId: associationEvents.actorUserId,
      })
      .from(associationEvents)
      .where(eq(associationEvents.sourceInvitationId, acceptInvite.id));

    assert.equal(scAudit.length, 1, "the accept wrote exactly one audit row");
    assert.equal(scAudit[0].subjectType, "sending_church");
    assert.equal(scAudit[0].subjectSendingChurchId, sendingChurch.id);
    // The CHURCH column is null and the CHECK is what guarantees it: exactly one
    // subject, never two, never none.
    assert.equal(scAudit[0].churchId, null);
    assert.equal(scAudit[0].orgType, "network");
    assert.equal(scAudit[0].orgId, network.id);
    assert.equal(scAudit[0].event, "associated");
    assert.equal(scAudit[0].actorUserId, scAdmin.id);
    ok(
      "the accept wrote an association_events row with a sending-church subject"
    );

    // `composeMilestone` keys every milestone `<type>:<anchorId>:<occurrence>`
    // with the invitation id as the occurrence, so these match the rows THIS
    // answer wrote and nothing the earlier steps enqueued.
    const acceptNotices = await db
      .select({
        anchorType: notifications.anchorType,
        anchorOrgId: notifications.anchorOrgId,
        churchId: notifications.churchId,
        type: notifications.type,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, netAdmin.id),
          like(notifications.dedupeKey, `%:${acceptInvite.id}`)
        )
      );

    assert.equal(acceptNotices.length, 1, "the network was notified once");
    assert.equal(acceptNotices[0].anchorType, "network");
    assert.equal(acceptNotices[0].anchorOrgId, network.id);
    assert.equal(acceptNotices[0].churchId, null);
    assert.equal(
      acceptNotices[0].type,
      "oversight.milestone.invitation_accepted"
    );
    ok("the accept notified the network on the milestone rail, anchored to it");

    const declineNotices = await db
      .select({
        anchorType: notifications.anchorType,
        anchorOrgId: notifications.anchorOrgId,
        type: notifications.type,
        title: notifications.title,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, netAdmin.id),
          like(notifications.dedupeKey, `%:${invitation.id}`)
        )
      );

    assert.equal(declineNotices.length, 1, "the decline notified the network");
    assert.equal(declineNotices[0].anchorType, "network");
    assert.equal(declineNotices[0].anchorOrgId, network.id);
    assert.equal(
      declineNotices[0].type,
      "oversight.milestone.invitation_declined"
    );
    // A decline names the ADDRESS THE ORG TYPED and nothing else (ruled
    // 2026-08-09): the refused network never associated, so the sending
    // church's name is not theirs to learn.
    assert.match(declineNotices[0].title, new RegExp(scAdmin.email));
    assert.doesNotMatch(declineNotices[0].title, /G3 Sending Church/);
    ok("the decline notified the network, naming the address and not the org");

    // ------------------------------------------------------------------------
    console.log("\n--- 8. OV-013: the sending church leaves its network ---");
    // ------------------------------------------------------------------------

    // A member of the sending church who is not its admin is refused
    // SERVER-SIDE. The dialog is a deliberateness control; this is the rule.
    assert.equal(
      await refusal(leaveNetworkAsSendingChurchAdmin(actorFor(scTeammate))),
      SENDING_CHURCH_ADMIN_ONLY_SEVER_MESSAGE
    );
    // …and so is the admin of a DIFFERENT sending church, structurally: the
    // action takes NO argument, so `otherScAdmin` can only ever sever their own
    // sending church's association — which does not exist.
    assert.equal(
      await refusal(leaveNetworkAsSendingChurchAdmin(actorFor(otherScAdmin))),
      NOT_IN_A_NETWORK_MESSAGE
    );
    ok("only the sending church's own ADMIN may sever, server-side");

    const left = await leaveNetworkAsSendingChurchAdmin(actorFor(scAdmin));
    assert.deepEqual(left, { orgType: "network", orgId: network.id });

    const [orgAfterSever] = await db
      .select({ sendingNetworkId: sendingChurches.sendingNetworkId })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, sendingChurch.id))
      .limit(1);
    assert.equal(orgAfterSever.sendingNetworkId, null);

    const severEvents = await db
      .select({
        id: associationEvents.id,
        subjectType: associationEvents.subjectType,
        subjectSendingChurchId: associationEvents.subjectSendingChurchId,
        churchId: associationEvents.churchId,
        event: associationEvents.event,
        actorUserId: associationEvents.actorUserId,
        sourceInvitationId: associationEvents.sourceInvitationId,
      })
      .from(associationEvents)
      .where(
        and(
          eq(associationEvents.subjectSendingChurchId, sendingChurch.id),
          eq(associationEvents.event, "disassociated")
        )
      );

    assert.equal(
      severEvents.length,
      1,
      "the sever wrote exactly one audit row"
    );
    assert.equal(severEvents[0].subjectType, "sending_church");
    assert.equal(severEvents[0].churchId, null);
    assert.equal(severEvents[0].actorUserId, scAdmin.id);
    // A sever answers no invitation, so the column says so rather than guessing.
    assert.equal(severEvents[0].sourceInvitationId, null);
    id("sever audit row", severEvents[0].id);
    ok("the sever nulled the FK and wrote its audit row together");

    const severNotices = await db
      .select({
        anchorType: notifications.anchorType,
        anchorOrgId: notifications.anchorOrgId,
        type: notifications.type,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, netAdmin.id),
          like(notifications.dedupeKey, `%:${severEvents[0].id}`)
        )
      );
    assert.equal(severNotices.length, 1, "the network was told they left");
    assert.equal(severNotices[0].anchorType, "network");
    assert.equal(severNotices[0].anchorOrgId, network.id);
    assert.equal(severNotices[0].type, "oversight.milestone.association_ended");
    ok("the network was notified of the sever, anchored to itself");

    // A second sever writes nothing: the read refuses, and the statement's own
    // WHERE would refuse too.
    assert.equal(
      await refusal(leaveNetworkAsSendingChurchAdmin(actorFor(scAdmin))),
      NOT_IN_A_NETWORK_MESSAGE
    );
    ok("a repeated sever is refused and writes no second audit row");

    // ------------------------------------------------------------------------
    console.log("\n--- 9. ruling 4: the HR4 security fixes, on real rows ---");
    // ------------------------------------------------------------------------
    //
    // Every assertion below goes through `createInvitationAs` — the same
    // function `createInvitation` calls once it has minted an actor — so these
    // are the forged requests themselves, not a description of them.
    //
    // By this point in the run the plant holds NEITHER oversight FK and the
    // sending church has left its network, so every slot the section aims at is
    // free. A refusal here is therefore the fix and never a slot collision.
    // ------------------------------------------------------------------------

    // FIX 1 — the forged target. `otherNetAdmin` invites an address nobody has
    // registered, and names this run's plant in the request. Before the fix the
    // spread let that key through: the invitation was written with
    // `target_church_id = plant.id`, the planter saw a real invitation from an
    // org they never heard of, and Accept enrolled the plant.
    const forgedAddress = address("forged-open");
    const forged = await createInvitationAs(actorFor(otherNetAdmin), {
      inviteeEmail: forgedAddress,
      inviteAs: "church",
      targetChurchId: plant.id,
      targetSendingChurchId: sendingChurch.id,
    } as InvitationRequest);
    createdInvitationIds.push(forged.id);
    id("forged-target invitation", forged.id);

    assert.equal(forged.targetChurchId, null);
    assert.equal(forged.targetSendingChurchId, null);
    assert.equal(forged.type, "church_to_network");
    assert.equal(forged.sendingNetworkId, otherNetwork.id);
    ok("a caller-supplied target is dropped: the row is an OPEN invitation");

    // …and the plant is untouched by it. The FK is what an accept would have
    // written, so its being null is the property that matters.
    const afterForgery = await plantRow(plant.id);
    assert.equal(afterForgery.sendingNetworkId, null);
    assert.equal(afterForgery.sendingChurchId, null);
    ok("the named plant gained no association from the forged request");

    // FIX 4 — the cap counts the TARGET, not the address. Two addresses, one
    // organization: `scAdmin` and `scAdmin2` both resolve to this run's sending
    // church, which is how an org used to buy a fresh allowance by typing a
    // colleague's email.
    //
    // First, the duplicate check. One pending invitation aimed at the sending
    // church makes a second one — under the OTHER address — a duplicate.
    const firstTargeted = await createInvitationAs(actorFor(otherNetAdmin), {
      inviteeEmail: scAdmin.email,
      inviteAs: "sending_church",
    });
    createdInvitationIds.push(firstTargeted.id);
    id("targeted invitation #1", firstTargeted.id);
    assert.equal(firstTargeted.targetSendingChurchId, sendingChurch.id);

    assert.equal(
      await refusal(
        createInvitationAs(actorFor(otherNetAdmin), {
          inviteeEmail: scAdmin2.email,
          inviteAs: "sending_church",
        })
      ),
      ACCOUNT_NOT_INVITABLE_MESSAGE
    );
    ok("a second address for the SAME org is a duplicate, in the one message");

    // Now the rate cap. Answering clears the duplicate but must NOT refund the
    // allowance — the abuse is a decline–reinvite loop, so a declined row still
    // counts. Three rows aimed at this sending church, spread over the two
    // addresses, and the fourth attempt is refused even though its own address
    // has been used only once.
    await declineInvitationAs(actorFor(scAdmin), firstTargeted.id);

    const secondTargeted = await createInvitationAs(actorFor(otherNetAdmin), {
      inviteeEmail: scAdmin2.email,
      inviteAs: "sending_church",
    });
    createdInvitationIds.push(secondTargeted.id);
    id("targeted invitation #2", secondTargeted.id);
    await declineInvitationAs(actorFor(scAdmin2), secondTargeted.id);

    const thirdTargeted = await createInvitationAs(actorFor(otherNetAdmin), {
      inviteeEmail: scAdmin.email,
      inviteAs: "sending_church",
    });
    createdInvitationIds.push(thirdTargeted.id);
    id("targeted invitation #3", thirdTargeted.id);
    await declineInvitationAs(actorFor(scAdmin), thirdTargeted.id);

    assert.equal(
      await refusal(
        createInvitationAs(actorFor(otherNetAdmin), {
          inviteeEmail: scAdmin2.email,
          inviteAs: "sending_church",
        })
      ),
      ACCOUNT_NOT_INVITABLE_MESSAGE
    );
    ok("the 4th invitation to one ORG is capped, across two addresses");

    // ITEM 6 — the audience of an org's own milestone is the role that
    // administers THAT KIND of org. `dualFkNetAdmin` is a network admin of
    // `otherNetwork` carrying a stray `sending_church_id` for this run's
    // sending church.
    const scAudience = await listOversightAdminsOfOrg({
      sendingChurchId: sendingChurch.id,
      sendingNetworkId: null,
    });
    const scAudienceIds = scAudience.map((row) => row.id);

    assert.ok(scAudienceIds.includes(scAdmin.id));
    assert.ok(scAudienceIds.includes(scAdmin2.id));
    assert.ok(
      !scAudienceIds.includes(dualFkNetAdmin.id),
      "a network admin with a stray sending_church_id is not this org's admin"
    );
    // …and the church-level member of the sending church never was.
    assert.ok(!scAudienceIds.includes(scTeammate.id));
    ok("a sending church's audience is its OWN admins, by role and by FK");

    const netAudience = await listOversightAdminsOfOrg({
      sendingChurchId: null,
      sendingNetworkId: otherNetwork.id,
    });
    const netAudienceIds = netAudience.map((row) => row.id);
    assert.ok(netAudienceIds.includes(dualFkNetAdmin.id));
    assert.ok(netAudienceIds.includes(otherNetAdmin.id));
    ok("…and the same row IS an admin of the network it actually administers");

    console.log(
      "\nALL ASSERTIONS PASSED — #304 WS3's audit-row and milestone clauses are" +
        "\nnow REQUIRED by this harness (ruling #351, migration 0035), OV-013's" +
        "\naudited sever is exercised end to end, and ruling 4's HR4 fixes are" +
        "\nexercised as real forged requests (§9)."
    );
  } finally {
    if (KEEP) {
      console.log("\n--kept: fixtures left in place for inspection");
      return;
    }

    console.log("\n--- cleanup (deletes ONLY the rows above) ---");
    await db.delete(notifications).where(eq(notifications.churchId, plant.id));
    // The ORG-ANCHORED rows this run wrote (#304 WS3): they carry no
    // `church_id`, so the delete above cannot reach them. Scoped to the two
    // networks and the sending church THIS run created, so it still touches
    // nothing it did not make. §9's declines are anchored to `otherNetwork`.
    await db
      .delete(notifications)
      .where(
        inArray(notifications.anchorOrgId, [
          network.id,
          otherNetwork.id,
          sendingChurch.id,
        ])
      );
    await db
      .delete(associationEvents)
      .where(eq(associationEvents.churchId, plant.id));
    await db
      .delete(associationEvents)
      .where(eq(associationEvents.subjectSendingChurchId, sendingChurch.id));
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
