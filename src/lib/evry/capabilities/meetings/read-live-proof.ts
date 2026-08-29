import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import { db } from "@/db";
import {
  churchMeetings,
  churches,
  locations,
  meetingAttendance,
  meetingChecklistItems,
  ministryTeams,
  persons,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

const SCRATCH = "__evry meetings read proof__";
const MEETING_AT = new Date("2026-09-29T18:00:00.000Z");

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

let sessionUser: SessionUser | null = null;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!sessionUser) throw new UnauthorizedError();
      return { user: sessionUser };
    },
  },
});

async function seedPlant(label: string) {
  const [plant] = await db
    .insert(churches)
    .values({ name: `${SCRATCH} ${label}` })
    .returning({ id: churches.id });
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: `${SCRATCH} ${label}`,
      seat: "owner",
      churchId: plant.id,
    })
    .returning({ id: users.id });
  const [location] = await db
    .insert(locations)
    .values({
      churchId: plant.id,
      name: `${label} Community Center`,
      address: "1 Read Proof Way",
      capacity: 80,
    })
    .returning({ id: locations.id });
  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId: plant.id,
      name: `${label} Hospitality`,
      type: "custom",
      createdBy: user.id,
    })
    .returning({ id: ministryTeams.id });
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "vision_meeting",
      title: `${label} Vision Meeting`,
      datetime: MEETING_AT,
      status: "planning",
      locationId: location.id,
      locationName: `${label} Community Center`,
      locationAddress: "1 Read Proof Way",
      agenda: [],
      createdBy: user.id,
    })
    .returning({ id: churchMeetings.id });
  const [person] = await db
    .insert(persons)
    .values({
      churchId: plant.id,
      firstName: label,
      lastName: "Reader",
      status: "attendee",
      createdBy: user.id,
    })
    .returning({ id: persons.id });
  await db.insert(meetingAttendance).values({
    churchId: plant.id,
    meetingId: meeting.id,
    personId: person.id,
    attendanceType: "first_time",
    status: "attended",
    createdBy: user.id,
  });
  await db.insert(meetingChecklistItems).values({
    churchId: plant.id,
    meetingId: meeting.id,
    itemName: "Set up chairs",
    category: "setup",
    isChecked: false,
  });
  return { plant, user, location, team, meeting };
}

const EXPECTED_DETAIL_FACTS = [
  "Attended",
  "Attendee rows",
  "Available locations",
  "Checklist",
  "Checklist rows",
  "Contextual templates",
  "Date and time",
  "Evaluation score",
  "Evaluation trend points",
  "First-time attendees",
  "Follow-up",
  "Guests",
  "Location",
  "Meeting communications",
  "Recipients with tracking",
  "Response cards",
  "Response rows",
  "Status",
] as const;

async function main() {
  const local = await seedPlant("Local");
  const foreign = await seedPlant("Foreign");
  sessionUser = {
    id: local.user.id,
    churchId: local.plant.id,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
  };

  const [{ authorizeEvryReadCapability }, { executeMeetingsRead }] =
    await Promise.all([
      import("@/lib/evry/eligibility/capabilities"),
      import("./reads"),
    ]);

  const inputs = {
    "meetings.read.list": {
      valid: { status: "all", teamId: local.team.id, limit: 25, offset: 0 },
      foreign: {
        status: "all",
        teamId: foreign.team.id,
        limit: 25,
        offset: 0,
      },
    },
    "meetings.read.detail": {
      valid: { meetingId: local.meeting.id },
      foreign: { meetingId: foreign.meeting.id },
    },
    "meetings.read.analytics": {
      valid: { meetingId: local.meeting.id, limit: 12 },
      foreign: { meetingId: foreign.meeting.id, limit: 12 },
    },
    "meetings.read.schedule": { valid: {}, foreign: {} },
  } as const;

  for (const [identity, values] of Object.entries(inputs)) {
    const authorization = await authorizeEvryReadCapability(identity);
    assert.ok(authorization, `${identity} was not authorized for an Owner`);
    const first = await executeMeetingsRead({
      authorization,
      untrustedInput: values.valid,
    });
    assert.ok(first, identity);
    assert.equal(first.kind, "read", identity);
    const replay = await executeMeetingsRead({
      authorization,
      untrustedInput: values.valid,
    });
    assert.deepEqual(replay, first, `${identity} read replay changed`);
    console.log(`PASS ${identity}:execution`);
    console.log(`PASS ${identity}:idempotency`);

    const refused = await executeMeetingsRead({
      authorization,
      untrustedInput: { ...values.valid, genericUrl: "https://invalid.test" },
    });
    assert.equal(refused, null, `${identity} accepted an unknown argument`);
    console.log(`PASS ${identity}:errors`);

    if (identity === "meetings.read.schedule") {
      assert.equal(
        first.items.some(({ id }) => id === foreign.location.id),
        false
      );
      assert.equal(
        first.items.some(({ id }) => id === foreign.team.id),
        false
      );
      assert.deepEqual(
        first.filters.map(({ label }) => label),
        ["Locations", "Teams"]
      );
    } else {
      const foreignResult = await executeMeetingsRead({
        authorization,
        untrustedInput: values.foreign,
      });
      assert.ok(foreignResult);
      assert.equal(foreignResult.kind, "clarification", identity);
    }
    console.log(`PASS ${identity}:tenancy`);

    if (identity === "meetings.read.detail" && first.kind === "read") {
      assert.deepEqual(
        first.items[0]?.facts.map(({ label }) => label).toSorted(),
        EXPECTED_DETAIL_FACTS
      );
    }
    if (identity === "meetings.read.list" && first.kind === "read") {
      assert.deepEqual(
        first.filters.map(({ label }) => label),
        ["Time", "Type", "Team", "Plant meeting history"]
      );
    }
    console.log(`PASS ${identity}:ui_artifact`);
  }

  sessionUser = { ...sessionUser, seat: "member" };
  assert.equal(
    await authorizeEvryReadCapability("meetings.read.schedule"),
    null,
    "Member reached writer-only scheduling options"
  );
  for (const identity of [
    "meetings.read.list",
    "meetings.read.detail",
    "meetings.read.analytics",
  ]) {
    assert.ok(
      await authorizeEvryReadCapability(identity),
      `${identity} refused a read-only Member`
    );
  }
  for (const identity of Object.keys(inputs)) {
    console.log(`PASS ${identity}:permission`);
  }
  console.log("Meetings read live proof passed");
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  }
);
