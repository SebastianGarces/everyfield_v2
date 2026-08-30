import { z } from "zod";

import { listMeetings } from "@/lib/meetings/service";
import {
  getAllTeamsHealth,
  getStaffingSummary,
  getTeam,
  getTeamCountsForPeople,
  getTrainingMatrix,
  listStoredResponsibilities,
  listTeams,
  listTrainingPrograms,
} from "@/lib/ministry-teams/service";
import { teamRequiresBackgroundCheck } from "@/lib/ministry-teams/role-templates";
import { listPeople } from "@/lib/people/service";
import {
  trustedEvryApplicationSourceLink,
  type EvryReadArtifact,
} from "@/lib/evry/artifacts/types";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";

const inputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("read_list"),
    status: z.enum(["forming", "active", "paused"]).nullable(),
  }),
  z.strictObject({ kind: z.literal("read_detail"), teamId: z.string().uuid() }),
  z.strictObject({ kind: z.literal("read_health") }),
  z.strictObject({
    kind: z.literal("read_training"),
    teamId: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("read_meetings"),
    teamId: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("read_responsibilities"),
    teamId: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("read_candidates"),
    query: z.string().trim().min(1).max(255),
  }),
]);

type Input = z.infer<typeof inputSchema>;

const IDENTITY_BY_KIND = {
  read_list: "teams.read.list",
  read_detail: "teams.read.detail",
  read_health: "teams.read.health",
  read_training: "teams.read.training",
  read_meetings: "teams.read.meetings",
  read_responsibilities: "teams.read.responsibilities",
  read_candidates: "teams.read.candidates",
} as const;

function exactAuthorization(
  authorization: EvryReadCapabilityAuthorization,
  input: Input
) {
  return authorization.registration.identity === IDENTITY_BY_KIND[input.kind];
}

function artifact(input: Omit<EvryReadArtifact, "kind">): EvryReadArtifact {
  return Object.freeze({ kind: "read", ...input });
}

