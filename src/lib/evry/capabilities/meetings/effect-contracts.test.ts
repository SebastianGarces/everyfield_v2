import assert from "node:assert/strict";
import { test } from "node:test";

import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";

import { MEETINGS_ACTION_CONTRACTS } from "./catalog";
import {
  assertMeetingsEffectContractsComplete,
  MEETINGS_EFFECT_ARGUMENT_SCHEMAS,
} from "./effect-contracts";
import { MEETINGS_CAPABILITY_EVAL_FIXTURES } from "./eval-fixtures";
import { MEETINGS_OPERATION_REGISTRATIONS } from "./registrations";

const ID = "10000000-0000-4000-8000-000000000001";
const PERSON_ID = "20000000-0000-4000-8000-000000000001";
const WHEN = "2026-08-29T14:00:00.000Z";

const agenda = [{ id: "welcome", title: "Welcome", minutes: 10 }];
const location = {
  name: "Community Center",
  address: "1 Main Street",
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  cost: null,
  capacity: 80,
  notes: null,
  isActive: true,
};
const meeting = {
  type: "vision_meeting",
  title: "Vision Meeting",
  datetime: WHEN,
  status: "planning",
  locationId: null,
  locationName: "Community Center",
  locationAddress: "1 Main Street",
  meetingNumber: 12,
  teamId: null,
  meetingSubtype: null,
  estimatedAttendance: 30,
  actualAttendance: null,
  durationMinutes: 90,
  notes: null,
  agenda,
};

function fixtureValue(exportName: string, key: string): unknown {
  if (
    key === "meetingId" ||
    key === "locationId" ||
    key === "itemId" ||
    key === "attendanceId" ||
    key === "personActivityId" ||
    key === "activityId" ||
    key === "evaluationId" ||
    key === "responseId"
  ) {
    return ID;
  }
  if (key === "personId") return PERSON_ID;
  if (key.endsWith("UpdatedAt") || key === "expectedUpdatedAt") return WHEN;
  if (key === "expectedResponseUpdatedAt") return null;
  if (key === "expectedChurchMaterialEventAt") return null;
  if (key === "expectedAssignedPersonUpdatedAt") return WHEN;
  if (key.startsWith("expected") && key.endsWith("Absent")) return true;
  if (key === "type" || key === "meetingType") return "vision_meeting";
  if (key === "title") return "Vision Meeting";
  if (key === "datetime") return WHEN;
  if (key === "meetingDatetime") return WHEN;
  if (key === "meetingTitle") return "Vision Meeting";
  if (key === "timezone") return "America/New_York";
  if (key === "locationName") return "Community Center";
  if (key === "locationAddress") return "1 Main Street";
  if (key === "savedLocationId") return null;
  if (key === "teamId" || key === "meetingSubtype") return null;
  if (key === "estimatedAttendance") return 30;
  if (key === "durationMinutes") return 90;
  if (key === "notes") return null;
  if (key === "agenda" || key === "beforeSections" || key === "afterSections") {
    return agenda;
  }
  if (key === "resolvedTeamMemberIds") return [];
  if (key === "meetingNumber") return 12;
  if (key === "checklistItems") return [];
  if (key === "attendanceRows") return [];
  if (key === "notificationTargets") return [];
  if (key === "pendingNotifications") return [];
  if (key === "expectedAttendanceIds") return [ID];
  if (key === "expectedChecklistItemIds") return [ID];
  if (key === "expectedResponseIds") return [];
  if (key === "expectedEvaluationId") return null;
  if (key === "expectedInvitationIds") return [];
  if (key === "expectedActualAttendance") return null;
  if (key === "attendees") {
    return [
      {
        attendanceId: ID,
        personId: PERSON_ID,
        attendanceType: "first_time",
        expectedUpdatedAt: WHEN,
      },
    ];
  }
  if (key === "personStatusChanges") return [];
  if (key === "followUpTaskTargets") {
    return [
      {
        taskId: ID,
        personId: PERSON_ID,
        title: "Follow up with Alex Rivera",
        dueDate: "2026-08-31",
        assignedToId: ID,
        expectedTaskAbsent: true,
        beforeStatus: null,
        expectedUpdatedAt: null,
        notificationTargets: [],
      },
    ];
  }
  if (key === "evaluationTaskTarget") {
    return {
      taskId: ID,
      title: "Evaluate Vision Meeting",
      dueDate: "2026-08-30",
      assignedToId: ID,
      expectedTaskAbsent: true,
      beforeStatus: null,
      expectedUpdatedAt: null,
      pendingNotifications: [],
      notificationTargets: [],
    };
  }
  if (key === "evaluationTask") return null;
  if (key === "firstName") return "Alex";
  if (key === "lastName") return "Rivera";
  if (key === "email") return "alex@example.com";
  if (key === "phone") return null;
  if (key === "attendanceType" || key === "afterAttendanceType") {
    return "first_time";
  }
  if (key === "invitedById") return null;
  if (key === "responseStatus") return null;
  if (key === "status") {
    return exportName === "createMeetingAction" ? "planning" : "attended";
  }
  if (key === "actualAttendance") return null;
  if (key === "createdById") return ID;
  if (key === "meetingType") return "vision_meeting";
  if (key === "note") return "Follow up next week.";
  if (key === "expectedPersonUpdatedAt") return WHEN;
  if (key.endsWith("Score")) return 4;
  if (key === "name") return "Community Center";
  if (key === "address") return "1 Main Street";
  if (key === "contactName" || key === "contactPhone") return null;
  if (key === "contactEmail" || key === "cost") return null;
  if (key === "capacity") return 80;
  if (key === "records") {
    return [
      {
        attendanceId: ID,
        personId: PERSON_ID,
        before: {
          id: ID,
          exists: true,
          status: "absent",
          attendanceType: null,
          responseStatus: "confirmed",
          notes: null,
          updatedAt: WHEN,
        },
        afterStatus: "attended",
        afterAttendanceType: "first_time",
      },
    ];
  }
  if (key === "responseType") return "interested";
  if (key === "beforeResponse") {
    return exportName === "recordResponseCardAction"
      ? null
      : {
          responseId: ID,
          responseType: "interested",
          notes: null,
          recordedById: ID,
          updatedAt: WHEN,
        };
  }
  if (key === "beforeAttendance") {
    return {
      id: ID,
      exists: true,
      status: "absent",
      attendanceType: null,
      responseStatus: "confirmed",
      notes: null,
      updatedAt: WHEN,
    };
  }
  if (key === "beforeChecked") return false;
  if (key === "afterChecked") return true;
  if (key === "beforeNotes" || key === "beforeAssignedTo") return null;
  if (key === "afterNotes") return "Bring extension cord";
  if (key === "afterAssignedTo") return PERSON_ID;
  if (key === "before" || key === "after") {
    return exportName === "updateLocationAction" ? location : meeting;
  }
  if (key === "beforeStatus" || key === "afterStatus") {
    if (exportName === "updateMeetingStatusAction") {
      return key === "beforeStatus" ? "planning" : "ready";
    }
    if (exportName === "updateRsvpStatusAction") {
      return key === "beforeStatus" ? null : "confirmed";
    }
    return key === "beforeStatus" ? "absent" : "attended";
  }
  throw new Error(`Missing fixture value for ${exportName}.${key}`);
}

