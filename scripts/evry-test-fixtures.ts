import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { getTableName, type InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as s from "../src/db/schema";
import {
  addCalendarDays,
  toCalendarDate,
  instantAtZonedHour,
} from "../src/lib/datetime";
import { TEAM_TEMPLATES } from "../src/lib/ministry-teams/role-templates";
import { LAUNCH_MILESTONE_TEMPLATES } from "../src/lib/launch/milestones";
import { weekStartOf } from "../src/lib/phase-engine/planter-checkin";
import { recurrenceRuleSchema } from "../src/lib/tasks/recurrence";

/** Stable, private QA identities. Never discover reset targets by display name. */
export function fixtureId(key: string): string {
  const hex = createHash("sha256")
    .update(`everyfield:evry-test:v1:${key}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const EVRY_TEST_CHURCH_ID = fixtureId("church");
export const EVRY_TEST_CHURCH_NAME = "Evry Test Church";
export const EVRY_TEST_TIME_ZONE = "America/New_York";
export const EVRY_TEST_ACCOUNTS = [
  {
    id: fixtureId("owner"),
    email: "evry-test@everyfield.app",
    name: "Evry Test",
    seat: "owner",
  },
  {
    id: fixtureId("admin"),
    email: "evry-test-admin@everyfield.app",
    name: "Morgan Test",
    seat: "admin",
  },
  {
    id: fixtureId("member"),
    email: "evry-test-member@everyfield.app",
    name: "Jordan Test",
    seat: "member",
  },
] as const;

export function fixtureClock(asOf: Date) {
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("Invalid seed reference time");
  const today = toCalendarDate(asOf, EVRY_TEST_TIME_ZONE);
  const day = (offset: number) =>
    addCalendarDays(new Date(`${today}T00:00:00Z`), offset);
  const at = (offset: number, hour = 12) =>
    instantAtZonedHour(day(offset), hour, EVRY_TEST_TIME_ZONE);
  const wallClock = (offset: number, hour = 18) =>
    new Date(`${day(offset)}T${String(hour).padStart(2, "0")}:00:00Z`);
  return { today, day, at, wallClock };
}

export type SeedBatch = {
  table: string;
  count: number;
  ids: string[];
  sql: string;
  params: unknown[];
};

/** Compiles typed fixture inserts without making database calls. */
export function buildEvryTestFixtures(
  asOf: Date,
  wikiSectionId: string | null
) {
  const db = drizzle.mock();
  const batches: SeedBatch[] = [];
  function add<T extends PgTable>(table: T, rows: InferInsertModel<T>[]) {
    if (!rows.length) return rows;
    const query = db.insert(table).values(rows).toSQL();
    batches.push({
      table: getTableName(table),
      count: rows.length,
      ids: rows.flatMap((row) =>
        "id" in row && typeof row.id === "string" ? [row.id] : []
      ),
      ...query,
    });
    return rows;
  }
  const { today, day, at, wallClock } = fixtureClock(asOf);
  const churchId = EVRY_TEST_CHURCH_ID;
  const owner = EVRY_TEST_ACCOUNTS[0].id;
  const admin = EVRY_TEST_ACCOUNTS[1].id;
  const member = EVRY_TEST_ACCOUNTS[2].id;
  const personId = (index: number) => fixtureId(`person:${index}`);
  const teamId = (key: string) => fixtureId(`team:${key}`);
  const meetingId = (index: number) => fixtureId(`meeting:${index}`);
  const taskId = (index: number) => fixtureId(`task:${index}`);

  add(
    s.households,
    Array.from({ length: 12 }, (_, i) => ({
      id: fixtureId(`household:${i}`),
      churchId,
      name: `${["Rivera", "Chen", "Brooks", "Patel", "Reed", "Kim", "Davis", "Martinez", "Wilson", "Taylor", "Morgan", "Bennett"][i]} household`,
      addressLine1: `${100 + i} Example Lane`,
      city: "Albany",
      state: "NY",
      postalCode: "12207",
      country: "US",
      createdAt: at(-70),
      updatedAt: at(-1),
    }))
  );
  const firstNames = [
    "Alex",
    "Sam",
    "Jamie",
    "Casey",
    "Taylor",
    "Riley",
    "Avery",
    "Jordan",
    "Cameron",
    "Quinn",
    "Drew",
    "Robin",
  ];
  const lastNames = ["Rivera", "Chen", "Brooks", "Patel", "Reed", "Kim"];
  const people: s.NewPerson[] = Array.from({ length: 56 }, (_, i) => ({
    id: personId(i),
    churchId,
    firstName: firstNames[i % firstNames.length],
    lastName: lastNames[Math.floor(i / 12)],
    email: i % 11 === 0 ? null : `person-${i}@evry-test.invalid`,
    phone: i % 9 === 0 ? null : `202-555-${String(100 + i).padStart(4, "0")}`,
    status: s.personStatuses[Math.floor(i / 8)],
    source: s.personSources[i % s.personSources.length],
    backgroundCheckStatus:
      s.backgroundCheckStatuses[i % s.backgroundCheckStatuses.length],
    sourceDetails: "Fictional Evry QA fixture",
    notes:
      i % 2 === 0
        ? "Prefers a weekday afternoon call. Interested in helping with the launch."
        : "Met at the community welcome event. Follow up about availability.",
    householdId: i < 24 ? fixtureId(`household:${Math.floor(i / 2)}`) : null,
    householdRole: i < 24 ? (i % 2 === 0 ? "head" : "spouse") : null,
    city: "Albany",
    state: "NY",
    postalCode: "12207",
    country: "US",
    createdBy: owner,
    createdAt: at(-70 + i),
    updatedAt: at(-1),
  }));
  people.push(
    ...EVRY_TEST_ACCOUNTS.map((account, i) => ({
      id: personId(56 + i),
      churchId,
      firstName: account.name.split(" ")[0],
      lastName: "Test",
      email: account.email,
      userId: account.id,
      status: "leader" as const,
      backgroundCheckStatus: "cleared" as const,
      createdBy: owner,
      createdAt: at(-90),
      updatedAt: at(-1),
    }))
  );
  add(s.persons, people);
  add(
    s.tags,
    [
      "Needs follow-up",
      "Interested in serving",
      "New family",
      "Spanish speaking",
      "Launch invitation",
      "Community event",
    ].map((name, i) => ({
      id: fixtureId(`tag:${i}`),
      churchId,
      name,
      color: ["blue", "green", "purple", "orange", "red", "gray"][i],
      createdAt: at(-60),
    }))
  );
  add(
    s.personTags,
    Array.from({ length: 56 }, (_, i) => ({
      id: fixtureId(`person-tag:${i}`),
      churchId,
      personId: personId(i),
      tagId: fixtureId(`tag:${i % 6}`),
      createdAt: at(-2),
    }))
  );
  add(
    s.skillsInventory,
    Array.from({ length: 42 }, (_, i) => ({
      id: fixtureId(`skill:${i}`),
      churchId,
      personId: personId(14 + i),
      skillCategory: s.skillCategories[i % 7],
      skillName: [
        "Vocals",
        "Sound mixing",
        "Scheduling",
        "Small-group facilitation",
        "Guest welcome",
        "Team coordination",
        "Photography",
      ][i % 7],
      proficiency: s.skillProficiencies[i % 4],
      notes: "Available twice a month. Fictional QA skill inventory.",
      createdAt: at(-20),
    }))
  );
  const interviews = add(
    s.interviews,
    Array.from({ length: 24 }, (_, i) => ({
      id: fixtureId(`interview:${i}`),
      churchId,
      personId: personId(24 + i),
      interviewedBy: owner,
      interviewDate: day(-25 + i),
      maturityStatus: "pass",
      maturityNotes: "Consistent participation and openness to feedback.",
      giftedStatus: "pass",
      giftedNotes: "Interested in serving with the welcome team.",
      chemistryStatus: "pass",
      chemistryNotes: "Works well with the current team.",
      rightReasonsStatus: "pass",
      rightReasonsNotes: "Wants to contribute to the local community.",
      seasonStatus: i % 4 === 3 ? "concern" : "pass",
      seasonNotes: "Discuss availability before assigning a weekly role.",
      overallResult: s.interviewResults[i % 4],
      nextSteps: "Invite to orientation and confirm availability.",
      createdAt: at(-25 + i),
    }))
  );
  const assessments = add(
    s.assessments,
    Array.from({ length: 28 }, (_, i) => {
      const score = 2 + (i % 4);
      return {
        id: fixtureId(`assessment:${i}`),
        churchId,
        personId: personId(28 + i),
        assessedBy: owner,
        committedScore: score,
        compelledScore: score,
        contagiousScore: score,
        courageousScore: score,
        totalScore: score * 4,
        committedNotes: "Attends regularly.",
        compelledNotes: "Understands the vision.",
        contagiousNotes: "Invites friends.",
        courageousNotes: "Willing to try a new responsibility.",
        assessmentDate: day(-14 + (i % 12)),
        createdAt: at(-14 + (i % 12)),
      };
    })
  );
  const commitments = add(
    s.commitments,
    Array.from({ length: 24 }, (_, i) => ({
      id: fixtureId(`commitment:${i}`),
      churchId,
      personId: personId(32 + i),
      commitmentType: i < 8 ? "core_group" : "launch_team",
      signedDate: day(-20 + (i % 15)),
      witnessedBy: owner,
      notes: "Fictional signed commitment recorded for QA.",
      createdAt: at(-20 + (i % 15)),
    }))
  );
  add(
    s.personActivities,
    Array.from({ length: 56 }, (_, i) => ({
      id: fixtureId(`note:${i}`),
      churchId,
      personId: personId(i),
      activityType: "note_added",
      metadata: {
        note:
          i % 2 === 0
            ? "After the vision meeting: asked about children's ministry and the next orientation. Call this week."
            : "Follow-up call: interested in volunteering; confirm which Sundays work.",
      },
      performedBy: i % 2 ? admin : owner,
      createdAt: at(-3 + (i % 3)),
    }))
  );

  const teams = add(
    s.ministryTeams,
    TEAM_TEMPLATES.map((team, i) => ({
      id: teamId(team.teamKey),
      churchId,
      name: team.teamName,
      templateKey: team.teamKey,
      type: "predefined",
      description: team.description,
      icon: team.icon,
      leaderId: i === 0 ? personId(56) : i < 8 ? personId(40 + i) : null,
      status: i < 8 ? "active" : "forming",
      phaseIntroduced: "phase_3",
      sortOrder: team.sortOrder,
      responsibilitiesSeededAt: at(-30),
      createdBy: owner,
      createdAt: at(-45),
      updatedAt: at(-1),
    }))
  );
  const roleRows: s.NewTeamRole[] = [];
  const memberships: s.NewTeamMembership[] = [];
  TEAM_TEMPLATES.forEach((team, t) =>
    team.roles.forEach((role, r) => {
      const filled = t < 8 && r < 2;
      const id = fixtureId(`role:${team.teamKey}:${role.key}`);
      roleRows.push({
        id,
        churchId,
        teamId: teamId(team.teamKey),
        name: role.roleName,
        description: role.description,
        isLeadershipRole: role.isLeadership,
        timeCommitment: role.timeCommitment,
        status: filled ? "filled" : "open",
        sortOrder: role.sortOrder,
        createdBy: owner,
        createdAt: at(-40),
        updatedAt: at(-1),
      });
      if (filled)
        memberships.push({
          id: fixtureId(`membership:${t}:${r}`),
          churchId,
          teamId: teamId(team.teamKey),
          roleId: id,
          personId:
            t === 0 && r === 0
              ? personId(56)
              : personId(40 + ((t + r * 8) % 16)),
          status: "active",
          startDate: day(-30),
          notes: "Confirmed availability for launch preparation.",
          createdBy: owner,
          createdAt: at(-30),
          updatedAt: at(-1),
        });
    })
  );
  add(s.teamRoles, roleRows);
  add(s.teamMemberships, memberships);
  add(
    s.teamResponsibilities,
    TEAM_TEMPLATES.flatMap((team, t) =>
      [
        "Confirm the volunteer schedule",
        "Review equipment and supplies",
        "Complete the launch rehearsal",
      ].map((title, r) => ({
        id: fixtureId(`responsibility:${t}:${r}`),
        churchId,
        teamId: teamId(team.teamKey),
        title,
        sortOrder: r,
        completedAt: r === 0 ? at(-2) : null,
        createdBy: owner,
        createdAt: at(-25),
        updatedAt: at(-2),
      }))
    )
  );
  const programs = add(
    s.trainingPrograms,
    TEAM_TEMPLATES.map((team, i) => ({
      id: fixtureId(`training:${i}`),
      churchId,
      teamId: teamId(team.teamKey),
      name: `${team.teamName} onboarding`,
      description: "Safety, responsibilities, and a practice session.",
      isRequired: true,
      createdBy: owner,
      createdAt: at(-20),
      updatedAt: at(-1),
    }))
  );
  const completions = add(
    s.trainingCompletions,
    memberships
      .filter((_, i) => i % 3 !== 0)
      .map((membership, i) => ({
        id: fixtureId(`training-completion:${i}`),
        churchId,
        personId: membership.personId,
        trainingProgramId: fixtureId(
          `training:${TEAM_TEMPLATES.findIndex((team) => teamId(team.teamKey) === membership.teamId)}`
        ),
        completedAt: at(-5),
        verifiedBy: admin,
        notes: "Completed the practice session.",
        createdBy: owner,
        createdAt: at(-5),
        updatedAt: at(-5),
      }))
  );
  add(s.locations, [
    {
      id: fixtureId("location"),
      churchId,
      name: "Evry Community Center",
      address: "100 Example Lane, Albany, NY 12207",
      capacity: 180,
      cost: "250.00",
      notes: "Fictional venue. Parking is behind the building.",
      isActive: true,
      createdAt: at(-50),
      updatedAt: at(-1),
    },
  ]);
  const meetingSpecs: {
    title: string;
    type: s.MeetingType;
    offset: number;
    status: s.MeetingStatus;
  }[] = [
    {
      title: "Vision Night 1",
      type: "vision_meeting",
      offset: -28,
      status: "completed",
    },
    {
      title: "Vision Night 2",
      type: "vision_meeting",
      offset: -14,
      status: "completed",
    },
    {
      title: "Vision Night 3",
      type: "vision_meeting",
      offset: -3,
      status: "completed",
    },
    {
      title: "Vision Night 4",
      type: "vision_meeting",
      offset: 3,
      status: "ready",
    },
    {
      title: "Welcome orientation",
      type: "orientation",
      offset: -7,
      status: "completed",
    },
    {
      title: "Next steps orientation",
      type: "orientation",
      offset: 7,
      status: "planning",
    },
    {
      title: "Worship rehearsal",
      type: "team_meeting",
      offset: 0,
      status: "ready",
    },
    {
      title: "Welcome team planning",
      type: "team_meeting",
      offset: 1,
      status: "planning",
    },
    {
      title: "Cancelled planning session",
      type: "team_meeting",
      offset: -1,
      status: "cancelled",
    },
  ];
  const meetings = add(
    s.churchMeetings,
    meetingSpecs.map((meeting, i) => ({
      id: meetingId(i),
      churchId,
      title: meeting.title,
      type: meeting.type,
      datetime: wallClock(meeting.offset, 18),
      status: meeting.status,
      locationId: fixtureId("location"),
      locationName: "Evry Community Center",
      locationAddress: "100 Example Lane, Albany, NY 12207",
      meetingNumber: meeting.type === "vision_meeting" ? i + 1 : null,
      teamId:
        meeting.type === "team_meeting"
          ? teamId(i === 6 ? "worship" : "assimilation")
          : null,
      meetingSubtype: meeting.type === "team_meeting" ? "rehearsal" : null,
      estimatedAttendance: 16,
      actualAttendance: meeting.status === "completed" ? 12 : null,
      durationMinutes: 90,
      notes:
        "Fictional QA meeting. Bring name tags and the guest welcome packet.",
      agenda: [
        { id: "welcome", title: "Welcome and introductions", minutes: 15 },
        { id: "next-steps", title: "Next steps", minutes: 20 },
      ],
      createdBy: owner,
      createdAt: at(-35),
      updatedAt: at(-1),
    }))
  );
  const completedMeetings = [0, 1, 2, 4];
  const attendance = add(s.meetingAttendance, [
    ...completedMeetings.flatMap((m) =>
      Array.from(
        { length: 16 },
        (_, p): s.NewMeetingAttendanceRecord => ({
          id: fixtureId(`attendance:${m}:${p}`),
          churchId,
          meetingId: meetingId(m),
          personId: personId(8 + p + m),
          attendanceType:
            p < 4 ? "first_time" : p < 10 ? "returning" : "core_group",
          status: p < 12 ? "attended" : p < 14 ? "absent" : "excused",
          responseStatus: p < 12 ? "confirmed" : "declined",
          notes:
            p < 12
              ? "Asked about serving and the next orientation. Follow up personally."
              : "Unable to attend; offer the next date.",
          createdBy: owner,
          createdAt: at(meetingSpecs[m].offset),
          updatedAt: at(meetingSpecs[m].offset),
        })
      )
    ),
    ...[3, 5, 6, 7].flatMap((m) =>
      Array.from({ length: 10 }, (_, p) => ({
        id: fixtureId(`attendance:${m}:${p}`),
        churchId,
        meetingId: meetingId(m),
        personId: personId(8 + p),
        attendanceType: "returning" as const,
        status: "absent" as const,
        invitedById: personId(56),
        responseStatus:
          p < 5
            ? ("confirmed" as const)
            : p < 8
              ? ("interested" as const)
              : ("declined" as const),
        notes:
          "Invited to the upcoming meeting. Attendance has not been taken.",
        createdBy: owner,
        createdAt: at(-2),
        updatedAt: at(-1),
      }))
    ),
  ]);
  add(
    s.meetingResponses,
    completedMeetings.flatMap((m) =>
      Array.from({ length: 10 }, (_, p) => ({
        id: fixtureId(`response:${m}:${p}`),
        churchId,
        meetingId: meetingId(m),
        personId: personId(8 + p + m),
        responseType: s.responseCardTypes[p % 5],
        notes:
          "Fictional response card: please contact me about the next step.",
        recordedById: owner,
        recordedAt: at(meetingSpecs[m].offset),
      }))
    )
  );
  add(
    s.invitations,
    [3, 5, 6, 7].flatMap((m) =>
      Array.from({ length: 10 }, (_, p) => ({
        id: fixtureId(`invitation:${m}:${p}`),
        churchId,
        meetingId: meetingId(m),
        inviterId: personId(56),
        inviteeId: personId(p + 8),
        inviteeName: `${people[p + 8].firstName} ${people[p + 8].lastName}`,
        status: p < 5 ? "confirmed" : p < 8 ? "invited" : "declined",
        createdAt: at(-2),
        updatedAt: at(-1),
      }))
    )
  );
  add(
    s.meetingChecklistItems,
    meetingSpecs.flatMap((_, m) =>
      [
        "Confirm room booking",
        "Print response cards",
        "Set up welcome table",
        "Check microphones",
        "Assign guest follow-up",
      ].map((itemName, i) => ({
        id: fixtureId(`meeting-check:${m}:${i}`),
        churchId,
        meetingId: meetingId(m),
        itemName,
        category: s.checklistCategories[i],
        isChecked: completedMeetings.includes(m) || i < 2,
        assignedTo: personId(56),
        notes: "QA checklist item",
        createdAt: at(-10),
        updatedAt: at(-1),
      }))
    )
  );
  add(
    s.meetingEvaluations,
    completedMeetings.map((m) => ({
      id: fixtureId(`meeting-eval:${m}`),
      churchId,
      meetingId: meetingId(m),
      attendanceScore: 4,
      locationScore: 4,
      logisticsScore: 3,
      agendaScore: 4,
      vibeScore: 4,
      messageScore: 5,
      closeScore: 4,
      nextStepsScore: 3,
      totalScore: "31",
      notes:
        "Good welcome. Leave more time for questions and explain next steps clearly.",
      evaluatedBy: owner,
      createdAt: at(meetingSpecs[m].offset + 1),
      updatedAt: at(meetingSpecs[m].offset + 1),
    }))
  );

  const taskRows: s.NewTask[] = (
    [
      {
        id: taskId(0),
        title: "Call Alex about orientation",
        dueDate: day(0),
        assignedToId: owner,
        status: "not_started",
        category: "follow_up",
        relatedType: "person",
        relatedId: personId(0),
        priority: "high",
      },
      {
        id: taskId(1),
        title: "Confirm tonight's rehearsal equipment",
        dueDate: day(0),
        assignedToId: owner,
        status: "in_progress",
        category: "ministry_team",
        relatedType: "team",
        relatedId: teamId("worship"),
        priority: "medium",
      },
      {
        id: taskId(2),
        title: "Send yesterday's welcome follow-up",
        dueDate: day(-1),
        assignedToId: owner,
        status: "not_started",
        category: "follow_up",
        relatedType: "person",
        relatedId: personId(8),
        priority: "urgent",
      },
      {
        id: taskId(3),
        title: "Resolve the overdue venue invoice",
        dueDate: day(-7),
        assignedToId: owner,
        status: "blocked",
        category: "facilities",
        priority: "high",
      },
      {
        id: taskId(4),
        title: "Prepare next week's orientation packet",
        dueDate: day(5),
        assignedToId: owner,
        status: "not_started",
        category: "administrative",
        priority: "low",
      },
      {
        id: taskId(5),
        title: "Completed welcome call",
        dueDate: day(0),
        assignedToId: owner,
        status: "complete",
        completedAt: at(0, 8),
        completedById: owner,
        category: "follow_up",
        relatedType: "person",
        relatedId: personId(10),
        priority: "medium",
      },
      {
        id: taskId(6),
        title: "Morgan's room setup check",
        dueDate: day(0),
        assignedToId: admin,
        status: "not_started",
        category: "facilities",
        priority: "high",
      },
      {
        id: taskId(7),
        title: "Jordan's welcome shift",
        dueDate: day(0),
        assignedToId: member,
        status: "not_started",
        category: "ministry_team",
        priority: "medium",
      },
      {
        id: taskId(8),
        title: "Assign an owner to Casey's follow-up",
        dueDate: day(1),
        assignedToId: null,
        status: "not_started",
        category: "follow_up",
        relatedType: "person",
        relatedId: personId(15),
        priority: "medium",
      },
      {
        id: taskId(9),
        title: "Weekly volunteer check-in",
        dueDate: day(2),
        assignedToId: owner,
        status: "not_started",
        category: "recurring",
        isRecurring: true,
        recurrenceRule: recurrenceRuleSchema.parse({ interval: "weekly" }),
        priority: "medium",
      },
      {
        id: taskId(10),
        title: "Print the orientation handouts",
        dueDate: day(4),
        assignedToId: member,
        parentTaskId: taskId(4),
        status: "not_started",
        category: "administrative",
        priority: "low",
      },
    ] satisfies Omit<s.NewTask, "churchId" | "createdById">[]
  ).map((row) => ({
    churchId,
    createdById: owner,
    createdAt: at(-10),
    updatedAt: at(-1),
    description:
      "<p>Fictional QA task. Check the details, assignee, and due date before completing.</p>",
    ...row,
  }));
  LAUNCH_MILESTONE_TEMPLATES.forEach((milestone, m) =>
    milestone.tasks.forEach((task, t) =>
      taskRows.push({
        id: fixtureId(`launch-task:${m}:${t}`),
        churchId,
        title: task.title,
        description: task.description,
        category: "launch_prep",
        status: m < 4 ? "complete" : "not_started",
        completedAt: m < 4 ? at(-2) : null,
        completedById: m < 4 ? owner : null,
        assignedToId: m % 2 ? admin : owner,
        createdById: owner,
        createdAt: at(-20),
        updatedAt: at(-2),
      })
    )
  );
  for (let i = 16; i < 24; i++) {
    taskRows.push({
      id: taskId(i),
      churchId,
      createdById: owner,
      title: `Follow up with ${people[i].firstName} ${people[i].lastName}`,
      category: "follow_up",
      status: "not_started",
      priority: "medium",
      relatedType: "person",
      relatedId: personId(i),
      dueDate: day(1 + (i % 4)),
      assignedToId: i === 23 ? null : EVRY_TEST_ACCOUNTS[i % 3].id,
      createdAt: at(-3),
      updatedAt: at(-1),
    });
  }
  add(s.tasks, taskRows);
  add(s.taskDependencies, [
    {
      id: fixtureId("dependency"),
      churchId,
      taskId: taskId(4),
      prerequisiteTaskId: taskId(1),
      createdAt: at(-2),
    },
  ]);
  const launchId = fixtureId("launch");
  const launch = add(s.launches, [
    {
      id: launchId,
      churchId,
      targetDate: day(
        28 + ((7 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7)
      ),
      status: "scheduled",
      createdAt: at(-30),
      updatedAt: at(-1),
    },
  ]);
  const milestones = add(
    s.launchMilestones,
    LAUNCH_MILESTONE_TEMPLATES.map((milestone, m) => ({
      id: fixtureId(`milestone:${m}`),
      churchId,
      launchId,
      templateKey: milestone.templateKey,
      area: milestone.area,
      title: milestone.title,
      description: milestone.description,
      sortOrder: m,
      completedAt: m < 4 ? at(-2) : null,
      completedByUserId: m < 4 ? owner : null,
      createdAt: at(-20),
      updatedAt: at(-2),
    }))
  );
  add(
    s.launchMilestoneTasks,
    LAUNCH_MILESTONE_TEMPLATES.flatMap((milestone, m) =>
      milestone.tasks.map((_, t) => ({
        id: fixtureId(`milestone-task:${m}:${t}`),
        churchId,
        milestoneId: fixtureId(`milestone:${m}`),
        taskId: fixtureId(`launch-task:${m}:${t}`),
        createdAt: at(-20),
      }))
    )
  );
  add(s.launchEvents, [
    {
      id: fixtureId("launch-event"),
      churchId,
      launchId,
      event: "scheduled",
      previousStatus: "planning",
      status: "scheduled",
      targetDate: day(28),
      actorUserId: owner,
      note: "Fictional launch scheduled for QA.",
      createdAt: at(-30),
    },
  ]);

  add(
    s.messageTemplates,
    [
      "Welcome to Evry Test Church",
      "Orientation invitation",
      "Volunteer reminder",
    ].map((name, i) => ({
      id: fixtureId(`template:${i}`),
      churchId,
      name,
      category: i === 1 ? "meeting_invitation" : "follow_up",
      channel: "email",
      subject: name,
      body: "Hi {{first_name}},\n\nThanks for connecting with {{church_name}}. We look forward to seeing you.\n\n{{pastor_name}}",
      isSystem: false,
      createdAt: at(-20),
      updatedAt: at(-1),
    }))
  );
  add(
    s.communications,
    [
      "Welcome email draft",
      "QA historical orientation invitation",
      "QA failed volunteer reminder",
    ].map((subject, i) => ({
      id: fixtureId(`communication:${i}`),
      churchId,
      subject,
      body: "Fictional QA communication. No message was sent by the seed script.",
      channel: "email",
      status: i === 0 ? "draft" : i === 1 ? "sent" : "failed",
      sentAt: i === 1 ? at(-4) : null,
      templateId: fixtureId(`template:${i}`),
      meetingId: i === 1 ? meetingId(5) : null,
      recipientCount: i === 0 ? 0 : 4,
      createdById: owner,
      createdAt: at(-4),
      updatedAt: at(-4),
    }))
  );
  add(
    s.communicationRecipients,
    [1, 2].flatMap((c) =>
      Array.from({ length: 4 }, (_, p) => ({
        id: fixtureId(`recipient:${c}:${p}`),
        churchId,
        communicationId: fixtureId(`communication:${c}`),
        personId: personId(p + 1),
        email: `person-${p + 1}@evry-test.invalid`,
        channel: "email",
        status: c === 1 ? "delivered" : "failed",
        deliveredAt: c === 1 ? at(-4) : null,
        externalId: `evry-test-fixture:${c}:${p}`,
        errorMessage:
          c === 2
            ? "Simulated QA delivery failure. No provider contacted."
            : null,
      }))
    )
  );
  add(
    s.wikiArticles,
    [
      "Welcome team handbook",
      "Orientation checklist",
      "Launch rehearsal notes",
    ].map((title, i) => ({
      id: fixtureId(`wiki:${i}`),
      churchId,
      slug: `evry-test/${["welcome", "orientation", "rehearsal"][i]}`,
      title,
      content: `# ${title}\n\nFictional Evry QA content.\n\n## Our process\n\n- Welcome each guest.\n- Record their questions.\n- Assign a follow-up owner.`,
      excerpt: "A practical QA handbook for the Evry test plant.",
      contentType: "guide",
      sectionId: wikiSectionId,
      phase: 4,
      status: i === 2 ? "draft" : "published",
      publishedAt: i === 2 ? null : at(-10),
      createdAt: at(-10),
      updatedAt: at(-1),
    }))
  );
  add(s.wikiBookmarks, [
    {
      id: fixtureId("bookmark"),
      userId: owner,
      articleSlug: "evry-test/welcome",
      createdAt: at(-2),
    },
  ]);
  add(
    s.wikiProgress,
    ["welcome", "orientation"].map((slug, i) => ({
      id: fixtureId(`progress:${i}`),
      userId: owner,
      articleSlug: `evry-test/${slug}`,
      status: i === 0 ? "completed" : "in_progress",
      scrollPosition: i === 0 ? 100 : 45,
      completedAt: i === 0 ? at(-1) : null,
      lastViewedAt: at(-1),
      createdAt: at(-2),
      updatedAt: at(-1),
    }))
  );
  add(s.wikiArticleFeedback, [
    {
      id: fixtureId("wiki-feedback"),
      churchId,
      userId: owner,
      articleSlug: "evry-test/welcome",
      rating: "helpful",
      createdAt: at(-1),
      updatedAt: at(-1),
    },
  ]);
  add(s.phaseTransitions, [
    {
      id: fixtureId("phase-declaration"),
      churchId,
      fromPhase: 0,
      toPhase: 3,
      kind: "initial_declaration",
      initiatedById: owner,
      reason: "Fictional QA starting phase.",
      rubricVersion: "evry-test-fixture-v1",
      createdAt: at(-60),
    },
    {
      id: fixtureId("phase-transition"),
      churchId,
      fromPhase: 3,
      toPhase: 4,
      kind: "transition",
      initiatedById: owner,
      reason: "Fictional QA move into pre-launch.",
      rubricVersion: "evry-test-fixture-v1",
      createdAt: at(-30),
    },
  ]);
  add(s.phasePromptAnswers, [
    {
      id: fixtureId("phase-answer"),
      churchId,
      transitionId: fixtureId("phase-transition"),
      answer: "accepted",
      answeredById: owner,
      createdAt: at(-30),
    },
  ]);
  const signals = add(
    s.plantSignals,
    [
      "values_documented",
      "financial_base_established",
      "core_group_giving",
      "prayer_rhythm_established",
      "prayer_in_gatherings",
      "systems_tested",
    ].map((signalKey, i) => ({
      id: fixtureId(`signal:${i}`),
      churchId,
      signalKey,
      value: i !== 5,
      attestedById: owner,
      attestedAt: at(-2),
      createdAt: at(-20),
      updatedAt: at(-2),
    }))
  );
  add(
    s.planterCheckins,
    [0, 1, 2].map((i) => ({
      id: fixtureId(`checkin:${i}`),
      churchId,
      weekStart: weekStartOf(at(-7 * i)),
      spiritually: "steady",
      marriageFamily: "steady",
      financially: "strained",
      pace: "steady",
      note: "Fictional private QA check-in.",
      answeredById: owner,
      createdAt: at(-7 * i),
      updatedAt: at(-7 * i),
    }))
  );
  add(
    s.notifications,
    Array.from({ length: 8 }, (_, i) => ({
      id: fixtureId(`notification:${i}`),
      churchId,
      recipientUserId: owner,
      category: i % 2 ? "meetings" : "tasks",
      type: i % 2 ? "meeting.scheduled" : "task.assigned",
      title: i % 2 ? "Upcoming QA meeting" : "QA task needs attention",
      body: "Fictional in-app notification. No email delivery is queued.",
      entityType: i % 2 ? "meeting" : "task",
      entityId: i % 2 ? meetingId(3) : taskId(0),
      status: "delivered",
      readAt: i < 3 ? at(-1) : null,
      scheduledFor: at(-1),
      dedupeKey: `evry-test:${i}`,
      createdAt: at(-1),
      updatedAt: at(-1),
    }))
  );
  add(
    s.notificationDeliveries,
    Array.from({ length: 8 }, (_, i) => ({
      id: fixtureId(`delivery:${i}`),
      notificationId: fixtureId(`notification:${i}`),
      channel: "in_app",
      status: "sent",
      sentAt: at(-1),
      createdAt: at(-1),
      updatedAt: at(-1),
    }))
  );
  add(
    s.notificationPreferences,
    EVRY_TEST_ACCOUNTS.flatMap((account) =>
      s.notificationCategories.map((category, i) => ({
        id: fixtureId(`preference:${account.id}:${i}`),
        userId: account.id,
        category,
        channel: "email",
        enabled: false,
        intent: "chosen",
        createdAt: at(-1),
        updatedAt: at(-1),
      }))
    )
  );
  return {
    batches,
    rows: {
      people,
      interviews,
      assessments,
      commitments,
      teams,
      memberships,
      programs,
      completions,
      meetings,
      attendance,
      tasks: taskRows,
      launch,
      milestones,
      signals,
    },
    today,
    expected: {
      people: 59,
      recruitedContacts: 56,
      ownerPendingDueToday: 2,
      ownerPendingOverdue: 2,
      ownerCompletedDueToday: 1,
      meetings: 9,
      ministries: TEAM_TEMPLATES.length,
      launchMilestones: LAUNCH_MILESTONE_TEMPLATES.length,
      completedLaunchMilestones: 4,
      unreadNotifications: 5,
    },
    owner,
    churchId,
  };
}