/** Immediate tenant-scoped Teams reads. No read calls the responsibility seeder. */
export async function executeTeamsRead(input: {
  authorization: EvryReadCapabilityAuthorization;
  untrustedInput: unknown;
}): Promise<EvryReadArtifact | null> {
  const parsed = inputSchema.safeParse(input.untrustedInput);
  if (!parsed.success || !exactAuthorization(input.authorization, parsed.data))
    return null;
  const plantId = input.authorization.actor.plantId;
  const request = parsed.data;
  if (request.kind === "read_list") {
    const [teams, staffing] = await Promise.all([
      listTeams(plantId),
      getStaffingSummary(plantId),
    ]);
    const filtered = request.status
      ? teams.filter(({ status }) => status === request.status)
      : teams;
    const summary = {
      id: plantId,
      label: "Overall staffing",
      facts: [
        { label: "Teams", value: String(staffing.totalTeams) },
        { label: "Roles filled", value: String(staffing.filledRoles) },
        { label: "Total roles", value: String(staffing.totalRoles) },
        { label: "Staffing", value: `${staffing.staffingPercentage}%` },
      ],
      sourceLink: trustedEvryApplicationSourceLink({
        label: "Open ministry teams",
        href: "/teams",
      }),
    };
    return artifact({
      title: "Ministry teams",
      filters: request.status
        ? [{ label: "Status", value: request.status }]
        : [],
      counts: {
        matched: filtered.length + 1,
        returned: filtered.length + 1,
        excluded: teams.length - filtered.length,
      },
      exclusions:
        request.status && teams.length > filtered.length
          ? [
              {
                reason: "Different status",
                count: teams.length - filtered.length,
              },
            ]
          : [],
      items: [
        summary,
        ...filtered.map((team) => ({
          id: team.id,
          label: team.name,
          facts: [
            { label: "Status", value: team.status },
            { label: "Type", value: team.type },
            { label: "Description", value: team.description ?? "None" },
            { label: "Template", value: team.templateKey ?? "Custom" },
            { label: "Icon", value: team.icon ?? "Default" },
            {
              label: "Roles",
              value: `${team.filledRoles} of ${team.totalRoles} filled`,
            },
            { label: "Leader", value: team.leaderName ?? "Not assigned" },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open team",
            href: `/teams/${team.id}`,
          }),
        })),
      ],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open ministry teams",
          href: "/teams",
        }),
      ],
      ...(staffing.totalTeams >= 0 ? {} : {}),
    });
  }
  if (request.kind === "read_detail") {
    const team = await getTeam(plantId, request.teamId);
    if (!team) return null;
    return artifact({
      title: team.name,
      filters: [{ label: "Team", value: team.name }],
      counts: {
        matched: team.roles.length + 1,
        returned: team.roles.length + 1,
        excluded: 0,
      },
      exclusions: [],
      items: [
        {
          id: team.id,
          label: "Team summary",
          facts: [
            { label: "Status", value: team.status },
            { label: "Type", value: team.type },
            { label: "Description", value: team.description ?? "None" },
            { label: "Icon", value: team.icon ?? "Default" },
            { label: "Leader", value: team.leaderName ?? "Not assigned" },
            {
              label: "Staffing",
              value: `${team.filledRoles} of ${team.totalRoles} roles filled`,
            },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open team",
            href: `/teams/${team.id}`,
          }),
        },
        ...team.roles.map((role) => ({
          id: role.id,
          label: role.name,
          facts: [
            { label: "Status", value: role.status },
            {
              label: "Leadership",
              value: role.isLeadershipRole ? "Yes" : "No",
            },
            {
              label: "Assigned person",
              value: role.assignedPerson
                ? `${role.assignedPerson.firstName} ${role.assignedPerson.lastName}`
                : "Open",
            },
            { label: "Description", value: role.description ?? "None" },
            {
              label: "Time commitment",
              value: role.timeCommitment ?? "Not set",
            },
            { label: "Desired skills", value: role.desiredSkills ?? "None" },
            {
              label: "Assigned email",
              value: role.assignedPerson?.email ?? "None",
            },
            {
              label: "Assigned phone",
              value: role.assignedPerson?.phone ?? "None",
            },
            ...(teamRequiresBackgroundCheck(team.templateKey)
              ? [
                  {
                    label: "Background check",
                    value:
                      role.assignedPerson?.backgroundCheckStatus ??
                      "Not applicable",
                  },
                ]
              : []),
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open team",
            href: `/teams/${team.id}`,
          }),
        })),
      ],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open team",
          href: `/teams/${team.id}`,
        }),
      ],
    });
  }
  if (request.kind === "read_candidates") {
    const { people, total } = await listPeople(plantId, {
      search: request.query,
      limit: 50,
    });
    const counts = await getTeamCountsForPeople(
      plantId,
      people.map(({ id }) => id)
    );
    return artifact({
      title: "Team candidates",
      filters: [{ label: "Search", value: request.query }],
      counts: {
        matched: total,
        returned: people.length,
        excluded: Math.max(0, total - people.length),
      },
      exclusions:
        total > people.length
          ? [
              {
                reason: "More matches available; narrow the search",
                count: total - people.length,
              },
            ]
          : [],
      items: people.map((person) => ({
        id: person.id,
        label: `${person.firstName} ${person.lastName}`,
        facts: [
          { label: "Stage", value: person.status },
          { label: "Email", value: person.email ?? "None" },
          { label: "Phone", value: person.phone ?? "None" },
          { label: "Active teams", value: String(counts[person.id] ?? 0) },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open person",
          href: `/people/${person.id}`,
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open people",
          href: "/people",
        }),
      ],
    });
  }
  if (request.kind === "read_health") {
    const [rows, staffing] = await Promise.all([
      getAllTeamsHealth(plantId),
      getStaffingSummary(plantId),
    ]);
    const averageEngagement =
      rows.length > 0
        ? Math.round(
            rows.reduce((total, row) => total + row.engagementScore, 0) /
              rows.length
          )
        : 0;
    const alerts = rows.filter(
      ({ alertLevel }) => alertLevel !== "green"
    ).length;
    return artifact({
      title: "Team health",
      filters: [],
      counts: {
        matched: rows.length + 1,
        returned: rows.length + 1,
        excluded: 0,
      },
      exclusions: [],
      items: [
        {
          id: plantId,
          label: "Health summary",
          facts: [
            { label: "Teams", value: String(staffing.totalTeams) },
            { label: "Staffing", value: `${staffing.staffingPercentage}%` },
            {
              label: "Roles",
              value: `${staffing.filledRoles} of ${staffing.totalRoles} filled`,
            },
            { label: "Average engagement", value: `${averageEngagement}%` },
            { label: "Alerts", value: String(alerts) },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open team health",
            href: "/teams/health",
          }),
        },
        ...rows.map((row) => ({
          id: row.teamId,
          label: row.teamName,
          facts: [
            { label: "Health", value: row.alertLevel },
            { label: "Staffing", value: `${row.staffingPercent}%` },
            { label: "Training", value: `${row.trainingPercent}%` },
            { label: "Attendance", value: `${row.meetingAttendancePercent}%` },
            { label: "Engagement", value: `${row.engagementScore}%` },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open team",
            href: `/teams/${row.teamId}`,
          }),
        })),
      ],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open team health",
          href: "/teams/health",
        }),
      ],
    });
  }
  const team = await getTeam(plantId, request.teamId);
  if (!team) return null;
  if (request.kind === "read_training") {
    const [programs, matrix] = await Promise.all([
      listTrainingPrograms(plantId, request.teamId),
      getTrainingMatrix(plantId, request.teamId),
    ]);
    const programItems = programs.map((program) => ({
      id: program.id,
      label: program.name,
      facts: [
        { label: "Kind", value: "Training program" },
        { label: "Required", value: program.isRequired ? "Yes" : "No" },
        { label: "Description", value: program.description ?? "None" },
      ],
      sourceLink: trustedEvryApplicationSourceLink({
        label: "Open training",
        href: `/teams/${team.id}/training`,
      }),
    }));
    const personItems = matrix.rows.map((row) => ({
      id: row.personId,
      label: row.personName,
      facts: programs.map((program) => ({
        label: program.name,
        value: row.completions[program.id] ? "Complete" : "Incomplete",
      })),
      sourceLink: trustedEvryApplicationSourceLink({
        label: "Open person",
        href: `/people/${row.personId}`,
      }),
    }));
    return artifact({
      title: `${team.name} training`,
      filters: [{ label: "Team", value: team.name }],
      counts: {
        matched: programItems.length + personItems.length,
        returned: programItems.length + personItems.length,
        excluded: 0,
      },
      exclusions: [],
      items: [...programItems, ...personItems],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open training",
          href: `/teams/${team.id}/training`,
        }),
      ],
    });
  }
  if (request.kind === "read_responsibilities") {
    const rows = await listStoredResponsibilities(plantId, team.id);
    return artifact({
      title: `${team.name} responsibilities`,
      filters: [{ label: "Team", value: team.name }],
      counts: { matched: rows.length, returned: rows.length, excluded: 0 },
      exclusions: [],
      items: rows.map((row) => ({
        id: row.id,
        label: row.title,
        facts: [
          { label: "Completed", value: row.completedAt ? "Yes" : "No" },
          {
            label: "Completed at",
            value: row.completedAt?.toISOString() ?? "Not completed",
          },
          { label: "Order", value: String(row.sortOrder) },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Open responsibilities",
          href: `/teams/${team.id}/responsibilities`,
        }),
      })),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open responsibilities",
          href: `/teams/${team.id}/responsibilities`,
        }),
      ],
    });
  }
  const { meetings, total } = await listMeetings(plantId, { teamId: team.id });
  return artifact({
    title: `${team.name} meetings`,
    filters: [{ label: "Team", value: team.name }],
    counts: {
      matched: total,
      returned: meetings.length,
      excluded: Math.max(0, total - meetings.length),
    },
    exclusions:
      total > meetings.length
        ? [
            {
              reason: "More meetings are available",
              count: total - meetings.length,
            },
          ]
        : [],
    items: meetings.map((meeting) => ({
      id: meeting.id,
      label: meeting.title ?? "Team meeting",
      facts: [
        { label: "Starts", value: meeting.datetime.toISOString() },
        { label: "Status", value: meeting.status },
        { label: "Subtype", value: meeting.meetingSubtype ?? "regular" },
        {
          label: "Duration",
          value: meeting.durationMinutes
            ? `${meeting.durationMinutes} minutes`
            : "Not set",
        },
        { label: "Location", value: meeting.locationName ?? "Not set" },
        { label: "Notes", value: meeting.notes ?? "None" },
        { label: "Attendance", value: String(meeting.totalAttendees) },
      ],
      sourceLink: trustedEvryApplicationSourceLink({
        label: "Open meeting",
        href: `/meetings/${meeting.id}`,
      }),
    })),
    sourceLinks: [
      trustedEvryApplicationSourceLink({
        label: "Open team meetings",
        href: `/teams/${team.id}/meetings`,
      }),
    ],
  });
}