function validArguments(exportName: keyof typeof MEETINGS_ACTION_CONTRACTS) {
  return Object.fromEntries(
    MEETINGS_ACTION_CONTRACTS[exportName].argumentKeys.map((key) => [
      key,
      fixtureValue(exportName, key),
    ])
  );
}

test("every authoritative effect has one strict complete fingerprint contract", () => {
  assert.doesNotThrow(assertMeetingsEffectContractsComplete);
  for (const exportName of Object.keys(
    MEETINGS_ACTION_CONTRACTS
  ) as (keyof typeof MEETINGS_ACTION_CONTRACTS)[]) {
    const schema = MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName];
    const valid = validArguments(exportName);
    assert.equal(schema.safeParse(valid).success, true, exportName);
    assert.equal(
      schema.safeParse({ ...valid, arbitraryUrl: "https://example.com" })
        .success,
      false,
      `${exportName} must reject generic escape-hatch fields`
    );
    const [firstKey] = MEETINGS_ACTION_CONTRACTS[exportName].argumentKeys;
    assert.ok(firstKey);
    const missing = { ...valid };
    delete missing[firstKey];
    assert.equal(
      schema.safeParse(missing).success,
      false,
      `${exportName} must require its complete exact-plan document`
    );
  }
});

test("the eval roster is derived from production Meetings registrations", () => {
  assert.deepEqual(
    MEETINGS_CAPABILITY_EVAL_FIXTURES.map(
      ({ capabilityIdentity }) => capabilityIdentity
    ).toSorted(),
    MEETINGS_OPERATION_REGISTRATIONS.map(({ identity }) => identity).toSorted()
  );
});

for (const fixture of MEETINGS_CAPABILITY_EVAL_FIXTURES) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${fixture.capabilityIdentity}:${layer}`, () => {
      const registration = MEETINGS_OPERATION_REGISTRATIONS.find(
        ({ identity }) => identity === fixture.capabilityIdentity
      );
      assert.ok(registration);
      assert.equal(fixture.cases[layer].length, 1);
      assert.equal(
        fixture.cases[layer][0].id,
        `${fixture.capabilityIdentity}:${layer}`
      );
      assert.equal(
        fixture.expectsConfirmation,
        registration.operationKind === "effect"
      );
      assert.equal(
        registration.operationKind === "read",
        registration.actionLabel === null,
        "reads execute directly; effects own an effect-specific primary action"
      );
    });
  }
}
