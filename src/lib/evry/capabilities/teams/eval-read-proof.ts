import assert from "node:assert/strict";
import { mock } from "node:test";

const PLANT = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000001";
const CHILDRENS_TEAM = "20000000-0000-4000-8000-000000000002";
const ROLE = "30000000-0000-4000-8000-000000000001";
const PERSON = "40000000-0000-4000-8000-000000000001";
const PROGRAM = "50000000-0000-4000-8000-000000000001";
const MEETING = "60000000-0000-4000-8000-000000000001";
const RESPONSIBILITY = "70000000-0000-4000-8000-000000000001";
const FOREIGN = "90000000-0000-4000-8000-000000000001";

const team = {
  id: TEAM,
  churchId: PLANT,
  name: "Worship",
  templateKey: "worship",
  type: "predefined",
  description: "Leads gathered worship",
  icon: "music",
  leaderId: PERSON,
  responsibilitiesSeededAt: new Date("2030-01-01T00:00:00.000Z"),
  reportsToTeamId: null,
  phaseIntroduced: "phase_2",
  status: "active",
  sortOrder: 1,
  createdBy: PERSON,
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
  filledRoles: 1,
  totalRoles: 1,
  leaderName: "Ada Lovelace",
  roles: [
    {
      id: ROLE,
      churchId: PLANT,
      teamId: TEAM,
      name: "Leader",
      description: "Leads the team",
      reportsToRoleId: null,
      isLeadershipRole: true,
      timeCommitment: "5-10_hours",
      desiredSkills: "Music",
      sortOrder: 0,
      status: "filled",
      createdBy: PERSON,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      assignedPerson: {
        membershipId: "80000000-0000-4000-8000-000000000001",
        id: PERSON,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.test",
        phone: "555-0100",
        backgroundCheckStatus: "not_required",
      },
    },
  ],
} as const;

const seenPlants: string[] = [];
let forceReadFailure = false;
const scoped =
  <Arguments extends unknown[], Result>(result: Result) =>
  async (plantId: string, ..._arguments: Arguments): Promise<Result> => {
    seenPlants.push(plantId);
    if (forceReadFailure) throw new Error("forced Teams read service failure");
    return result;
  };

