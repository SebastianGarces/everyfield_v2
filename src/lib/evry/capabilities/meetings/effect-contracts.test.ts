import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "@/components/evry/artifacts/artifact-renderer";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import { MEETINGS_ACTION_CONTRACTS } from "./catalog";
import {
  assertMeetingsEffectContractsComplete,
  MEETINGS_EFFECT_ARGUMENT_SCHEMAS,
} from "./effect-contracts";
import { meetingsEffectDisclosure } from "./effect-disclosure";
import { MEETINGS_CAPABILITY_EVAL_FIXTURES } from "./eval-fixtures";
import { MEETINGS_OPERATION_REGISTRATIONS } from "./registrations";
import {
  MEETINGS_ARTIFACT_REVIEW_REGISTRY,
  MEETINGS_PLAN_REGISTRY,
} from "./runtime";

const ID = "10000000-0000-4000-8000-000000000001";
const PERSON_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_ID = "30000000-0000-4000-8000-000000000001";
const NOTIFICATION_ID = "40000000-0000-4000-8000-000000000001";
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
  if (key === "savedLocationId") {
    return exportName === "createMeetingAction" ? ID : null;
  }
  if (key === "teamId" || key === "meetingSubtype") return null;
  if (key === "estimatedAttendance") return 30;
  if (key === "durationMinutes") return 90;
  if (key === "notes") return null;
  if (key === "agenda" || key === "beforeSections" || key === "afterSections") {
    return agenda;
  }
  if (key === "resolvedTeamMemberIds") return [];
  if (key === "meetingNumber") return 12;
  if (key === "checklistItems") {
    return [{ itemId: SECOND_ID, itemName: "Set up", category: "setup" }];
  }
  if (key === "attendanceRows") {
    return [
      {
        attendanceId: SECOND_ID,
        personId: PERSON_ID,
        expectedPersonUpdatedAt: WHEN,
      },
    ];
  }
  if (key === "notificationBaseline") {
    return {
      coreGroupUserIds: [],
      reminderUserIds: [],
      activeNotifications: [],
    };
  }
  if (key === "notificationTargets") {
    return [
      {
        notificationId: NOTIFICATION_ID,
        recipientUserId: ID,
        category: "meetings",
        type: "meeting.reminder",
        title: "Meeting reminder",
        body: "Vision Meeting is coming up.",
        entityType: "meeting",
        entityId: ID,
        dedupeKey: "meeting-reminder",
        scheduledFor: WHEN,
        expectedAbsent: true,
      },
    ];
  }
  if (key === "pendingNotifications") {
    return [
      {
        notificationId: NOTIFICATION_ID,
        recipientUserId: ID,
        type: "meeting.reminder",
        entityId: ID,
        dedupeKey: "meeting-reminder",
        scheduledFor: WHEN,
        beforeStatus: "pending",
        expectedUpdatedAt: WHEN,
      },
    ];
  }
  if (key === "expectedAttendanceIds") return [ID];
  if (key === "expectedChecklistItemIds") return [ID];
  if (key === "expectedResponseIds") return [SECOND_ID];
  if (key === "expectedEvaluationId") return SECOND_ID;
  if (key === "expectedInvitationIds") return [SECOND_ID];
  if (key === "expectedConfirmationTokenIds") return [ID];
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
  if (key === "personStatusChanges") {
    return [
      {
        personId: PERSON_ID,
        beforeStatus: "prospect",
        afterStatus: "attendee",
        expectedUpdatedAt: WHEN,
        activityId: SECOND_ID,
        performedById: ID,
      },
    ];
  }
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
        notificationTargets: [
          {
            notificationId: NOTIFICATION_ID,
            recipientUserId: ID,
            category: "tasks",
            type: "task.due",
            title: "Task due",
            body: "Follow up",
            entityType: "task",
            entityId: ID,
            dedupeKey: "task-due",
            scheduledFor: WHEN,
            expectedAbsent: true,
          },
        ],
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
  if (key === "evaluationTask") {
    return {
      taskId: SECOND_ID,
      title: "Evaluate Vision Meeting",
      beforeStatus: "not_started",
      expectedUpdatedAt: WHEN,
    };
  }
  if (key === "firstName") return "Alex";
  if (key === "lastName") return "Rivera";
  if (key === "email") return "alex@example.com";
  if (key === "phone") return null;
  if (key === "attendanceType" || key === "afterAttendanceType") {
    return "first_time";
  }
  if (key === "attendanceTypeIsDerived") return true;
  if (key === "attendanceDerivation") {
    return {
      personStatus: "prospect",
      meetingDatetime: WHEN,
      priorAttendances: [],
    };
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
        attendanceDerivation: {
          personStatus: "prospect",
          meetingDatetime: WHEN,
          priorAttendances: [],
        },
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

function reviewForArguments(
  exportName: keyof typeof MEETINGS_ACTION_CONTRACTS,
  arguments_: Readonly<Record<string, unknown>>
) {
  const contract = MEETINGS_ACTION_CONTRACTS[exportName];
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: "30000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
  });
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: contract.operationId,
          capabilityIdentity: contract.operationId,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: MEETINGS_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: contract.operationId }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: MEETINGS_ARTIFACT_REVIEW_REGISTRY,
  });
  assert.ok(review, exportName);
  const step = review.confirmation.steps[0];
  assert.ok(step, exportName);
  return { confirmation: review.confirmation, step };
}

