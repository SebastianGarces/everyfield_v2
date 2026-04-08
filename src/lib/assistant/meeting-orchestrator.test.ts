import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assistantArtifacts,
  churchMeetings,
  churches,
  locations,
  users,
} from "@/db/schema";
import {
  createMeetingFromAssistantThread,
  planAssistantMeetingDraft,
  shouldRouteToMeetingPlanner,
} from "./meeting-orchestrator";
import {
  getMeetingDraftArtifactPayload,
  initialAssistantMeetingDraft,
  serializeMeetingDraftForCreate,
} from "./meeting-draft";
import {
  createAssistantThread,
  upsertActiveAssistantArtifact,
} from "./service";

async function createTestChurchAndUser() {
  const churchId = randomUUID();
  const userId = randomUUID();
  const email = `assistant-orchestrator-${randomUUID()}@example.com`;

  await db.insert(churches).values({
    id: churchId,
    name: `Assistant Orchestrator Church ${churchId.slice(0, 8)}`,
  });

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: "test-password-hash",
    role: "planter",
    churchId,
    name: "Assistant Orchestrator User",
  });

  return { churchId, userId };
}

async function cleanupTestChurchAndUser(churchId: string, userId: string) {
  await db.delete(churchMeetings).where(eq(churchMeetings.churchId, churchId));
  await db.delete(locations).where(eq(locations.churchId, churchId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(churches).where(eq(churches.id, churchId));
}

test("shouldRouteToMeetingPlanner detects meeting planning cues", () => {
  assert.equal(
    shouldRouteToMeetingPlanner({
      message: "hello there",
      teams: [{ id: randomUUID(), name: "Worship Team" }],
      savedLocations: [
        {
          id: randomUUID(),
          name: "North Ridgeville High School",
          address: "123 Center Ridge Rd",
        },
      ],
    }),
    false
  );

  assert.equal(
    shouldRouteToMeetingPlanner({
      message: "tomorrow at 7 at North Ridgeville High School",
      teams: [{ id: randomUUID(), name: "Worship Team" }],
      savedLocations: [
        {
          id: randomUUID(),
          name: "North Ridgeville High School",
          address: "123 Center Ridge Rd",
        },
      ],
    }),
    true
  );
});

test("planAssistantMeetingDraft resolves team meetings and saved locations", async () => {
  const worshipTeamId = randomUUID();
  const highSchoolId = randomUUID();

  const result = await planAssistantMeetingDraft({
    currentDraft: initialAssistantMeetingDraft,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        content:
          "Set up a team meeting for the worship team next Tuesday at 6:30 PM at North Ridgeville High School for 25 people",
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ],
    savedLocations: [
      {
        id: highSchoolId,
        name: "North Ridgeville High School",
        address: "123 Center Ridge Rd, North Ridgeville, OH 44039",
      },
    ],
    teams: [{ id: worshipTeamId, name: "Worship Team" }],
    options: {
      generatePlannerDraft: async () => ({
        type: "team_meeting",
        title: null,
        datetime: null,
        locationName: "North Ridgeville High School",
        locationAddress: null,
        estimatedAttendance: null,
        durationMinutes: null,
        notes: null,
        teamName: "Worship Team",
        meetingSubtype: null,
      }),
    },
  });

  assert.equal(result.artifact.status, "ready");
  assert.equal(result.artifact.draft.type, "team_meeting");
  assert.equal(result.artifact.draft.teamId, worshipTeamId);
  assert.equal(result.artifact.draft.teamName, "Worship Team");
  assert.equal(result.artifact.draft.meetingSubtype, "regular");
  assert.equal(result.artifact.draft.locationId, highSchoolId);
  assert.equal(result.artifact.draft.estimatedAttendance, 25);
  assert.equal(result.artifact.missingFields.length, 0);
});

test("planAssistantMeetingDraft asks for time when only a date is known", async () => {
  const highSchoolId = randomUUID();

  const result = await planAssistantMeetingDraft({
    currentDraft: initialAssistantMeetingDraft,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        content:
          "Schedule an orientation tomorrow at North Ridgeville High School, note: core group welcome night",
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ],
    savedLocations: [
      {
        id: highSchoolId,
        name: "North Ridgeville High School",
        address: "123 Center Ridge Rd, North Ridgeville, OH 44039",
      },
    ],
    teams: [],
    options: {
      generatePlannerDraft: async () => ({
        type: "orientation",
        title: null,
        datetime: "2026-04-08T05:00:00.000Z",
        locationName: "North Ridgeville High School",
        locationAddress: null,
        estimatedAttendance: null,
        durationMinutes: null,
        notes: null,
        teamName: null,
        meetingSubtype: null,
      }),
    },
  });

  assert.equal(result.artifact.status, "collecting");
  assert.deepEqual(result.artifact.missingFields, ["datetime"]);
  assert.equal(result.artifact.draft.locationId, highSchoolId);
  assert.equal(result.artifact.draft.datetime, null);
  assert.match(result.assistantMessage, /What time should I use\?/);
  assert.equal(result.artifact.draft.notes, "core group welcome night");
});

