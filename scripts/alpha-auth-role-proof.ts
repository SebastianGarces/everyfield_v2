import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { churches, users, persons, coachAssignments } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import {
  createSession,
  generateSessionToken,
  validateSessionToken,
} from "@/lib/auth/session";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getAccessibleChurchIds } from "@/lib/auth/access";
import {
  seatActorFromSession,
  demoteToMember,
  removeSeat,
  endCoachAssignment,
} from "@/lib/seats/roster";
const path = "/private/tmp/alpha-auth-role-private.json";
async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/ef_preview_[a-f0-9]{12}$/
  );
  if (process.argv[2] === "seed") {
    const key = randomUUID().slice(0, 8);
    const password = "LocalAuthAlphaOnly-Aa1!2026";
    const passwordHash = await hashPassword(password);
    const [plant] = await db
      .insert(churches)
      .values({
        name: `Auth QA ${key}`,
        currentPhase: 2,
        onboardingCompletedAt: new Date(),
        leadershipStatus: "planter_confirmed",
      })
      .returning();
    const accounts: any = {};
    for (const role of ["owner", "admin", "member", "coach"]) {
      const [user] = await db
        .insert(users)
        .values({
          name: `Auth QA ${role}`,
          email: `auth-${key}-${role}@example.test`,
          passwordHash,
          seat: role === "coach" ? null : (role as any),
          churchId: role === "coach" ? null : plant.id,
        })
        .returning();
      accounts[role] = { id: user.id, email: user.email };
    }
    const [person] = await db
      .insert(persons)
      .values({
        churchId: plant.id,
        firstName: "Auth QA Private",
        lastName: key,
        createdBy: accounts.owner.id,
      })
      .returning();
    const [assignment] = await db
      .insert(coachAssignments)
      .values({ coachUserId: accounts.coach.id, churchId: plant.id })
      .returning();
    writeFileSync(
      path,
      JSON.stringify(
        {
          plantId: plant.id,
          personId: person.id,
          assignmentId: assignment.id,
          password,
          accounts,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.log(
      "PASS unique scoped auth fixtures created; private manifest saved"
    );
    return;
  }
  const f = JSON.parse(readFileSync(path, "utf8"));
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, f.accounts.owner.id));
  const token = generateSessionToken();
  const session = await createSession(token, owner.id);
  const actor = seatActorFromSession({ user: owner, session });
  if (process.argv[2] === "demote") {
    await demoteToMember(actor, f.accounts.admin.id);
    console.log("PASS admin demoted");
    return;
  }
  if (process.argv[2] === "remove") {
    await removeSeat(actor, f.accounts.member.id);
    console.log("PASS member removed with sessions revoked");
    return;
  }
  if (process.argv[2] === "end-coach") {
    await endCoachAssignment(actor, f.assignmentId);
    console.log("PASS coach assignment ended");
    return;
  }
  for (const role of ["owner", "admin", "member", "coach"]) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, f.accounts[role].id));
    assert.equal(
      holdsSeatFor(u, "people.write"),
      role === "owner" || role === "admin"
    );
    assert.equal(holdsSeatFor(u, "seat.manage"), role === "owner");
    assert.deepEqual(await getAccessibleChurchIds(u), [f.plantId]);
  }
  const adminToken = generateSessionToken();
  await createSession(adminToken, f.accounts.admin.id);
  await demoteToMember(actor, f.accounts.admin.id);
  const adminFresh = await validateSessionToken(adminToken);
  assert.equal(adminFresh.user?.seat, "member");
  assert.equal(holdsSeatFor(adminFresh.user!, "people.write"), false);
  const memberToken = generateSessionToken();
  await createSession(memberToken, f.accounts.member.id);
  await removeSeat(actor, f.accounts.member.id);
  assert.equal((await validateSessionToken(memberToken)).session, null);
  const [removed] = await db
    .select()
    .from(users)
    .where(eq(users.id, f.accounts.member.id));
  assert.equal(removed.seat, null);
  assert.equal(removed.churchId, null);
  assert.deepEqual(await getAccessibleChurchIds(removed), []);
  await assert.rejects(() => removeSeat(actor, f.accounts.owner.id));
  await assert.rejects(() => removeSeat(actor, f.accounts.member.id));
  const coachToken = generateSessionToken();
  await createSession(coachToken, f.accounts.coach.id);
  await endCoachAssignment(actor, f.assignmentId);
  const coachFresh = await validateSessionToken(coachToken);
  assert.ok(coachFresh.user);
  assert.deepEqual(await getAccessibleChurchIds(coachFresh.user!), []);
  assert.equal(
    (await db.select().from(persons).where(eq(persons.id, f.personId))).length,
    1
  );
  console.log(
    "PASS owner/admin/member/coach capability and access matrix, fresh demotion, seat removal token revocation, coach access revocation, owner protection, removal replay, person preservation"
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