function joinedPreviewPages(
  previews: readonly Readonly<{ label: string; content: string }>[],
  label: string
): string {
  return previews
    .filter(
      (preview) =>
        preview.label === label || preview.label.startsWith(`${label} (page `)
    )
    .map(({ content }) => content)
    .join("");
}

function joinedStatePages(
  changes: readonly Readonly<{
    label: string;
    before: string;
    after: string;
  }>[],
  label: string,
  side: "before" | "after"
): string {
  const matching = changes.filter(
    (change) =>
      change.label === label || change.label.startsWith(`${label} (page `)
  );
  if (matching.length === 1 && matching[0]?.label === label) {
    return matching[0][side];
  }
  return matching
    .map((change) => JSON.parse(change[side]) as { content: string | null })
    .flatMap(({ content }) => (content === null ? [] : [content]))
    .join("");
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
  for (const fixture of MEETINGS_CAPABILITY_EVAL_FIXTURES) {
    assert.equal(fixture.cases.policy[0]?.proofId, "meetings-selection");
    assert.equal(
      fixture.cases.policy[0]?.testName,
      "the closed Meetings application policy admits each named capability and rejects non-application requests"
    );
    const registration = MEETINGS_OPERATION_REGISTRATIONS.find(
      ({ identity }) => identity === fixture.capabilityIdentity
    );
    assert.ok(registration);
    if (registration.operationKind === "read") {
      assert.equal(
        fixture.cases.arguments[0]?.testName,
        `${fixture.capabilityIdentity}:arguments`
      );
      assert.equal(
        fixture.cases.confirmation[0]?.testName,
        `${fixture.capabilityIdentity}:confirmation`
      );
    }
  }
});

test("every Meetings effect renders its exact complete confirmation", () => {
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: "30000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
  });
  for (const [exportName, contract] of Object.entries(
    MEETINGS_ACTION_CONTRACTS
  )) {
    const arguments_ = validArguments(
      exportName as keyof typeof MEETINGS_ACTION_CONTRACTS
    );
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: contract.operationId,
            capabilityIdentity: contract.operationId,
            arguments: arguments_,
            dependsOn: [],
          },
        ],
      },
      registry: MEETINGS_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity: contract.operationId }],
    });
    const registration =
      MEETINGS_ARTIFACT_REVIEW_REGISTRY.registrationFor(document);
    assert.ok(registration, exportName);
    assert.doesNotThrow(
      () => registration.build({ plan, document }),
      exportName
    );
    const review = trustedReviewForEvryPlanDocument({
      plan,
      document,
      reviewRegistry: MEETINGS_ARTIFACT_REVIEW_REGISTRY,
    });
    assert.ok(review, exportName);
    assert.equal(review.confirmation.actionLabel, contract.actionLabel);
    assert.equal(review.confirmation.steps.length, 1);
    const step = review.confirmation.steps[0];
    assert.ok(step, exportName);
    assert.equal(step.stepId, contract.operationId);
    const parsedArguments =
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS[
        exportName as keyof typeof MEETINGS_ACTION_CONTRACTS
      ].parse(arguments_);
    const expected = meetingsEffectDisclosure(
      exportName as keyof typeof MEETINGS_ACTION_CONTRACTS,
      parsedArguments
    );
    assert.deepEqual(
      step.resolvedTargets.map(({ label, value }) => ({ label, value })),
      expected.targets.map(({ label, value }) => ({ label, value })),
      exportName
    );
    assert.deepEqual(
      step.counts,
      expected.counts.map(({ label, count }) => ({ label, count })),
      exportName
    );
    assert.deepEqual(
      step.beforeAfter.map(({ label, count }) => ({ label, count })),
      expected.beforeAfter.map(({ label, count }) => ({ label, count })),
      exportName
    );
    assert.deepEqual(review.confirmation.consequences, expected.consequences);
    assert.equal(step.reversibility, expected.reversibility);
    const complete = joinedPreviewPages(
      step.contentPreviews,
      "Complete immutable plan"
    );
    assert.ok(complete, exportName);
    assert.deepEqual(JSON.parse(complete), arguments_, exportName);
    assert.equal(
      expected.counts
        .filter(({ includedInAffectedCount }) => includedInAffectedCount)
        .reduce((sum, entry) => sum + entry.count, 0),
      expected.affectedCount,
      exportName
    );
    assert.ok(step.beforeAfter.length > 0, exportName);
  }
});

