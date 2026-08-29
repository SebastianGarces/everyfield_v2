import type { MeetingsActionExport } from "./catalog";
import type { MeetingsEffectArguments } from "./effect-contracts";

export type MeetingsDisclosureTarget = Readonly<{
  label: string;
  value: string;
  source: "meeting" | "person" | "none";
}>;

export type MeetingsDisclosureCount = Readonly<{
  label: string;
  count: number;
  includedInAffectedCount: boolean;
}>;

export type MeetingsDisclosureChange = Readonly<{
  label: string;
  before: unknown;
  after: unknown;
  count: number;
}>;

export type MeetingsEffectDisclosure = Readonly<{
  affectedCount: number;
  targets: readonly MeetingsDisclosureTarget[];
  counts: readonly MeetingsDisclosureCount[];
  beforeAfter: readonly MeetingsDisclosureChange[];
  consequences: readonly string[];
  reversibility: "reversible" | "difficult_to_reverse" | "irreversible";
}>;

type BuilderMap = {
  [ExportName in MeetingsActionExport]: (
    args: MeetingsEffectArguments<ExportName>
  ) => MeetingsEffectDisclosure;
};

const target = (
  label: string,
  value: string,
  source: MeetingsDisclosureTarget["source"] = "none"
): MeetingsDisclosureTarget => ({ label, value, source });

const count = (
  label: string,
  value: number,
  includedInAffectedCount = true
): MeetingsDisclosureCount => ({
  label,
  count: value,
  includedInAffectedCount,
});

const change = (
  label: string,
  before: unknown,
  after: unknown,
  value = 1
): MeetingsDisclosureChange => ({ label, before, after, count: value });

function notificationTargets(
  values: readonly Readonly<{ notificationId: string }>[]
): MeetingsDisclosureTarget[] {
  return values.map(({ notificationId }) =>
    target("Notification", notificationId)
  );
}

function notificationCounts(input: {
  scheduled?: readonly unknown[];
  cancelled?: readonly unknown[];
}): MeetingsDisclosureCount[] {
  return [
    ...(input.scheduled?.length
      ? [count("Notifications scheduled", input.scheduled.length, false)]
      : []),
    ...(input.cancelled?.length
      ? [count("Notifications cancelled", input.cancelled.length, false)]
      : []),
  ];
}

function notificationChanges(input: {
  scheduled?: readonly unknown[];
  cancelled?: readonly unknown[];
}): MeetingsDisclosureChange[] {
  return [
    ...(input.scheduled?.length
      ? [
          change(
            "Notifications scheduled",
            "Absent",
            "Scheduled",
            input.scheduled.length
          ),
        ]
      : []),
    ...(input.cancelled?.length
      ? [
          change(
            "Notifications cancelled",
            "Pending",
            "Cancelled",
            input.cancelled.length
          ),
        ]
      : []),
  ];
}

function attendanceCreateDisclosure(input: {
  meetingId: string;
  attendanceId: string;
  personId: string;
  notificationTargets: readonly Readonly<{ notificationId: string }>[];
  label: string;
}): MeetingsEffectDisclosure {
  return {
    affectedCount: 1,
    targets: [
      target("Meeting", input.meetingId, "meeting"),
      target("Person", input.personId, "person"),
      target("Attendance record", input.attendanceId),
      ...notificationTargets(input.notificationTargets),
    ],
    counts: [
      count("Attendance records created", 1),
      ...notificationCounts({ scheduled: input.notificationTargets }),
    ],
    beforeAfter: [
      change("Attendance", "Absent", input.label),
      ...notificationChanges({ scheduled: input.notificationTargets }),
    ],
    consequences: [
      `${input.label} for the disclosed person will be created for this meeting.`,
      ...(input.notificationTargets.length
        ? ["The disclosed meeting notifications will be scheduled."]
        : []),
    ],
    reversibility: "reversible",
  };
}

