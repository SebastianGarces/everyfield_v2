import {
  assembleFactSnapshot,
  type SnapshotInputs,
} from "../src/lib/phase-engine/signals/build-fact-snapshot";
import {
  FOLLOW_UP_STATUSES,
  COMMITTED_STATUSES,
} from "../src/lib/people/status.shared";
import {
  EVRY_TEST_ACCOUNTS,
  type buildEvryTestFixtures,
} from "./evry-test-fixtures";

/** Validate fixture fields before compiling the single atomic seed transaction. */
function present<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Incomplete QA snapshot fixture");
  return value;
}

function counts(ids: string[]) {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([personId, count]) => ({ personId, count }));
}

/** Uses the same signal assembler as production, with the rows about to be inserted. */
export function buildEvryTestSnapshot(
  fixture: ReturnType<typeof buildEvryTestFixtures>,
  asOf: Date
) {
  const r = fixture.rows;
  const attendance = r.attendance
    .filter((row) => row.status === "attended")
    .map((row) => {
      const meeting = present(
        r.meetings.find((meeting) => meeting.id === row.meetingId)
      );
      return {
        personId: row.personId,
        meetingType: meeting.type,
        datetime: meeting.datetime,
      };
    });
  const launch = present(r.launch[0]);
  const inputs: SnapshotInputs = {
    church: { id: fixture.churchId, currentPhase: 4 },
    launch: {
      targetDate: launch.targetDate ?? null,
      status: present(launch.status),
      outcomeRecordedAt: null,
      attendanceCount: null,
      decisionsCount: null,
    },
    launchMilestones: r.milestones.map((row) => ({
      id: present(row.id),
      completedAt: row.completedAt ?? null,
    })),
    commitments: r.commitments
      .map((row) => ({
        personId: row.personId,
        commitmentType: row.commitmentType,
        signedDate: row.signedDate,
      }))
      .sort((a, b) => a.signedDate.localeCompare(b.signedDate)),
    personSources: r.people
      .filter((row) => !row.userId)
      .map((row) => ({
        personId: present(row.id),
        source: row.source ?? null,
      })),
    visionMeetings: r.meetings
      .filter(
        (row) => row.type === "vision_meeting" && row.status === "completed"
      )
      .map((row) => ({
        id: present(row.id),
        datetime: row.datetime,
        actualAttendance: row.actualAttendance ?? null,
      }))
      .sort((a, b) => b.datetime.getTime() - a.datetime.getTime()),
    followUp: r.people
      .filter((row) =>
        FOLLOW_UP_STATUSES.some((status) => status === row.status)
      )
      .map((row) => ({
        id: present(row.id),
        status: present(row.status),
        updatedAt: present(row.updatedAt),
      })),
    followUpTasks: r.tasks
      .filter(
        (row) => row.category === "follow_up" && row.status !== "complete"
      )
      .map((row) => {
        const account = EVRY_TEST_ACCOUNTS.find(
          (account) => account.id === row.assignedToId
        );
        return {
          taskId: present(row.id),
          title: row.title,
          dueDate: row.dueDate ?? null,
          contactId:
            row.relatedType === "person" ? (row.relatedId ?? null) : null,
          assignedToId: account?.id ?? null,
          ownerName: account?.name ?? null,
          ownerEmail: account?.email ?? null,
          ownerIsCommitted: !!account,
          ownerIsPlanter: account?.seat === "owner",
        };
      }),
    ministryTeams: r.teams.map((row) => ({
      id: present(row.id),
      name: row.name,
      leaderId: row.leaderId ?? null,
    })),
    leadershipCandidates: r.people
      .filter(
        (row) =>
          !row.userId &&
          COMMITTED_STATUSES.some((status) => status === row.status)
      )
      .map((row) => ({
        id: present(row.id),
        status: present(row.status),
        createdAt: present(row.createdAt),
      })),
    meetingsAttendedByPerson: counts(
      attendance
        .filter((row) => row.meetingType === "vision_meeting")
        .map((row) => row.personId)
    ),
    activeMembershipsByPerson: counts(
      r.memberships
        .filter((row) => row.status === "active")
        .map((row) => row.personId)
    ),
    teamLeaderPersonIds: [
      ...new Set(
        r.teams.flatMap((row) => (row.leaderId ? [row.leaderId] : []))
      ),
    ],
    // This dataset intentionally has one interview/assessment per person.
    interviewsByPerson: r.interviews.map((row) => ({
      personId: row.personId,
      count: 1,
      lastResult: present(row.overallResult),
      lastDate: row.interviewDate,
    })),
    assessmentsByPerson: r.assessments.map((row) => ({
      personId: row.personId,
      count: 1,
      lastTotal: row.totalScore,
      lastDate: row.assessmentDate,
    })),
    attendance,
    trainingPrograms: r.programs.map((row) => ({
      id: present(row.id),
      isRequired: present(row.isRequired),
    })),
    trainingCompletions: r.completions.map((row) => ({
      personId: row.personId,
      trainingProgramId: row.trainingProgramId,
    })),
    plantSignals: r.signals.map((row) => ({
      signalKey: row.signalKey,
      value: row.value,
      attestedAt: present(row.attestedAt),
    })),
  };
  // Match production's ordered person and signal reads for stable evidence IDs.
  inputs.personSources.sort((a, b) => a.personId.localeCompare(b.personId));
  inputs.followUp.sort((a, b) => a.id.localeCompare(b.id));
  inputs.leadershipCandidates.sort((a, b) => a.id.localeCompare(b.id));
  inputs.plantSignals.sort((a, b) => a.signalKey.localeCompare(b.signalKey));
  return assembleFactSnapshot(fixture.churchId, inputs, asOf);
}
