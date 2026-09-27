import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { db } from "../src/db";
import {
  churches,
  users,
  persons,
  tasks,
  churchMeetings,
  sendingChurches,
  sendingNetworks,
  coachAssignments,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const sql = neon(connection.href);
  const [identity] = await sql`select current_database() as name`;
  assert.equal(identity.name, connection.pathname.slice(1));
  const output = process.argv[2];
  assert.ok(output, "Private fixture manifest output path required");
  const id = (name: string) => {
    const digest = createHash("sha256")
      .update("everyfield-preview:" + name)
      .digest("hex");
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  };
  const password = process.env.SEED_ADMIN_PASSWORD!;
  assert.ok(password);
  const passwordHash = await hashPassword(password);
  const networkId = id("network"),
    sendingChurchId = id("sending");
  await db
    .insert(sendingNetworks)
    .values({ id: networkId, name: "Preview Network" })
    .onConflictDoNothing();
  await db
    .insert(sendingChurches)
    .values({
      id: sendingChurchId,
      name: "Preview Sending Church",
      sendingNetworkId: networkId,
    })
    .onConflictDoNothing();
  for (const key of ["primary", "foreign"]) {
    await db
      .insert(churches)
      .values({
        id: id(key),
        name: `Preview ${key} plant`,
        currentPhase: 2,
        onboardingCompletedAt: new Date("2026-01-01"),
        leadershipStatus: "planter_confirmed",
        ...(key === "primary"
          ? { sendingChurchId, sendingNetworkId: networkId }
          : {}),
      })
      .onConflictDoNothing();
  }
  const accounts = [
    { name: "owner", seat: "owner" as const, churchId: id("primary") },
    { name: "admin", seat: "admin" as const, churchId: id("primary") },
    { name: "member", seat: "member" as const, churchId: id("primary") },
    { name: "foreign-owner", seat: "owner" as const, churchId: id("foreign") },
    { name: "coach", seat: null },
    {
      name: "network-owner",
      seat: "owner" as const,
      sendingNetworkId: networkId,
    },
    {
      name: "network-member",
      seat: "member" as const,
      sendingNetworkId: networkId,
    },
    { name: "sending-owner", seat: "owner" as const, sendingChurchId },
    { name: "sending-member", seat: "member" as const, sendingChurchId },
  ];
  for (const account of accounts) {
    await db
      .insert(users)
      .values({
        ...account,
        id: id(account.name),
        email: `${account.name}@preview.example.test`,
        passwordHash,
      })
      .onConflictDoNothing();
  }
  await db
    .insert(coachAssignments)
    .values({
      coachUserId: id("coach"),
      churchId: id("primary"),
      status: "active",
    })
    .onConflictDoNothing();
  for (const key of ["primary", "foreign"]) {
    const churchId = id(key),
      ownerId = id(key === "primary" ? "owner" : "foreign-owner");
    for (let i = 0; i < 30; i++) {
      await db
        .insert(persons)
        .values({
          id: id(`${key}-person-${i}`),
          churchId,
          firstName: `Fixture ${i}`,
          lastName: key,
          email: `${key}-${i}@example.test`,
          status: "prospect",
          createdBy: ownerId,
        })
        .onConflictDoNothing();
      await db
        .insert(tasks)
        .values({
          id: id(`${key}-task-${i}`),
          churchId,
          title: `${key} task ${i}`,
          status: "not_started",
          priority: "medium",
          category: "general",
          assignedToId: ownerId,
          createdById: ownerId,
        })
        .onConflictDoNothing();
    }
    for (const status of ["planning", "completed"] as const) {
      await db
        .insert(churchMeetings)
        .values({
          id: id(`${key}-${status}`),
          churchId,
          title: `${key} ${status} vision meeting`,
          type: "vision_meeting",
          status,
          datetime: new Date(
            status === "completed"
              ? "2026-01-01T16:00:00Z"
              : "2027-01-01T16:00:00Z"
          ),
          createdBy: ownerId,
        })
        .onConflictDoNothing();
    }
  }
  const manifest = {
    database: identity.name,
    password,
    accounts: accounts.map((a) => ({
      email: `${a.name}@preview.example.test`,
      id: id(a.name),
      seat: a.seat,
    })),
    primaryChurchId: id("primary"),
    foreignChurchId: id("foreign"),
    primaryPersonId: id("primary-person-0"),
    primaryTaskId: id("primary-task-0"),
    planningMeetingId: id("primary-planning"),
    completedMeetingId: id("primary-completed"),
  };
  writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    `Verified disposable database ${identity.name}; fixture manifest written to ${output}`
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