test("finalization distinguishes created tasks from retained tasks", () => {
  const base = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.finalizeAttendanceAction.parse(
    validArguments("finalizeAttendanceAction")
  );
  const inserted = base.followUpTaskTargets[0];
  assert.ok(inserted);
  const retained = {
    ...inserted,
    taskId: SECOND_ID,
    expectedTaskAbsent: false,
    beforeStatus: "in_progress" as const,
    expectedUpdatedAt: WHEN,
    notificationTargets: [],
  };
  const arguments_ =
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.finalizeAttendanceAction.parse({
      ...base,
      followUpTaskTargets: [inserted, retained],
      evaluationTaskTarget: null,
    });
  const disclosure = meetingsEffectDisclosure(
    "finalizeAttendanceAction",
    arguments_
  );
  assert.deepEqual(
    disclosure.counts
      .filter(({ label }) => label.includes("tasks"))
      .map(({ label, count, includedInAffectedCount }) => ({
        label,
        count,
        includedInAffectedCount,
      })),
    [
      {
        label: "Follow-up tasks created",
        count: 1,
        includedInAffectedCount: true,
      },
      {
        label: "Existing tasks retained",
        count: 1,
        includedInAffectedCount: false,
      },
    ]
  );
  assert.ok(
    disclosure.beforeAfter.some(
      ({ label, after, count }) =>
        label === "Follow-up and evaluation tasks" &&
        after === "Created or retained" &&
        count === 2
    )
  );
  assert.ok(
    disclosure.consequences.includes(
      "Missing disclosed follow-up and evaluation tasks will be created; existing disclosed tasks will be retained unchanged."
    )
  );
});

test("derived attendance plans require one closed raw-input baseline", () => {
  const add = validArguments("addAttendeeAction");
  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.addAttendeeAction.safeParse({
      ...add,
      attendanceDerivation: null,
    }).success,
    false
  );
  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.addAttendeeAction.safeParse({
      ...add,
      attendanceTypeIsDerived: false,
    }).success,
    false
  );

  const toggle = validArguments("toggleAttendanceStatusAction");
  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.toggleAttendanceStatusAction.safeParse({
      ...toggle,
      attendanceDerivation: null,
    }).success,
    false
  );

  const batch = validArguments("recordAttendanceBatchAction");
  const [record] = batch.records as ReadonlyArray<Record<string, unknown>>;
  assert.ok(record);
  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.recordAttendanceBatchAction.safeParse({
      ...batch,
      records: [{ ...record, attendanceDerivation: null }],
    }).success,
    false
  );
});

test("a legal 5,000-character attendee note is disclosed losslessly", () => {
  const note = "x".repeat(5_000);
  const arguments_ = {
    ...validArguments("addAttendeeNoteAction"),
    note,
  };
  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.addAttendeeNoteAction.safeParse(arguments_)
      .success,
    true
  );

  const { confirmation, step } = reviewForArguments(
    "addAttendeeNoteAction",
    arguments_
  );
  const serializedNote = JSON.stringify(note);
  assert.equal(
    joinedPreviewPages(step.contentPreviews, "Note"),
    serializedNote
  );
  assert.equal(
    joinedStatePages(step.beforeAfter, "Attendee note activity", "after"),
    note
  );
  assert.ok(
    step.contentPreviews.every(({ content }) => content.length <= 4_000)
  );
  assert.ok(
    step.beforeAfter.every(
      ({ before, after }) => before.length <= 4_000 && after.length <= 4_000
    )
  );
  assert.deepEqual(confirmation.consequences, [
    "The disclosed note will be added to this person's plant-visible activity timeline.",
  ]);
  assert.deepEqual(
    step.resolvedTargets.map(({ label, value }) => ({ label, value })),
    meetingsEffectDisclosure(
      "addAttendeeNoteAction",
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS.addAttendeeNoteAction.parse(arguments_)
    ).targets.map(({ label, value }) => ({ label, value }))
  );
  assert.deepEqual(step.counts, [
    { label: "Person activities created", count: 1 },
  ]);
});

