import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  users,
  sendingChurches,
  sendingNetworks,
  organizationInvitations,
  associationEvents,
} from "@/db/schema";
import { discoveryProfiles } from "@/db/schema/discovery-profile";
import {
  invitationActorFromSession,
  bindOpenInvitationTargetQuery,
  resolveInvitationTarget,
} from "@/lib/invitations/core";
import {
  discoveryInvitationResponseStatement,
  severDiscoveryAssociationStatement,
  getDiscoveryAssociatesForOrg,
  getPendingDiscoveryInvitations,
} from "./associations";

/** Runs only inside the owner's disposable database suite. No provider calls. */
export function registerDiscoveryAssociationLiveTests(
  db: NeonHttpDatabase<Record<string, never>>
) {
  async function fixture(kind: "network" | "sending_church" = "network") {
    const userId = randomUUID(),
      orgId = randomUUID(),
      ownerId = randomUUID();
    const orgName = `Discovery org ${orgId}`;
    await db
      .insert(kind === "network" ? sendingNetworks : sendingChurches)
      .values({ id: orgId, name: orgName });
    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        email: `${userId}@example.test`,
        name: `Explorer ${userId}`,
        passwordHash: "scratch",
      })
      .returning();
    const [owner] = await db
      .insert(users)
      .values({
        id: ownerId,
        email: `${ownerId}@example.test`,
        passwordHash: "scratch",
        seat: "owner",
        ...(kind === "network"
          ? { sendingNetworkId: orgId }
          : { sendingChurchId: orgId }),
      })
      .returning();
    await db.insert(discoveryProfiles).values({ userId });
    const [invitation] = await db
      .insert(organizationInvitations)
      .values({
        type:
          kind === "network"
            ? "discovery_to_network"
            : "discovery_to_sending_church",
        inviterUserId: ownerId,
        inviteeEmail: user.email,
        targetUserId: userId,
        ...(kind === "network"
          ? { sendingNetworkId: orgId }
          : { sendingChurchId: orgId }),
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    return {
      user,
      owner,
      actor: invitationActorFromSession({ user }),
      manager: invitationActorFromSession({ user: owner }),
      invitation,
      orgId,
      orgName,
      kind,
    };
  }
  async function run(userId: string, statement: SQL) {
    const [, result] = await db.batch([
      db.execute(sql`select id from users where id=${userId}::uuid for update`),
      db.execute(statement),
    ]);
    return result.rows;
  }
  const profile = async (id: string) =>
    (
      await db
        .select()
        .from(discoveryProfiles)
        .where(eq(discoveryProfiles.userId, id))
    )[0];
  const audit = async (id: string) =>
    db
      .select()
      .from(associationEvents)
      .where(eq(associationEvents.discoveryUserId, id));

  test("discovery acceptance fills independent slots without tenancy and scopes org reads", async () => {
    const f = await fixture("network");
    assert.equal((await resolveInvitationTarget(f.user.email)).ok, true);
    assert.equal((await getPendingDiscoveryInvitations(f.actor)).length, 1);
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        )
      ).length,
      1
    );
    assert.equal((await profile(f.user.id)).sendingNetworkId, f.orgId);
    const sc = await fixture("sending_church");
    const [second] = await db
      .insert(organizationInvitations)
      .values({
        ...sc.invitation,
        id: randomUUID(),
        targetUserId: f.user.id,
        inviteeEmail: f.user.email,
      })
      .returning();
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(f.actor, second, "accepted")
        )
      ).length,
      1
    );
    assert.equal((await profile(f.user.id)).sendingChurchId, sc.orgId);
    assert.equal((await audit(f.user.id)).length, 2);
    const [user] = await db.select().from(users).where(eq(users.id, f.user.id));
    assert.deepEqual(
      [user.seat, user.churchId, user.sendingChurchId, user.sendingNetworkId],
      [null, null, null, null]
    );
    assert.equal(
      (await getDiscoveryAssociatesForOrg(f.manager)).some(
        (row) => row.userId === f.user.id
      ),
      true
    );
    const stranger = await fixture();
    assert.equal(
      (await getDiscoveryAssociatesForOrg(stranger.manager)).some(
        (row) => row.userId === f.user.id
      ),
      false
    );
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        )
      ).length,
      0
    );
    assert.equal((await audit(f.user.id)).length, 2);
  });

  test("discovery response refuses wrong identity, changed scope, expiry and occupied slot", async () => {
    const f = await fixture();
    const stranger = await fixture();
    assert.equal(
      (
        await run(
          stranger.user.id,
          discoveryInvitationResponseStatement(
            stranger.actor,
            f.invitation,
            "accepted"
          )
        )
      ).length,
      0
    );
    await db
      .update(organizationInvitations)
      .set({ inviteeEmail: stranger.user.email })
      .where(eq(organizationInvitations.id, f.invitation.id));
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        )
      ).length,
      0
    );
    await db
      .update(organizationInvitations)
      .set({ inviteeEmail: f.user.email, expiresAt: new Date(0) })
      .where(eq(organizationInvitations.id, f.invitation.id));
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "declined"
          )
        )
      ).length,
      0
    );
    await db
      .update(organizationInvitations)
      .set({
        expiresAt: new Date(Date.now() + 3600000),
        sendingNetworkId: stranger.orgId,
      })
      .where(eq(organizationInvitations.id, f.invitation.id));
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        )
      ).length,
      0
    );
    await db
      .update(organizationInvitations)
      .set({ sendingNetworkId: f.orgId })
      .where(eq(organizationInvitations.id, f.invitation.id));
    await db
      .update(discoveryProfiles)
      .set({ sendingNetworkId: stranger.orgId })
      .where(eq(discoveryProfiles.userId, f.user.id));
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        )
      ).length,
      0
    );
    assert.equal((await audit(f.user.id)).length, 0);
    assert.equal(
      (
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "declined"
          )
        )
      ).length,
      1
    );
    assert.equal((await profile(f.user.id)).sendingNetworkId, stranger.orgId);
    assert.equal((await audit(f.user.id)).length, 0);
  });

  test("discovery sever checks confirmation and owner scope; each winner audits once", async () => {
    const f = await fixture();
    await run(
      f.user.id,
      discoveryInvitationResponseStatement(f.actor, f.invitation, "accepted")
    );
    const stranger = await fixture();
    assert.equal(
      (
        await run(
          f.user.id,
          severDiscoveryAssociationStatement(
            stranger.manager,
            f.user.id,
            "network",
            f.orgId,
            f.user.name!,
            "remove"
          )
        )
      ).length,
      0
    );
    assert.equal(
      (
        await run(
          f.user.id,
          severDiscoveryAssociationStatement(
            f.actor,
            f.user.id,
            "network",
            f.orgId,
            "wrong",
            "leave"
          )
        )
      ).length,
      0
    );
    const results = await Promise.all([
      run(
        f.user.id,
        severDiscoveryAssociationStatement(
          f.actor,
          f.user.id,
          "network",
          f.orgId,
          f.orgName,
          "leave"
        )
      ),
      run(
        f.user.id,
        severDiscoveryAssociationStatement(
          f.manager,
          f.user.id,
          "network",
          f.orgId,
          f.user.name!,
          "remove"
        )
      ),
    ]);
    assert.equal(
      results.reduce((n, rows) => n + rows.length, 0),
      1
    );
    assert.equal((await profile(f.user.id)).sendingNetworkId, null);
    assert.equal(
      (await audit(f.user.id)).filter((row) => row.event === "disassociated")
        .length,
      1
    );
  });

  test("discovery claim rollback preserves invitation and profile; racing accepts select one org", async () => {
    const f = await fixture();
    await assert.rejects(
      db.batch([
        db.execute(
          sql`select id from users where id=${f.user.id}::uuid for update`
        ),
        db.execute(
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        ),
        db.execute(sql`select 1/0`),
      ])
    );
    assert.equal((await profile(f.user.id)).sendingNetworkId, null);
    assert.equal((await audit(f.user.id)).length, 0);
    const other = await fixture();
    const [second] = await db
      .insert(organizationInvitations)
      .values({
        ...other.invitation,
        id: randomUUID(),
        targetUserId: f.user.id,
        inviteeEmail: f.user.email,
      })
      .returning();
    const results = await Promise.all([
      run(
        f.user.id,
        discoveryInvitationResponseStatement(f.actor, f.invitation, "accepted")
      ),
      run(
        f.user.id,
        discoveryInvitationResponseStatement(f.actor, second, "accepted")
      ),
    ]);
    assert.equal(
      results.reduce((n, rows) => n + rows.length, 0),
      1
    );
    assert.equal((await audit(f.user.id)).length, 1);
    assert.ok(
      new Set<string>([f.orgId, other.orgId]).has(
        (await profile(f.user.id)).sendingNetworkId!
      )
    );
  });

  test("open invitation binds only its intended discovery account and remains answerable", async () => {
    for (const originalType of [
      "church_to_network",
      "sending_church_to_network",
      "church_to_sending_church",
    ] as const) {
      const sendingChurch = originalType === "church_to_sending_church";
      const f = await fixture(sendingChurch ? "sending_church" : "network");
      const [open] = await db
        .insert(organizationInvitations)
        .values({
          ...f.invitation,
          id: randomUUID(),
          targetUserId: null,
          type: originalType,
        })
        .returning();
      const other = await fixture();
      assert.equal(
        (
          await bindOpenInvitationTargetQuery(
            open.id,
            { targetUserId: other.user.id },
            other.user.id,
            new Date()
          )
        ).length,
        0
      );
      const [bound] = await bindOpenInvitationTargetQuery(
        open.id,
        { targetUserId: f.user.id },
        f.user.id,
        new Date()
      );
      assert.equal(
        bound.type,
        sendingChurch ? "discovery_to_sending_church" : "discovery_to_network"
      );
      assert.equal(
        (
          await run(
            f.user.id,
            discoveryInvitationResponseStatement(f.actor, bound, "accepted")
          )
        ).length,
        1
      );
      const acceptedProfile = await profile(f.user.id);
      assert.equal(
        sendingChurch
          ? acceptedProfile.sendingChurchId
          : acceptedProfile.sendingNetworkId,
        f.orgId
      );
    }
  });
  test("conversion races preserve associations and pending invitation targets", async () => {
    const { discoveryPlantCreationStatements } = await import("./create-plant");
    for (const change of ["accept", "leave"] as const) {
      const f = await fixture();
      if (change === "leave")
        await run(
          f.user.id,
          discoveryInvitationResponseStatement(
            f.actor,
            f.invitation,
            "accepted"
          )
        );
      const churchId = randomUUID();
      const write = {
        churchId,
        plantedBy: f.user.id,
        plantedByName: f.user.name,
        plantedByEmail: f.user.email,
        name: "Discovery conversion race",
        city: "",
        stateRegion: "",
        country: "",
      };
      await Promise.all([
        db.batch(
          discoveryPlantCreationStatements(write, {
            sendingChurchId: null,
            sendingNetworkId: change === "leave" ? f.orgId : null,
            shareActivityWithOversight: true,
          })
        ),
        run(
          f.user.id,
          change === "accept"
            ? discoveryInvitationResponseStatement(
                f.actor,
                f.invitation,
                "accepted"
              )
            : severDiscoveryAssociationStatement(
                f.actor,
                f.user.id,
                "network",
                f.orgId,
                f.orgName,
                "leave"
              )
        ),
      ]);
      const [account] = await db
        .select()
        .from(users)
        .where(eq(users.id, f.user.id));
      const remaining = await profile(f.user.id);
      const [invitation] = await db
        .select()
        .from(organizationInvitations)
        .where(eq(organizationInvitations.id, f.invitation.id));
      if (account.churchId) {
        assert.equal(account.churchId, churchId);
        assert.equal(remaining, undefined);
        const result = await db.execute<{ sending_network_id: string | null }>(
          sql`select sending_network_id from churches where id=${churchId}::uuid`
        );
        assert.equal(
          result.rows[0].sending_network_id,
          change === "leave" ? f.orgId : null
        );
        if (change === "accept") {
          assert.equal(invitation.targetUserId, null);
          assert.equal(invitation.targetChurchId, churchId);
          assert.equal(invitation.type, "church_to_network");
          assert.equal(invitation.status, "pending");
        }
      } else {
        assert.ok(remaining);
        assert.equal(
          remaining.sendingNetworkId,
          change === "accept" ? f.orgId : null
        );
        assert.equal(account.seat, null);
        assert.equal(invitation.targetUserId, f.user.id);
      }
    }
  });
}
