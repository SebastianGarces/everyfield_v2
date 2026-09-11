import { z } from "zod";
import { personStatuses } from "@/db/schema/people";
import { taskStatuses } from "@/db/schema/tasks";
import type { EvryReadContinuationArtifact } from "@/lib/evry/artifacts/types";
import { evryDateRangeSchema } from "@/lib/evry/reads/date-range";
import { EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH } from "@/lib/evry/capabilities/people/attachment-contract";

type Query = (
  id: string,
  input: unknown
) => Promise<EvryReadContinuationArtifact>;
export type EvryReadWorkflow = Readonly<{
  id: string;
  description: string;
  readIds: readonly string[];
  inputSchema: z.ZodType;
  run(query: Query, input: unknown): Promise<void>;
}>;

function workflow<S extends z.ZodType>(entry: {
  id: string;
  description: string;
  readIds: readonly string[];
  inputSchema: S;
  run(query: Query, input: z.output<S>): Promise<void>;
}): EvryReadWorkflow {
  return {
    ...entry,
    run: (query, input) => entry.run(query, entry.inputSchema.parse(input)),
  };
}

const ids = z.array(z.string().uuid()).min(1).max(10);
const limit = z.number().int().min(1).max(25).default(10);
const pending = taskStatuses.filter((status) => status !== "complete");
const list = (limit: number) => ({ mode: "list", limit });
const today = { kind: "relative", period: "today" } as const;