mock.module("@/lib/ministry-teams/service", {
  namedExports: {
    listTeams: scoped([{ ...team, roles: undefined }]),
    getStaffingSummary: scoped({
      totalTeams: 1,
      totalRoles: 1,
      filledRoles: 1,
      staffingPercentage: 100,
    }),
    getTeam: async (plantId: string, teamId: string) => {
      seenPlants.push(plantId);
      if (forceReadFailure)
        throw new Error("forced Teams read service failure");
      return teamId === TEAM
        ? team
        : teamId === CHILDRENS_TEAM
          ? { ...team, id: CHILDRENS_TEAM, templateKey: "childrens_ministry" }
          : null;
    },
    getTeamCountsForPeople: scoped({ [PERSON]: 1 }),
    getPersonTeams: async (plantId: string, personId: string) => {
      seenPlants.push(plantId);
      if (forceReadFailure)
        throw new Error("forced Teams read service failure");
      return personId === PERSON
        ? [
            {
              membershipId: "80000000-0000-4000-8000-000000000001",
              teamId: TEAM,
              teamName: "Worship",
              roleId: ROLE,
              roleName: "Leader",
              status: "active",
              startDate: "2030-01-01",
            },
          ]
        : [];
    },
    getPersonTraining: async (plantId: string, personId: string) => {
      seenPlants.push(plantId);
      if (forceReadFailure)
        throw new Error("forced Teams read service failure");
      return personId === PERSON
        ? [
            {
              programId: PROGRAM,
              programName: "Safety",
              teamId: TEAM,
              teamName: "Worship",
              isRequired: true,
              completedAt: new Date("2030-01-02T00:00:00.000Z"),
            },
          ]
        : [];
    },
    getAllTeamsHealth: scoped([
      {
        teamId: TEAM,
        teamName: team.name,
        staffingPercent: 100,
        trainingPercent: 100,
        meetingAttendancePercent: 100,
        engagementScore: 100,
        alertLevel: "green",
      },
    ]),
    listTrainingPrograms: scoped([
      {
        id: PROGRAM,
        churchId: PLANT,
        teamId: TEAM,
        name: "Safety",
        description: "Safe practice",
        isRequired: true,
        createdBy: PERSON,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ]),
    getTrainingMatrix: scoped({
      programs: [],
      rows: [
        {
          personId: PERSON,
          personName: "Ada Lovelace",
          completions: { [PROGRAM]: true },
        },
      ],
    }),
    listStoredResponsibilities: scoped([
      {
        id: RESPONSIBILITY,
        churchId: PLANT,
        teamId: TEAM,
        title: "Prepare set",
        sortOrder: 0,
        completedAt: null,
        createdBy: PERSON,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ]),
  },
});

mock.module("@/lib/people/service", {
  namedExports: {
    getPerson: async (plantId: string, personId: string) => {
      seenPlants.push(plantId);
      if (forceReadFailure)
        throw new Error("forced Teams read service failure");
      return personId === PERSON ? { id: PERSON } : null;
    },
    listPeople: scoped({
      people: [
        {
          id: PERSON,
          firstName: "Ada",
          lastName: "Lovelace",
          status: "launch_team",
          email: "ada@example.test",
          phone: "555-0100",
        },
      ],
      total: 1,
    }),
  },
});

mock.module("@/lib/meetings/service", {
  namedExports: {
    listMeetings: scoped({
      meetings: [
        {
          id: MEETING,
          title: "Rehearsal",
          datetime: new Date("2030-02-01T18:00:00.000Z"),
          status: "planning",
          meetingSubtype: "rehearsal",
          durationMinutes: 90,
          locationName: "Room 1",
          notes: "Bring music",
          totalAttendees: 1,
        },
      ],
      total: 1,
    }),
  },
});

async function main(): Promise<void> {
  const [{ executeTeamsRead }, { TEAMS_CAPABILITY_REGISTRY }] =
    await Promise.all([import("./reads"), import("./registrations")]);

  const fixtures = [
    ["teams.read.list", { kind: "read_list", status: null }],
    ["teams.read.detail", { kind: "read_detail", teamId: TEAM }],
    ["teams.read.health", { kind: "read_health" }],
    ["teams.read.training", { kind: "read_training", teamId: TEAM }],
    ["teams.read.meetings", { kind: "read_meetings", teamId: TEAM }],
    [
      "teams.read.responsibilities",
      { kind: "read_responsibilities", teamId: TEAM },
    ],
    ["teams.read.candidates", { kind: "read_candidates", query: "Ada" }],
    [
      "teams.read.person-assignments",
      { kind: "read_person_assignments", personId: PERSON },
    ],
    [
      "teams.read.person-training",
      { kind: "read_person_training", personId: PERSON },
    ],
  ] as const;

  const outcomes: Record<string, Record<string, boolean>> = {};
  for (const [identity, selection] of fixtures) {
    const registration = TEAMS_CAPABILITY_REGISTRY.registrationFor(identity);
    assert.ok(registration?.operationKind === "read");
    const authorization = {
      actor: { userId: PERSON, plantId: PLANT, seat: "member" },
      registration,
    } as Parameters<typeof executeTeamsRead>[0]["authorization"];
    const first = await executeTeamsRead({
      authorization,
      untrustedInput: selection,
    });
    const second = await executeTeamsRead({
      authorization,
      untrustedInput: selection,
    });
    assert.ok(first);
    assert.deepEqual(second, first);
    assert.ok(first.sourceLinks.length > 0);
    assert.equal(
      await executeTeamsRead({
        authorization,
        untrustedInput: { ...selection, unexpected: true },
      }),
      null
    );
    const other = fixtures.find(([candidate]) => candidate !== identity)!;
    const otherRegistration = TEAMS_CAPABILITY_REGISTRY.registrationFor(
      other[0]
    );
    assert.ok(otherRegistration?.operationKind === "read");
    assert.equal(
      await executeTeamsRead({
        authorization: {
          ...authorization,
          registration: otherRegistration,
        } as typeof authorization,
        untrustedInput: selection,
      }),
      null
    );
    if ("teamId" in selection) {
      assert.equal(
        await executeTeamsRead({
          authorization,
          untrustedInput: { ...selection, teamId: FOREIGN },
        }),
        null
      );
    }
    if ("personId" in selection) {
      const foreignPerson = await executeTeamsRead({
        authorization,
        untrustedInput: { ...selection, personId: FOREIGN },
      });
      assert.equal(foreignPerson, null);
    }
    forceReadFailure = true;
    try {
      await assert.rejects(
        executeTeamsRead({ authorization, untrustedInput: selection }),
        /forced Teams read service failure/
      );
    } finally {
      forceReadFailure = false;
    }
    outcomes[identity] = {
      arguments: true,
      tenancy: true,
      confirmation: true,
      execution: true,
      idempotency: true,
      errors: true,
      uiArtifact: true,
    };
  }

  const detailRegistration =
    TEAMS_CAPABILITY_REGISTRY.registrationFor("teams.read.detail");
  assert.ok(detailRegistration?.operationKind === "read");
  const detailAuthorization = {
    actor: { userId: PERSON, plantId: PLANT, seat: "member" },
    registration: detailRegistration,
  } as Parameters<typeof executeTeamsRead>[0]["authorization"];
  const worship = await executeTeamsRead({
    authorization: detailAuthorization,
    untrustedInput: { kind: "read_detail", teamId: TEAM },
  });
  const childrens = await executeTeamsRead({
    authorization: detailAuthorization,
    untrustedInput: { kind: "read_detail", teamId: CHILDRENS_TEAM },
  });
  assert.ok(worship && childrens);
  const factLabels = (result: typeof worship) =>
    result.items.flatMap((item) => item.facts.map(({ label }) => label));
  assert.equal(factLabels(worship).includes("Background check"), false);
  assert.equal(factLabels(childrens).includes("Background check"), true);

  assert.ok(seenPlants.length > 0);
  assert.ok(seenPlants.every((plantId) => plantId === PLANT));
  process.stdout.write(
    `EVRY_TEAMS_READ_OUTCOMES=${JSON.stringify(outcomes)}\n`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