function quickAddDisclosure(input: {
  meetingId: string;
  personId: string;
  personActivityId: string;
  attendanceId: string;
  notificationTargets: readonly Readonly<{ notificationId: string }>[];
  attendanceLabel: string;
}): MeetingsEffectDisclosure {
  return {
    affectedCount: 3,
    targets: [
      target("Meeting", input.meetingId, "meeting"),
      target("New person", input.personId, "person"),
      target("Person activity", input.personActivityId),
      target("Attendance record", input.attendanceId),
      ...notificationTargets(input.notificationTargets),
    ],
    counts: [
      count("People created", 1),
      count("Person activities created", 1),
      count("Attendance records created", 1),
      ...notificationCounts({ scheduled: input.notificationTargets }),
    ],
    beforeAfter: [
      change("CRM person", "Absent", "Created"),
      change("Person activity", "Absent", "Created"),
      change("Attendance", "Absent", input.attendanceLabel),
      ...notificationChanges({ scheduled: input.notificationTargets }),
    ],
    consequences: [
      "A CRM person, their creation activity, and the disclosed attendance record will be created together.",
      "The new person will become visible throughout this plant.",
      ...(input.notificationTargets.length
        ? ["The disclosed meeting notifications will be scheduled."]
        : []),
    ],
    reversibility: "difficult_to_reverse",
  };
}

function attendanceRemoveDisclosure(input: {
  meetingId: string;
  personId: string;
  attendanceId: string;
  beforeAttendance: unknown;
  responseId?: string;
  beforeResponse?: unknown;
  pendingNotifications: readonly Readonly<{ notificationId: string }>[];
  newNotifications: readonly Readonly<{ notificationId: string }>[];
  label: string;
}): MeetingsEffectDisclosure {
  const responseCount = input.responseId ? 1 : 0;
  return {
    affectedCount: 1,
    targets: [
      target("Meeting", input.meetingId, "meeting"),
      target("Person", input.personId, "person"),
      target("Attendance record", input.attendanceId),
      ...(input.responseId ? [target("Response card", input.responseId)] : []),
      ...notificationTargets(input.pendingNotifications),
      ...notificationTargets(input.newNotifications),
    ],
    counts: [
      count("Attendance records removed", 1),
      ...(responseCount
        ? [count("Response cards removed", responseCount, false)]
        : []),
      ...notificationCounts({
        cancelled: input.pendingNotifications,
        scheduled: input.newNotifications,
      }),
    ],
    beforeAfter: [
      change("Attendance", input.beforeAttendance, "Removed"),
      ...(input.responseId
        ? [change("Response card", input.beforeResponse, "Removed")]
        : []),
      ...notificationChanges({
        cancelled: input.pendingNotifications,
        scheduled: input.newNotifications,
      }),
    ],
    consequences: [
      `${input.label} and every disclosed dependent response will be removed.`,
      ...(input.pendingNotifications.length || input.newNotifications.length
        ? ["The disclosed notification schedule will be replaced exactly."]
        : []),
    ],
    reversibility: "difficult_to_reverse",
  };
}