/** Read workflows can call only the injected, freshly authorized query function. */
export const EVRY_READ_WORKFLOWS: readonly EvryReadWorkflow[] = [
  workflow({
    id: "daily-work",
    description:
      "My pending tasks and meetings for a church-local date window; overdue work is a separate, opt-in group.",
    readIds: ["tasks.query", "meetings.query"],
    inputSchema: z.strictObject({
      due: evryDateRangeSchema.default(today),
      includeOverdue: z.boolean().default(false),
      limit,
    }),
    async run(query, input) {
      await query("tasks.query", {
        where: {
          all: [
            { assignment: { kind: "mine" }, status: pending, due: input.due },
          ],
        },
        query: list(input.limit),
      });
      await query("meetings.query", {
        where: { all: [{ date: input.due }] },
        query: list(input.limit),
      });
      if (input.includeOverdue)
        await query("tasks.query", {
          where: {
            all: [
              {
                assignment: { kind: "mine" },
                status: pending,
                due: { kind: "relative", period: "overdue" },
              },
            ],
          },
          query: list(input.limit),
        });
    },
  }),
  workflow({
    id: "interview-review",
    description:
      "Two separate cohorts without a recorded interview: completed person-linked follow-up recorded, and no such follow-up recorded. Optional attendance criteria. These are recorded evidence, not proof of personal contact or spiritual suitability.",
    readIds: ["people.query", "people.history.query"],
    inputSchema: z.strictObject({
      stages: z.array(z.enum(personStatuses)).min(1).default(["prospect"]),
      minimumMeetings: z.number().int().min(0).max(10000).optional(),
      limit,
    }),
    async run(query, input) {
      const criteria = {
        stages: input.stages,
        interview: "not_recorded",
        ...(input.minimumMeetings === undefined
          ? {}
          : { attendance: { minimumMeetings: input.minimumMeetings } }),
      };
      for (const followUp of ["recorded", "not_recorded"])
        await query("people.query", {
          cohort: { all: { ...criteria, followUp } },
          result: list(input.limit),
        });
      await query("people.history.query", {
        resource: { kind: "follow_up", state: "completed" },
        cohort: { all: criteria },
        latestPerPerson: true,
        result: list(input.limit),
      });
    },
  }),
  workflow({
    id: "meeting-followup",
    description:
      "Review actual attendees, people without completed follow-up, and existing open/completed follow-up tasks. Person-linked follow-up cannot always be attributed to this meeting. Read-only; a task or message needs separate preparation and confirmation.",
    readIds: ["attendance.query", "people.query", "people.history.query"],
    inputSchema: z.strictObject({ meetingIds: ids, limit }),
    async run(query, input) {
      const cohort = {
        all: {
          attendance: { meetingIds: input.meetingIds, minimumMeetings: 1 },
        },
      };
      await query("attendance.query", {
        meetingIds: input.meetingIds,
        statuses: ["attended"],
        result: list(input.limit),
      });
      await query("people.query", {
        cohort: { all: { ...cohort.all, followUp: "not_recorded" } },
        result: list(input.limit),
      });
      await query("people.history.query", {
        cohort,
        resource: { kind: "follow_up", state: "any" },
        result: list(input.limit),
      });
    },
  }),
  workflow({
    id: "staffing-review",
    description:
      "Open ministry role slots, current unmet training requirements, and unassigned people. Recommendations are operational suggestions, never appointments or spiritual judgments.",
    readIds: ["teams.query", "training.query", "people.query"],
    inputSchema: z.strictObject({
      teamIds: ids.optional(),
      skill: z.string().trim().min(1).max(100).optional(),
      limit,
    }),
    async run(query, input) {
      const scope = input.teamIds ? { teamIds: input.teamIds } : {};
      await query("teams.query", {
        request: {
          resource: "roles",
          where: { all: [{ ...scope, vacant: true }] },
          query: list(input.limit),
        },
      });
      await query("training.query", {
        request: {
          resource: "requirements",
          where: { all: [{ ...scope, completed: false }] },
          query: list(input.limit),
        },
      });
      await query("people.query", {
        cohort: {
          all: {
            membership: { existence: "not_recorded" },
            ...(input.skill ? { skill: { search: input.skill } } : {}),
          },
        },
        result: list(input.limit),
      });
    },
  }),
  workflow({
    id: "launch-review",
    description:
      "Current launch date, incomplete milestones, blocked launch tasks, staffing gaps and upcoming meetings. No historical or spiritual readiness verdict.",
    readIds: ["launch.query", "tasks.query", "teams.query", "meetings.query"],
    inputSchema: z.strictObject({
      meetingsWindow: evryDateRangeSchema.default({
        kind: "relative",
        period: "this_week",
      }),
      limit,
    }),
    async run(query, input) {
      await query("launch.query", {
        query: { resource: "status", mode: "list", limit: 1 },
      });
      await query("launch.query", {
        query: {
          resource: "milestones",
          mode: "list",
          completion: "open",
          limit: input.limit,
        },
      });
      await query("tasks.query", {
        where: {
          all: [
            {
              launchMilestone: true,
              incompletePrerequisites: true,
              status: pending,
            },
          ],
        },
        query: list(input.limit),
      });
      await query("teams.query", {
        request: {
          resource: "roles",
          where: { all: [{ vacant: true }] },
          query: list(input.limit),
        },
      });
      await query("meetings.query", {
        where: { all: [{ date: input.meetingsWindow }] },
        query: list(input.limit),
      });
    },
  }),
  workflow({
    id: "delivery-recovery",
    description:
      "Review failed/bounced delivery separately from non-openers, with original message content and current resend eligibility. Failed-delivery retry is NOT the application's non-opener resend. Never substitute one or claim a retry was sent.",
    readIds: ["communication.query", "communication.get_many"],
    inputSchema: z.strictObject({
      messageIds: ids.optional(),
      meetingIds: ids.optional(),
      limit,
    }),
    async run(query, input) {
      const scope = {
        ...(input.messageIds ? { messageIds: input.messageIds } : {}),
        ...(input.meetingIds ? { meetingIds: input.meetingIds } : {}),
        deliveryStatuses: ["failed", "bounced"],
      };
      await query("communication.query", {
        query: {
          resource: "recipients",
          ...scope,
          mode: "list",
          limit: input.limit,
        },
      });
      const messages = await query("communication.query", {
        query: {
          resource: "messages",
          ...scope,
          mode: "list",
          limit: input.limit,
        },
      });
      if (messages.kind === "read" && messages.items.length)
        await query("communication.get_many", {
          resource: "messages",
          ids: messages.items.map((item) => item.id),
        });
    },
  }),
  workflow({
    id: "import-review",
    description:
      "Inspect the uploaded People file and existing duplicate candidates without importing. Uses the exact attachment reference and digest; import needs a separate exact confirmation.",
    readIds: ["files.inspect"],
    inputSchema: z.strictObject({
      attachmentReference: z
        .string()
        .min(1)
        .max(EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH),
      attachmentDigest: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    async run(query, input) {
      await query("files.inspect", input);
    },
  }),
];
