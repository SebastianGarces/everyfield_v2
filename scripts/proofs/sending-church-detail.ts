/** Real, disposable database proof; run once per fresh owned preview stack. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  churchPrivacySettings,
  organizationInvitations,
  persons,
  sendingChurches,
  sendingNetworks,
  users,
} from "@/db/schema";
import { getNetworkSendingChurchDetail } from "@/lib/oversight/sending-church-detail";
import { getOversightPlantDetail } from "@/lib/oversight/read";
import { listNetworkSendingChurches } from "@/lib/oversight/sending-churches";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, connection.pathname.slice(1));
  const [input, output, evidencePath] = process.argv.slice(2);
  for (const path of [input, output, evidencePath])
    assert.ok(path?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(input, "utf8"));
  assert.equal(fixture.database, identity.rows[0].name);
  const account = async (name: string) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, `${name}@preview.example.test`));
    assert.ok(user);
    return user;
  };
  const owner = await account("network-owner"),
    member = await account("network-member"),
    sendingOwner = await account("sending-owner"),
    planter = await account("owner");
  const networkId = owner.sendingNetworkId!;
  const sendingId = sendingOwner.sendingChurchId!;
  const [foreignNetwork] = await db
    .insert(sendingNetworks)
    .values({ name: "Foreign network canary" })
    .returning();
  const [foreignSending] = await db
    .insert(sendingChurches)
    .values({
      name: "Foreign sending canary",
      sendingNetworkId: foreignNetwork.id,
    })
    .returning();
  const [emptySending] = await db
    .insert(sendingChurches)
    .values({ name: "Empty sending church", sendingNetworkId: networkId })
    .returning();
  const [otherSending] = await db
    .insert(sendingChurches)
    .values({
      name: "Other member sending church",
      sendingNetworkId: networkId,
    })
    .returning();
  // A member sending church also has a plant outside this network. Its name must never be returned.
  await db
    .update(churches)
    .set({ sendingChurchId: sendingId, sendingNetworkId: foreignNetwork.id })
    .where(eq(churches.id, fixture.foreignChurchId));
  const [otherPlant] = await db
    .insert(churches)
    .values({
      name: "Other member plant",
      sendingChurchId: otherSending.id,
      sendingNetworkId: networkId,
    })
    .returning();
  const [sharedPlant] = await db
    .insert(churches)
    .values({
      name: "Shared aggregate plant",
      sendingChurchId: sendingId,
      sendingNetworkId: networkId,
    })
    .returning();
  const privateName = `PERSON-CANARY-${randomUUID()}`;
  await db.insert(persons).values({
    churchId: sharedPlant.id,
    firstName: privateName,
    lastName: "Private",
    email: "private-person@example.test",
    createdBy: planter.id,
  });
  const allOff = {
    sharePeople: false,
    shareMeetings: false,
    shareTasks: false,
    shareMinistryTeams: false,
    shareWiki: false,
  };
  await db
    .insert(churchPrivacySettings)
    .values({ churchId: fixture.primaryChurchId, ...allOff })
    .onConflictDoUpdate({
      target: churchPrivacySettings.churchId,
      set: allOff,
    });
  await db
    .insert(churchPrivacySettings)
    .values({ churchId: sharedPlant.id, sharePeople: true });

  const detail = await getNetworkSendingChurchDetail(owner, sendingId);
  assert.ok(detail);
  assert.deepEqual(
    detail.plants.map((p) => p.id).sort(),
    [fixture.primaryChurchId, sharedPlant.id].sort()
  );
  assert.deepEqual(
    await getNetworkSendingChurchDetail(member, sendingId),
    detail
  );
  assert.deepEqual(
    (await getNetworkSendingChurchDetail(owner, emptySending.id))?.plants,
    []
  );
  assert.deepEqual(
    (await getNetworkSendingChurchDetail(owner, otherSending.id))?.plants.map(
      (p) => p.id
    ),
    [otherPlant.id]
  );
  const roster = await listNetworkSendingChurches(owner);
  assert.equal(
    roster.find((row) => row.sendingChurchId === sendingId)?.plantCount,
    detail.plants.length
  );
  for (const actor of [owner, member]) {
    for (const id of [foreignSending.id, randomUUID(), "malformed"])
      assert.equal(await getNetworkSendingChurchDetail(actor, id), null);
    assert.equal(
      await getOversightPlantDetail(actor, fixture.foreignChurchId),
      null
    );
  }
  for (const actor of [sendingOwner, planter])
    assert.equal(await getNetworkSendingChurchDetail(actor, sendingId), null);
  const offDetail = await getOversightPlantDetail(
    member,
    fixture.primaryChurchId
  );
  assert.ok(offDetail);
  assert.ok(
    offDetail.sections.every((section) => section.state === "withheld")
  );
  const sharedDetail = await getOversightPlantDetail(member, sharedPlant.id);
  assert.ok(sharedDetail);
  assert.equal(
    sharedDetail.sections.find((section) => section.key === "people")?.state,
    "shared"
  );
  const projection = JSON.stringify({ detail, offDetail, sharedDetail });
  for (const forbidden of [
    privateName,
    "private-person@example.test",
    "passwordHash",
    "storageKey",
  ])
    assert.ok(!projection.includes(forbidden));
  assert.deepEqual(Object.keys(detail.plants[0]).sort(), [
    "currentPhase",
    "id",
    "name",
  ]);

  mock.module("@/lib/auth/session", {
    namedExports: { verifySession: async () => ({ user: member }) },
  });
  mock.module("next/cache", {
    namedExports: { refresh() {}, revalidatePath() {} },
  });
  const { createInvitationAction } =
    await import("@/app/(dashboard)/oversight/invitations/actions");
  const before = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations);
  const form = new FormData();
  form.set("inviteeEmail", "forbidden@example.test");
  await assert.rejects(() => createInvitationAction({}, form), /Forbidden/);
  assert.deepEqual(
    await db
      .select({ id: organizationInvitations.id })
      .from(organizationInvitations),
    before
  );

  writeFileSync(
    output,
    JSON.stringify(
      {
        ...fixture,
        sendingId,
        foreignSendingId: foreignSending.id,
        emptySendingId: emptySending.id,
        otherSendingId: otherSending.id,
        sharedPlantId: sharedPlant.id,
        privateName,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        database: identity.rows[0].name,
        memberOwnerReadParity: true,
        plantCountMatchesRoster: true,
        plantsInMember: detail.plants.length,
        emptyState: true,
        foreignAndUnknownRefused: true,
        sendingAndPlantAccountsRefused: true,
        sharingOffWithheld: true,
        sharingOnAggregatesOnly: true,
        privateIdentityAbsent: true,
        memberInvitationWriteRefused: true,
      },
      null,
      2
    )
  );
  console.log(
    "Sending-church detail proof passed; evidence and private browser manifest saved."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