const BUILDERS = {
  addAttendeeAction: (args) =>
    attendanceCreateDisclosure({
      ...args,
      label: `Created with status ${args.status}`,
    }),
  addToGuestListAction: (args) =>
    attendanceCreateDisclosure({ ...args, label: "Created as invited guest" }),
  addWalkInAttendeeAction: (args) =>
    attendanceCreateDisclosure({ ...args, label: "Created as walk-in" }),

  addAttendeeNoteAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Person", args.personId, "person"),
      target("Person activity", args.activityId),
    ],
    counts: [count("Person activities created", 1)],
    beforeAfter: [change("Attendee note activity", "Absent", args.note)],
    consequences: [
      "The disclosed note will be added to this person's plant-visible activity timeline.",
    ],
    reversibility: "difficult_to_reverse",
  }),

  clearResponseCardAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Person", args.personId, "person"),
      target("Response card", args.responseId),
    ],
    counts: [count("Response cards removed", 1)],
    beforeAfter: [
      change("Response card", args.beforeResponse, "No response card"),
    ],
    consequences: ["The disclosed response card will be permanently removed."],
    reversibility: "difficult_to_reverse",
  }),

  createEvaluationAction: (args) => {
    const completesTask =
      args.evaluationTask !== null &&
      args.evaluationTask.beforeStatus !== "complete";
    return {
      affectedCount: 1 + (completesTask ? 1 : 0),
      targets: [
        target("Meeting", args.meetingId, "meeting"),
        target("Evaluation", args.evaluationId),
        ...(args.evaluationTask
          ? [target("Evaluation task", args.evaluationTask.taskId)]
          : []),
      ],
      counts: [
        count("Evaluations created", 1),
        ...(completesTask ? [count("Tasks completed", 1)] : []),
      ],
      beforeAfter: [
        change("Evaluation", "Absent", "Created"),
        ...(completesTask && args.evaluationTask
          ? [
              change(
                "Evaluation task",
                args.evaluationTask.beforeStatus,
                "complete"
              ),
            ]
          : []),
      ],
      consequences: [
        "The evaluation will be saved for this meeting.",
        ...(completesTask
          ? ["The disclosed evaluation task will be completed."]
          : []),
      ],
      reversibility: completesTask ? "difficult_to_reverse" : "reversible",
    };
  },

  createLocationAction: (args) => ({
    affectedCount: 1,
    targets: [target("New location", args.locationId)],
    counts: [count("Locations created", 1)],
    beforeAfter: [
      change("Location", "Absent", {
        name: args.name,
        address: args.address,
        capacity: args.capacity,
      }),
    ],
    consequences: [
      "The disclosed reusable meeting location will be created for this plant.",
    ],
    reversibility: "reversible",
  }),

  updateLocationAction: (args) => ({
    affectedCount: 1,
    targets: [target("Location", args.locationId)],
    counts: [count("Locations updated", 1)],
    beforeAfter: [change("Location", args.before, args.after)],
    consequences: [
      "The disclosed meeting location will be replaced with the reviewed values.",
    ],
    reversibility: "reversible",
  }),

  createMeetingAction: (args) => {
    const affectedCount =
      1 +
      (args.savedLocationId ? 1 : 0) +
      args.checklistItems.length +
      args.attendanceRows.length;
    return {
      affectedCount,
      targets: [
        target("New meeting", args.meetingId, "meeting"),
        ...(args.savedLocationId
          ? [target("New saved location", args.savedLocationId)]
          : []),
        ...args.checklistItems.map(({ itemId }) =>
          target("Checklist item", itemId)
        ),
        ...args.attendanceRows.map(({ attendanceId, personId }) =>
          target(`Attendance record for ${personId}`, attendanceId)
        ),
        ...notificationTargets(args.notificationTargets),
      ],
      counts: [
        count("Meetings created", 1),
        ...(args.savedLocationId ? [count("Locations created", 1)] : []),
        ...(args.checklistItems.length
          ? [count("Checklist items created", args.checklistItems.length)]
          : []),
        ...(args.attendanceRows.length
          ? [count("Attendance records created", args.attendanceRows.length)]
          : []),
        ...notificationCounts({ scheduled: args.notificationTargets }),
      ],
      beforeAfter: [
        change("Meeting", "Absent", {
          title: args.title,
          type: args.type,
          datetime: args.datetime,
          timezone: args.timezone,
          status: args.status,
        }),
        ...(args.savedLocationId
          ? [change("Saved location", "Absent", "Created")]
          : []),
        ...(args.checklistItems.length
          ? [
              change(
                "Checklist items",
                "Absent",
                "Created",
                args.checklistItems.length
              ),
            ]
          : []),
        ...(args.attendanceRows.length
          ? [
              change(
                "Attendance records",
                "Absent",
                "Created as absent",
                args.attendanceRows.length
              ),
            ]
          : []),
        ...notificationChanges({ scheduled: args.notificationTargets }),
      ],
      consequences: [
        "The meeting and every disclosed checklist and attendance record will be created together.",
        ...(args.savedLocationId
          ? [
              "The typed location will also be saved as a reusable plant location.",
            ]
          : []),
        ...(args.notificationTargets.length
          ? ["The disclosed meeting notifications will be scheduled."]
          : []),
      ],
      reversibility: "reversible",
    };
  },

  deleteMeetingAction: (args) => {
    const affectedCount =
      1 +
      args.expectedAttendanceIds.length +
      args.expectedChecklistItemIds.length +
      args.expectedResponseIds.length +
      args.expectedInvitationIds.length +
      args.expectedConfirmationTokenIds.length +
      (args.expectedEvaluationId ? 1 : 0);
    return {
      affectedCount,
      targets: [
        target("Meeting", args.meetingId, "meeting"),
        ...args.expectedAttendanceIds.map((id) =>
          target("Attendance record", id)
        ),
        ...args.expectedChecklistItemIds.map((id) =>
          target("Checklist item", id)
        ),
        ...args.expectedResponseIds.map((id) => target("Response card", id)),
        ...args.expectedInvitationIds.map((id) => target("Invitation", id)),
        ...args.expectedConfirmationTokenIds.map((id) =>
          target("Confirmation token", id)
        ),
        ...(args.expectedEvaluationId
          ? [target("Evaluation", args.expectedEvaluationId)]
          : []),
        ...notificationTargets(args.pendingNotifications),
      ],
      counts: [
        count("Meetings removed", 1),
        count("Attendance records removed", args.expectedAttendanceIds.length),
        count("Checklist items removed", args.expectedChecklistItemIds.length),
        count("Response cards removed", args.expectedResponseIds.length),
        count("Invitations removed", args.expectedInvitationIds.length),
        count(
          "Confirmation tokens removed",
          args.expectedConfirmationTokenIds.length
        ),
        ...(args.expectedEvaluationId ? [count("Evaluations removed", 1)] : []),
        ...notificationCounts({ cancelled: args.pendingNotifications }),
      ],
      beforeAfter: [
        change("Meeting", args.before, "Removed"),
        ...(affectedCount > 1
          ? [
              change(
                "Dependent records",
                "Present",
                "Removed",
                affectedCount - 1
              ),
            ]
          : []),
        ...notificationChanges({ cancelled: args.pendingNotifications }),
      ],
      consequences: [
        "This permanently deletes the meeting and every disclosed dependent record.",
        ...(args.pendingNotifications.length
          ? ["The disclosed pending reminders will be cancelled."]
          : []),
      ],
      reversibility: "irreversible",
    };
  },

  finalizeAttendanceAction: (args) => {
    const insertedFollowUps = args.followUpTaskTargets.filter(
      ({ expectedTaskAbsent }) => expectedTaskAbsent
    );
    const insertedEvaluation = args.evaluationTaskTarget?.expectedTaskAbsent
      ? 1
      : 0;
    const affectedCount =
      1 +
      args.personStatusChanges.length +
      insertedFollowUps.length +
      insertedEvaluation;
    const tasks = [
      ...args.followUpTaskTargets,
      ...(args.evaluationTaskTarget ? [args.evaluationTaskTarget] : []),
    ];
    const scheduled = tasks.flatMap(
      ({ notificationTargets: values }) => values
    );
    const cancelled = args.evaluationTaskTarget?.pendingNotifications ?? [];
    return {
      affectedCount,
      targets: [
        target("Meeting", args.meetingId, "meeting"),
        ...args.personStatusChanges.flatMap(({ personId, activityId }) => [
          target("Person", personId, "person"),
          target("Person status activity", activityId),
        ]),
        ...tasks.map(({ taskId }) => target("Task", taskId)),
        ...notificationTargets(scheduled),
        ...notificationTargets(cancelled),
      ],
      counts: [
        count("Meetings finalized", 1),
        ...(args.personStatusChanges.length
          ? [count("Person statuses updated", args.personStatusChanges.length)]
          : []),
        ...(insertedFollowUps.length
          ? [count("Follow-up tasks created", insertedFollowUps.length)]
          : []),
        ...(insertedEvaluation
          ? [count("Evaluation tasks created", insertedEvaluation)]
          : []),
        ...(tasks.length - insertedFollowUps.length - insertedEvaluation
          ? [
              count(
                "Existing tasks updated",
                tasks.length - insertedFollowUps.length - insertedEvaluation,
                false
              ),
            ]
          : []),
        count("Plant material-event timestamps updated", 1, false),
        ...notificationCounts({ scheduled, cancelled }),
      ],
      beforeAfter: [
        change(
          "Actual attendance",
          args.expectedActualAttendance,
          args.attendees.length
        ),
        ...(args.personStatusChanges.length
          ? [
              change(
                "Person status",
                "prospect",
                "attendee",
                args.personStatusChanges.length
              ),
            ]
          : []),
        ...(tasks.length
          ? [
              change(
                "Follow-up and evaluation tasks",
                "Reviewed baseline",
                "Created or updated",
                tasks.length
              ),
            ]
          : []),
        change(
          "Plant material-event timestamp",
          args.expectedChurchMaterialEventAt,
          "Execution time"
        ),
        ...notificationChanges({ scheduled, cancelled }),
      ],
      consequences: [
        "The meeting's actual attendance will be finalized from the disclosed attendee set.",
        ...(args.personStatusChanges.length
          ? [
              "The disclosed prospects will become attendees and receive status-history activities.",
            ]
          : []),
        ...(tasks.length
          ? [
              "The disclosed follow-up and evaluation tasks will be created or updated.",
            ]
          : []),
        "The plant material-event timestamp will be advanced.",
        ...(scheduled.length || cancelled.length
          ? [
              "The disclosed task notification schedule will be replaced exactly.",
            ]
          : []),
      ],
      reversibility: "difficult_to_reverse",
    };
  },

  quickAddAttendeeAction: (args) =>
    quickAddDisclosure({ ...args, attendanceLabel: "Created as attendee" }),
  quickAddPersonToGuestListAction: (args) =>
    quickAddDisclosure({
      ...args,
      attendanceLabel: "Created as invited guest",
    }),
  quickAddWalkInAction: (args) =>
    quickAddDisclosure({ ...args, attendanceLabel: "Created as walk-in" }),

  recordAttendanceBatchAction: (args) => ({
    affectedCount: args.records.length,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      ...args.records.flatMap(({ attendanceId, personId }) => [
        target("Attendance record", attendanceId),
        target("Person", personId, "person"),
      ]),
    ],
    counts: [count("Attendance records changed", args.records.length)],
    beforeAfter: [
      change(
        "Attendance records",
        args.records.map(({ personId, before }) => ({ personId, before })),
        args.records.map(({ personId, afterStatus, afterAttendanceType }) => ({
          personId,
          status: afterStatus,
          attendanceType: afterAttendanceType,
        })),
        args.records.length
      ),
    ],
    consequences: [
      "Every disclosed attendance record will move from its reviewed baseline to its reviewed status.",
    ],
    reversibility: "reversible",
  }),

  recordResponseCardAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Person", args.personId, "person"),
      target("Response card", args.responseId),
    ],
    counts: [
      count(
        args.beforeResponse
          ? "Response cards updated"
          : "Response cards created",
        1
      ),
    ],
    beforeAfter: [
      change("Response card", args.beforeResponse ?? "Absent", {
        responseType: args.responseType,
        notes: args.notes,
      }),
    ],
    consequences: [
      "The disclosed person's response card will be created or replaced for this meeting.",
    ],
    reversibility: "reversible",
  }),

  removeAttendeeAction: (args) =>
    attendanceRemoveDisclosure({
      meetingId: args.meetingId,
      personId: args.personId,
      attendanceId: args.beforeAttendance.id!,
      beforeAttendance: args.beforeAttendance,
      responseId: args.beforeResponse?.responseId,
      beforeResponse: args.beforeResponse,
      pendingNotifications: args.pendingNotifications,
      newNotifications: args.notificationTargets,
      label: "The attendee",
    }),
  removeFromGuestListAction: (args) =>
    attendanceRemoveDisclosure({
      meetingId: args.meetingId,
      personId: args.personId,
      attendanceId: args.beforeAttendance.id!,
      beforeAttendance: args.beforeAttendance,
      pendingNotifications: args.pendingNotifications,
      newNotifications: args.notificationTargets,
      label: "The guest",
    }),

  saveAgendaAction: (args) => ({
    affectedCount: 1,
    targets: [target("Meeting", args.meetingId, "meeting")],
    counts: [count("Meeting agendas replaced", 1)],
    beforeAfter: [change("Agenda", args.beforeSections, args.afterSections)],
    consequences: [
      "The meeting agenda will be replaced with the disclosed ordered sections.",
    ],
    reversibility: "reversible",
  }),

  toggleAttendanceStatusAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Person", args.personId, "person"),
    ],
    counts: [count("Attendance records updated", 1)],
    beforeAfter: [
      change(
        "Attendance status",
        args.beforeStatus,
        `${args.afterStatus}; ${args.afterAttendanceType ?? "no attendance type"}`
      ),
    ],
    consequences: [
      "The disclosed attendance record will move to the reviewed status and attendance type.",
    ],
    reversibility: "reversible",
  }),

  toggleChecklistItemAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Checklist item", args.itemId),
    ],
    counts: [count("Checklist items updated", 1)],
    beforeAfter: [
      change("Checklist completion", args.beforeChecked, args.afterChecked),
    ],
    consequences: [
      "The disclosed checklist item's completion state will be updated.",
    ],
    reversibility: "reversible",
  }),

  updateChecklistItemAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Checklist item", args.itemId),
      ...(args.afterAssignedTo
        ? [target("New assignee", args.afterAssignedTo, "person")]
        : []),
    ],
    counts: [count("Checklist items updated", 1)],
    beforeAfter: [
      change(
        "Checklist item",
        { notes: args.beforeNotes, assignedTo: args.beforeAssignedTo },
        { notes: args.afterNotes, assignedTo: args.afterAssignedTo }
      ),
    ],
    consequences: [
      "The disclosed checklist notes and assignee will be replaced together.",
    ],
    reversibility: "reversible",
  }),

  updateMeetingAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      ...notificationTargets(args.pendingNotifications),
      ...notificationTargets(args.notificationTargets),
    ],
    counts: [
      count("Meetings updated", 1),
      ...notificationCounts({
        cancelled: args.pendingNotifications,
        scheduled: args.notificationTargets,
      }),
    ],
    beforeAfter: [
      change("Meeting", args.before, args.after),
      ...notificationChanges({
        cancelled: args.pendingNotifications,
        scheduled: args.notificationTargets,
      }),
    ],
    consequences: [
      "The meeting will be replaced with the disclosed values.",
      ...(args.pendingNotifications.length || args.notificationTargets.length
        ? [
            "The disclosed reminder schedule will be cancelled and rebuilt exactly.",
          ]
        : []),
    ],
    reversibility: "reversible",
  }),

  updateMeetingStatusAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      ...notificationTargets(args.pendingNotifications),
      ...notificationTargets(args.notificationTargets),
    ],
    counts: [
      count("Meeting statuses updated", 1),
      ...notificationCounts({
        cancelled: args.pendingNotifications,
        scheduled: args.notificationTargets,
      }),
    ],
    beforeAfter: [
      change("Meeting status", args.beforeStatus, args.afterStatus),
      ...notificationChanges({
        cancelled: args.pendingNotifications,
        scheduled: args.notificationTargets,
      }),
    ],
    consequences: [
      "The meeting will move to the disclosed lifecycle status.",
      ...(args.pendingNotifications.length || args.notificationTargets.length
        ? [
            "The disclosed reminder schedule will be cancelled and rebuilt exactly.",
          ]
        : []),
    ],
    reversibility: "reversible",
  }),

  updateRsvpStatusAction: (args) => ({
    affectedCount: 1,
    targets: [
      target("Meeting", args.meetingId, "meeting"),
      target("Person", args.personId, "person"),
    ],
    counts: [count("RSVP records updated", 1)],
    beforeAfter: [change("RSVP status", args.beforeStatus, args.afterStatus)],
    consequences: [
      "The disclosed person's RSVP status will be updated for this meeting.",
    ],
    reversibility: "reversible",
  }),
} satisfies BuilderMap;

/**
 * The one exhaustive projection shared by confirmation and live SQL proofs.
 * Adding an action contract without a projector fails TypeScript here.
 */
export function meetingsEffectDisclosure<
  ExportName extends MeetingsActionExport,
>(
  exportName: ExportName,
  args: MeetingsEffectArguments<ExportName>
): MeetingsEffectDisclosure {
  const builder = BUILDERS[exportName] as (
    value: MeetingsEffectArguments<ExportName>
  ) => MeetingsEffectDisclosure;
  const disclosure = builder(args);
  const counted = disclosure.counts
    .filter(({ includedInAffectedCount }) => includedInAffectedCount)
    .reduce((sum, entry) => sum + entry.count, 0);
  if (counted !== disclosure.affectedCount) {
    throw new Error(`Meetings disclosure count drifted for ${exportName}`);
  }
  return Object.freeze(disclosure);
}