test("a cardinality-heavy legal plan preserves every exact target and plan byte", () => {
  const records = Array.from({ length: 100 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    const personSuffix = String(index + 1_001).padStart(12, "0");
    return {
      attendanceId: `10000000-0000-4000-8000-${suffix}`,
      personId: `20000000-0000-4000-8000-${personSuffix}`,
      before: {
        id: `10000000-0000-4000-8000-${suffix}`,
        exists: true,
        status: "absent",
        attendanceType: null,
        responseStatus: "confirmed",
        notes: null,
        updatedAt: WHEN,
      },
      afterStatus: "attended",
      afterAttendanceType: "first_time",
      attendanceDerivation: {
        personStatus: "prospect" as const,
        meetingDatetime: WHEN,
        priorAttendances: [],
      },
    };
  });
  const arguments_ = {
    ...validArguments("recordAttendanceBatchAction"),
    records,
  };
  const parsed =
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.recordAttendanceBatchAction.parse(
      arguments_
    );
  const expected = meetingsEffectDisclosure(
    "recordAttendanceBatchAction",
    parsed
  );
  assert.equal(expected.targets.length, 201);

  const { confirmation, step } = reviewForArguments(
    "recordAttendanceBatchAction",
    arguments_
  );
  assert.equal(step.resolvedTargets.length, expected.targets.length);
  assert.deepEqual(
    step.resolvedTargets.map(({ label, value }) => ({
      label,
      value,
    })),
    expected.targets.map(({ label, value }) => ({ label, value }))
  );
  assert.deepEqual(
    JSON.parse(
      joinedPreviewPages(step.contentPreviews, "Complete immutable plan")
    ),
    arguments_
  );
  assert.deepEqual(step.counts, [
    { label: "Attendance records changed", count: 100 },
  ]);
  assert.deepEqual(confirmation.consequences, expected.consequences);
  assert.equal(step.reversibility, expected.reversibility);
  assert.ok(
    step.contentPreviews.every(({ content }) => content.length <= 4_000)
  );
  assert.ok(
    step.beforeAfter.every(
      ({ before, after }) => before.length <= 4_000 && after.length <= 4_000
    )
  );
});

