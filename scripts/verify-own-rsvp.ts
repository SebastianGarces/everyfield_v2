/** Run only on an isolated scratch DB with the current migrations applied.
 * DATABASE_URL=postgresql://.../rsvp827 NEON_HTTP_PROXY_URL=http://localhost:44827/sql
 * node --import tsx scripts/verify-own-rsvp.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { neonConfig } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  churches,
  users,
  persons,
  churchMeetings,
  meetingAttendance,
  meetingConfirmationTokens,
  invitations,
} from "../src/db/schema";
import { getOwnRsvp, saveOwnRsvp } from "../src/lib/meetings/own-rsvp";
import { resolveConfirmation } from "../src/lib/communication/confirmation";

const url = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname === "/rsvp827",
  "Refusing a non-scratch database"
);
assert.ok(process.env.NEON_HTTP_PROXY_URL?.startsWith("http://localhost:"));
neonConfig.fetchEndpoint = process.env.NEON_HTTP_PROXY_URL!;

async function main() {
  const prefix = `RSVP827-${crypto.randomUUID()}`;
  const [church, foreignChurch] = await db
    .insert(churches)
    .values([
      { name: prefix, onboardingCompletedAt: new Date() },
      { name: `${prefix}-foreign`, onboardingCompletedAt: new Date() },
    ])
    .returning();
  const [member, stranger, unlinked] = await db
    .insert(users)
    .values(
      ["member", "stranger", "unlinked"].map((name) => ({
        email: `${prefix}-${name}@example.invalid`,
        passwordHash: "scratch-only",
        churchId: church.id,
        seat: "member" as const,
      }))
    )
    .returning();
  const [person, other] = await db
    .insert(persons)
    .values([
      {
        churchId: church.id,
        userId: member.id,
        firstName: "Member",
        lastName: prefix,
        createdBy: member.id,
      },
      {
        churchId: church.id,
        userId: stranger.id,
        firstName: "Other",
        lastName: prefix,
        createdBy: member.id,
      },
    ])
    .returning();
  const [meeting, uninvited, foreign] = await db
    .insert(churchMeetings)
    .values([
      {
        churchId: church.id,
        type: "vision_meeting" as const,
        datetime: new Date(),
        createdBy: member.id,
      },
      {
        churchId: church.id,
        type: "vision_meeting" as const,
        datetime: new Date(),
        createdBy: member.id,
      },
      {
        churchId: foreignChurch.id,
        type: "vision_meeting" as const,
        datetime: new Date(),
        createdBy: member.id,
      },
    ])
    .returning();
  await db.insert(meetingAttendance).values(
    [person, other].map((p) => ({
      churchId: church.id,
      meetingId: meeting.id,
      personId: p.id,
      status: "absent" as const,
      notes: "Do not change",
      responseStatus: null,
    }))
  );
  await db.insert(invitations).values({
    churchId: church.id,
    meetingId: meeting.id,
    inviterId: other.id,
    inviteeId: person.id,
  });
  const token = () => `${prefix}-${crypto.randomUUID()}`;
  const historicalTime = new Date("2020-01-01T00:00:00Z");
  const [historical] = await db
    .insert(meetingConfirmationTokens)
    .values({
      token: token(),
      churchId: church.id,
      meetingId: meeting.id,
      personId: person.id,
      status: "declined",
      respondedAt: historicalTime,
      expiresAt: new Date(Date.now() + 86400000),
    })
    .returning();
  async function pendingToken() {
    const [row] = await db
      .insert(meetingConfirmationTokens)
      .values({
        token: token(),
        churchId: church.id,
        meetingId: meeting.id,
        personId: person.id,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    return row;
  }
  const pending = await pendingToken();
  assert.deepEqual(await getOwnRsvp(member, meeting.id), {
    response: null,
  });
  for (const response of ["confirmed", "declined"] as const) {
    assert.equal(await saveOwnRsvp(member, meeting.id, response), true);
    assert.deepEqual(await getOwnRsvp(member, meeting.id), { response });
  }
  const [old] = await db
    .select()
    .from(meetingConfirmationTokens)
    .where(eq(meetingConfirmationTokens.id, historical.id));
  assert.equal(old.status, "declined");
  assert.equal(old.respondedAt?.getTime(), historicalTime.getTime());
  const [firstAnswer] = await db
    .select()
    .from(meetingConfirmationTokens)
    .where(eq(meetingConfirmationTokens.id, pending.id));
  assert.equal(
    firstAnswer.status,
    "confirmed",
    "an answered token remains history after a later own RSVP"
  );
  assert.equal(await saveOwnRsvp(member, uninvited.id, "confirmed"), false);
  assert.equal(await saveOwnRsvp(member, foreign.id, "confirmed"), false);
  assert.equal(await saveOwnRsvp(unlinked, meeting.id, "confirmed"), false);
  await db
    .update(persons)
    .set({ deletedAt: new Date() })
    .where(eq(persons.id, person.id));
  assert.equal(await getOwnRsvp(member, meeting.id), null);
  assert.equal(await saveOwnRsvp(member, meeting.id, "confirmed"), false);
  await db
    .update(persons)
    .set({ deletedAt: null })
    .where(eq(persons.id, person.id));
  await assert.rejects(
    saveOwnRsvp({ ...member, seat: null }, meeting.id, "confirmed")
  );
  await assert.rejects(
    saveOwnRsvp(
      { ...member, churchId: null, sendingChurchId: foreignChurch.id },
      meeting.id,
      "confirmed"
    )
  );
  const publicToken = await pendingToken();
  assert.equal(
    (await resolveConfirmation(publicToken.token, "confirmed")).success,
    true
  );
  assert.deepEqual(await getOwnRsvp(member, meeting.id), {
    response: "confirmed",
  });
  assert.equal(
    (await resolveConfirmation(publicToken.token, "declined")).success,
    true
  );
  assert.deepEqual(await getOwnRsvp(member, meeting.id), {
    response: "confirmed",
  });
  assert.equal(
    (await resolveConfirmation("invalid-token", "confirmed")).success,
    false
  );
  async function holdRow(
    table: "meeting_attendance" | "meeting_confirmation_tokens",
    id: string
  ) {
    const child = spawn("docker", [
      "exec",
      "-i",
      "ef827-rsvp-pg",
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "rsvp827",
    ]);
    const ready = new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("RSVP_LOCK_HELD")) resolve();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code) reject(new Error(`lock connection exited ${code}`));
      });
    });
    // Identifiers are the closed table union and a database-returned UUID.
    assert.match(id, /^[a-f0-9-]{36}$/);
    child.stdin.write(
      `begin; select id from ${table} where id = '${id}' for update;\n\\echo RSVP_LOCK_HELD\n`
    );
    await ready;
    return () =>
      new Promise<void>((resolve, reject) => {
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`lock release exited ${code}`))
        );
        child.stdin.end("commit;\n");
      });
  }
  async function waitForBlockedWriter(fragment: string) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const waiting = await db.execute(sql`select pid from pg_stat_activity
        where datname = 'rsvp827' and pid <> pg_backend_pid()
          and wait_event_type = 'Lock' and query like ${`%${fragment}%`}`);
      if (waiting.rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Did not observe blocked writer: ${fragment}`);
  }
  const [ownGuest] = await db
    .select()
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.meetingId, meeting.id),
        eq(meetingAttendance.personId, person.id)
      )
    );
  for (const first of ["public", "own"] as const) {
    const concurrent = await pendingToken();
    const release = await holdRow(
      first === "public" ? "meeting_attendance" : "meeting_confirmation_tokens",
      first === "public" ? ownGuest.id : concurrent.id
    );
    const firstWrite =
      first === "public"
        ? resolveConfirmation(concurrent.token, "confirmed")
        : saveOwnRsvp(member, meeting.id, "declined");
    let secondWrite: Promise<unknown> | undefined;
    try {
      await waitForBlockedWriter(
        first === "public" ? "with claimed" : "with locked_tokens"
      );
      secondWrite =
        first === "public"
          ? saveOwnRsvp(member, meeting.id, "declined")
          : resolveConfirmation(concurrent.token, "confirmed");
      await waitForBlockedWriter(
        first === "public" ? "with locked_tokens" : "with claimed"
      );
    } finally {
      await release();
    }
    const outcomes = await Promise.all([firstWrite, secondWrite]);
    assert.deepEqual(
      outcomes,
      first === "public" ? [{ success: true }, true] : [true, { success: true }]
    );
    assert.deepEqual(await getOwnRsvp(member, meeting.id), {
      response: "declined",
    });
    const [answeredToken] = await db
      .select()
      .from(meetingConfirmationTokens)
      .where(eq(meetingConfirmationTokens.id, concurrent.id));
    assert.equal(
      answeredToken.status,
      first === "public" ? "confirmed" : "declined"
    );
    const [responseInvitation] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.meetingId, meeting.id),
          eq(invitations.inviteeId, person.id)
        )
      );
    assert.equal(responseInvitation.status, "declined");
  }
  const guests = await db
    .select()
    .from(meetingAttendance)
    .where(eq(meetingAttendance.meetingId, meeting.id));
  for (const guest of guests) {
    assert.equal(guest.status, "absent");
    assert.equal(guest.notes, "Do not change");
    assert.equal(guest.attendanceType, null);
    if (guest.personId === other.id) assert.equal(guest.responseStatus, null);
  }
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.meetingId, meeting.id),
        eq(invitations.inviteeId, person.id)
      )
    );
  assert.equal(invitation.status, "declined");
  console.log(
    "PASS: own confirm/decline, fresh reads, token history, uninvited/unlinked/deleted/foreign/seatless/org refusal, public token idempotence, forced public-first and own-first lock contention, unrelated guests and attendance preserved"
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