test("serializeMeetingDraftForCreate supplies non-vision titles and defaults", () => {
  const payload = serializeMeetingDraftForCreate({
    ...initialAssistantMeetingDraft,
    type: "team_meeting",
    datetime: "2026-04-15T00:30:00.000Z",
    locationId: randomUUID(),
    locationName: "North Ridgeville High School",
    locationAddress: "123 Center Ridge Rd",
    teamId: randomUUID(),
    teamName: "Worship Team",
    meetingSubtype: "training",
  });

  assert.equal(payload.title, "Worship Team Training");
  assert.equal(payload.meetingSubtype, "training");
});

test(
  "createMeetingFromAssistantThread completes the artifact and appends an open link",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { churchId, userId } = await createTestChurchAndUser();

    try {
      const [savedLocation] = await db
        .insert(locations)
        .values({
          churchId,
          name: "North Ridgeville High School",
          address: "123 Center Ridge Rd, North Ridgeville, OH 44039",
        })
        .returning();

      const thread = await createAssistantThread(churchId, userId);

      await upsertActiveAssistantArtifact({
        churchId,
        userId,
        threadId: thread.id,
        kind: "meeting_draft",
        payload: {
          type: "meeting_draft",
          status: "ready",
          draft: {
            ...initialAssistantMeetingDraft,
            type: "orientation",
            datetime: "2026-04-16T00:00:00.000Z",
            locationId: savedLocation.id,
            locationName: savedLocation.name,
            locationAddress: savedLocation.address,
            notes: "Welcome night",
          },
          missingFields: [],
          interpretation: {
            meetingTypeLabel: "Orientation",
            datetimeLabel: "Wednesday, April 15, 2026 at 7:00 PM CDT",
            locationLabel:
              "North Ridgeville High School, 123 Center Ridge Rd, North Ridgeville, OH 44039",
          },
          createdMeetingId: null,
          createdMeetingHref: null,
        },
      });

      const updatedThread = await createMeetingFromAssistantThread({
        churchId,
        userId,
        threadId: thread.id,
      });

      const payload = getMeetingDraftArtifactPayload(updatedThread.artifacts);
      assert.ok(payload);
      assert.equal(payload?.status, "created");
      assert.ok(payload?.createdMeetingId);
      assert.equal(
        payload?.createdMeetingHref,
        `/meetings/${payload?.createdMeetingId}`
      );

      const assistantMessage = updatedThread.messages.at(-1);
      assert.ok(assistantMessage);
      assert.equal(assistantMessage?.role, "assistant");
      assert.ok(Array.isArray(assistantMessage?.metadata?.actions));
      assert.equal(
        assistantMessage?.metadata?.actions?.[0]?.href,
        `/meetings/${payload?.createdMeetingId}`
      );

      const completedArtifacts = await db
        .select()
        .from(assistantArtifacts)
        .where(eq(assistantArtifacts.threadId, thread.id));

      assert.equal(completedArtifacts.length, 1);
      assert.equal(completedArtifacts[0]?.status, "completed");
    } finally {
      await cleanupTestChurchAndUser(churchId, userId);
    }
  }
);