test("a 101-record delete snapshot discloses every source-owned dependent", () => {
  const attendanceIds = Array.from(
    { length: 101 },
    (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  const confirmationTokenIds = [
    "90000000-0000-4000-8000-000000000001",
    "90000000-0000-4000-8000-000000000002",
  ];
  const arguments_ = {
    ...validArguments("deleteMeetingAction"),
    expectedAttendanceIds: attendanceIds,
    expectedChecklistItemIds: [],
    expectedResponseIds: [],
    expectedEvaluationId: null,
    expectedInvitationIds: [],
    expectedConfirmationTokenIds: confirmationTokenIds,
    pendingNotifications: [],
  };
  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.deleteMeetingAction.safeParse(arguments_)
      .success,
    true
  );
  const { confirmation, step } = reviewForArguments(
    "deleteMeetingAction",
    arguments_
  );
  assert.deepEqual(
    step.resolvedTargets
      .filter(({ label }) => label === "Attendance record")
      .map(({ value }) => value),
    attendanceIds
  );
  assert.deepEqual(
    step.counts.find(({ label }) => label === "Attendance records removed"),
    { label: "Attendance records removed", count: 101 }
  );
  assert.deepEqual(
    step.resolvedTargets
      .filter(({ label }) => label === "Confirmation token")
      .map(({ value }) => value),
    confirmationTokenIds
  );
  assert.deepEqual(
    step.counts.find(({ label }) => label === "Confirmation tokens removed"),
    { label: "Confirmation tokens removed", count: 2 }
  );
  assert.deepEqual(
    JSON.parse(
      joinedPreviewPages(step.contentPreviews, "Complete immutable plan")
    ),
    arguments_
  );
  assert.equal(confirmation.steps[0]?.effectKind, "destructive");
});

test("a legal large notification plan keeps every target and baseline row", () => {
  const notificationTargets = Array.from({ length: 101 }, (_, index) => ({
    notificationId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    recipientUserId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    category: "meetings" as const,
    type: "meeting.reminder",
    title: `Reminder ${index + 1}`,
    body: `Meeting reminder ${index + 1}`,
    entityType: "meeting" as const,
    entityId: ID,
    dedupeKey: `meeting-reminder-${index + 1}`,
    scheduledFor: WHEN,
    expectedAbsent: true as const,
  }));
  const pendingNotifications = Array.from({ length: 101 }, (_, index) => ({
    notificationId: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    recipientUserId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    type: "meeting.reminder",
    entityId: ID,
    dedupeKey: `pending-meeting-reminder-${index + 1}`,
    scheduledFor: WHEN,
    beforeStatus: "pending" as const,
    expectedUpdatedAt: WHEN,
  }));
  const activeNotifications = Array.from({ length: 501 }, (_, index) => ({
    notificationId: `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    recipientUserId: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    type: "meeting.reminder",
    entityId: ID,
    dedupeKey: `active-meeting-reminder-${index + 1}`,
    scheduledFor: WHEN,
    status: "pending" as const,
    expectedUpdatedAt: WHEN,
  }));
  const base = validArguments("updateMeetingAction");
  const arguments_ = {
    ...base,
    pendingNotifications,
    notificationTargets,
    notificationBaseline: {
      coreGroupUserIds: [],
      reminderUserIds: [],
      activeNotifications,
    },
  };

  assert.equal(
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS.updateMeetingAction.safeParse(arguments_)
      .success,
    true
  );
  const { step } = reviewForArguments("updateMeetingAction", arguments_);
  assert.deepEqual(
    JSON.parse(
      joinedPreviewPages(step.contentPreviews, "Complete immutable plan")
    ),
    arguments_
  );
  assert.equal(
    step.resolvedTargets.filter(({ label }) => label === "Notification").length,
    202
  );
  assert.deepEqual(
    step.counts.filter(({ label }) => label.startsWith("Notifications ")),
    [
      { label: "Notifications scheduled", count: 101 },
      { label: "Notifications cancelled", count: 101 },
    ]
  );
  assert.equal(
    (
      JSON.parse(
        joinedPreviewPages(step.contentPreviews, "Complete immutable plan")
      ) as typeof arguments_
    ).notificationBaseline.activeNotifications.length,
    501
  );
});

test("reschedule confirmation renders scheduled and cancelled notification changes", () => {
  const { confirmation, step } = reviewForArguments(
    "updateMeetingAction",
    validArguments("updateMeetingAction")
  );
  const notificationLabels = step.beforeAfter
    .map(({ label }) => label)
    .filter((label) => label.startsWith("Notifications "));
  assert.deepEqual(notificationLabels, [
    "Notifications scheduled",
    "Notifications cancelled",
  ]);
  assert.equal(new Set(notificationLabels).size, notificationLabels.length);

  const markup = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: renderableEvryArtifact(
        publicEvryArtifact(
          hydrateStoredEvryConversationArtifact(
            parseEvryConversationArtifactDocument(confirmation)
          )
        )
      ),
    })
  );
  assert.match(markup, /Notifications scheduled/);
  assert.match(markup, /Notifications cancelled/);
  assert.match(markup, /Absent/);
  assert.match(markup, /Pending/);
  assert.match(markup, /Scheduled/);
  assert.match(markup, /Cancelled/);
});

test("meeting updates disclose the after datetime as the absolute time", () => {
  const before = "2026-08-29T14:00:00.000Z";
  const after = "2026-08-30T18:30:00.000Z";
  const base = validArguments("updateMeetingAction");
  const arguments_ = {
    ...base,
    timezone: "America/New_York",
    before: { ...(base.before as Record<string, unknown>), datetime: before },
    after: { ...(base.after as Record<string, unknown>), datetime: after },
  };
  const { step } = reviewForArguments("updateMeetingAction", arguments_);
  assert.equal(step.dateTime?.startsAt.instantUtc, after);
  assert.equal(
    JSON.parse(
      joinedPreviewPages(step.contentPreviews, "Complete immutable plan")
    ).after.datetime,
    after
  );
});
