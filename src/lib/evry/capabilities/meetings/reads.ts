import { z } from "zod";

import { buildEvryReadArtifact } from "@/lib/evry/artifacts/core";
import {
  trustedEvryApplicationSourceLink,
  type EvryReadContinuationArtifact,
} from "@/lib/evry/artifacts/types";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import {
  getMeetingCommunications,
  getMeetingTrackingByPerson,
} from "@/lib/communication/service";
import { getMeetingContextualTemplates } from "@/lib/documents/contextual";
import {
  getAttendanceTrend,
  getMeetingSummaryStats,
} from "@/lib/meetings/analytics";
import { getGuestList } from "@/lib/meetings/guest-list";
import { meetingDisplayTitle } from "@/lib/meetings/labels";
import { listLocations } from "@/lib/meetings/locations";
import {
  getMeetingResponseBreakdown,
  listMeetingResponses,
} from "@/lib/meetings/response-queries";
import {
  getAttendanceSummary,
  getChecklist,
  getChecklistSummary,
  getEvaluation,
  getEvaluationTrend,
  getFollowUpCompletion,
  getMeeting,
  hasMeetingHistory,
  listAttendees,
  listMeetings,
} from "@/lib/meetings/service";
import { getTeam, listTeams } from "@/lib/ministry-teams/service";
import { meetingStatuses, meetingTypes } from "@/db/schema/meetings";

type MeetingsReadAuthorization = Pick<
  EvryReadCapabilityAuthorization,
  "actor" | "registration"
>;

const listInputSchema = z.strictObject({
  status: z.enum(["upcoming", "past", "all"]).default("all"),
  meetingStatus: z.enum(meetingStatuses).optional(),
  type: z.enum(meetingTypes).optional(),
  teamId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
const detailInputSchema = z.strictObject({ meetingId: z.string().uuid() });
const analyticsInputSchema = z.strictObject({
  meetingId: z.string().uuid(),
  type: z.enum(meetingTypes).optional(),
  limit: z.number().int().min(1).max(25).default(12),
});
const locationsInputSchema = z.strictObject({});

type MeetingsReadAdapter = Readonly<{
  identity: string;
  inputSchema: z.ZodType;
  run(
    authorization: MeetingsReadAuthorization,
    input: never
  ): Promise<EvryReadContinuationArtifact>;
}>;

function dateFact(value: Date): string {
  return value.toISOString();
}

const READ_ADAPTERS: readonly MeetingsReadAdapter[] = [
  {
    identity: "meetings.read.list",
    inputSchema: listInputSchema,
    async run({ actor }, input: z.infer<typeof listInputSchema>) {
      const [result, history, team] = await Promise.all([
        listMeetings(actor.plantId, input),
        hasMeetingHistory(actor.plantId),
        input.teamId ? getTeam(actor.plantId, input.teamId) : null,
      ]);
      if (input.teamId && !team) {
        return {
          kind: "clarification",
          mode: "missing",
          entityType: "team",
          prompt: "That team is unavailable.",
        };
      }
      const listLink = trustedEvryApplicationSourceLink({
        label: "Meetings",
        href: input.teamId ? `/teams/${input.teamId}/meetings` : "/meetings",
      });
      const items = result.meetings.map((meeting) => {
        const sourceLink = trustedEvryApplicationSourceLink({
          label: meetingDisplayTitle(meeting),
          href: `/meetings/${meeting.id}`,
        });
        return {
          id: meeting.id,
          label: meetingDisplayTitle(meeting),
          facts: [
            { label: "Date and time", value: dateFact(meeting.datetime) },
            { label: "Status", value: meeting.status },
            {
              label: "Location",
              value: meeting.locationName ?? "No location set",
            },
            { label: "Guests", value: String(meeting.totalAttendees) },
          ],
          sourceLink,
        };
      });
      const excluded = Math.max(0, result.total - items.length);
      return buildEvryReadArtifact({
        title: "Meetings",
        filters: [
          { label: "Time", value: input.status },
          { label: "Type", value: input.type ?? "All meeting types" },
          ...(team ? [{ label: "Team", value: team.name }] : []),
          {
            label: "Plant meeting history",
            value: history ? "Existing meetings" : "No meetings yet",
          },
        ],
        exclusions:
          excluded > 0
            ? [{ reason: "Outside this page", count: excluded }]
            : [],
        items,
        sourceLinks: [listLink, ...items.map(({ sourceLink }) => sourceLink)],
      });
    },
  },
  {
    identity: "meetings.read.detail",
    inputSchema: detailInputSchema,
    async run({ actor }, input: z.infer<typeof detailInputSchema>) {
      const meeting = await getMeeting(actor.plantId, input.meetingId);
      if (!meeting) {
        return {
          kind: "clarification",
          mode: "missing",
          entityType: "meeting",
          prompt: "That meeting is unavailable.",
        };
      }
      const [
        guests,
        attendance,
        checklist,
        checklistSummary,
        evaluation,
        evaluationTrend,
        followUp,
        responseCards,
        responses,
        attendees,
        locations,
        communications,
        tracking,
      ] = await Promise.all([
        getGuestList(actor.plantId, meeting.id),
        getAttendanceSummary(actor.plantId, meeting.id),
        getChecklist(actor.plantId, meeting.id),
        getChecklistSummary(actor.plantId, meeting.id),
        getEvaluation(actor.plantId, meeting.id),
        getEvaluationTrend(actor.plantId),
        getFollowUpCompletion(actor.plantId, meeting.id),
        listMeetingResponses(actor.plantId, meeting.id),
        getMeetingResponseBreakdown(actor.plantId, meeting.id),
        listAttendees(actor.plantId, meeting.id),
        listLocations(actor.plantId),
        getMeetingCommunications(actor.plantId, meeting.id),
        getMeetingTrackingByPerson(actor.plantId, meeting.id),
      ]);
      const templates = getMeetingContextualTemplates(meeting.type);
      const sourceLink = trustedEvryApplicationSourceLink({
        label: meetingDisplayTitle(meeting),
        href: `/meetings/${meeting.id}`,
      });
      return buildEvryReadArtifact({
        title: meetingDisplayTitle(meeting),
        filters: [{ label: "Meeting", value: meeting.id }],
        exclusions: [],
        items: [
          {
            id: meeting.id,
            label: meetingDisplayTitle(meeting),
            facts: [
              { label: "Date and time", value: dateFact(meeting.datetime) },
              { label: "Status", value: meeting.status },
              {
                label: "Location",
                value: meeting.locationName ?? "No location set",
              },
              { label: "Guests", value: String(guests.length) },
              { label: "Attended", value: String(attendance.total) },
              {
                label: "First-time attendees",
                value: String(attendance.firstTime),
              },
              {
                label: "Checklist",
                value: `${checklistSummary.checked} of ${checklistSummary.total}`,
              },
              { label: "Checklist rows", value: String(checklist.length) },
              {
                label: "Evaluation score",
                value: evaluation?.totalScore ?? "Not evaluated",
              },
              {
                label: "Follow-up",
                value: followUp
                  ? `${followUp.completed} of ${followUp.total}`
                  : "Not finalized",
              },
              {
                label: "Response cards",
                value: String(responses.recordedCount),
              },
              {
                label: "Response rows",
                value: String(responseCards.length),
              },
              { label: "Attendee rows", value: String(attendees.length) },
              {
                label: "Evaluation trend points",
                value: String(evaluationTrend.length),
              },
              {
                label: "Available locations",
                value: String(locations.length),
              },
              {
                label: "Meeting communications",
                value: String(communications.length),
              },
              {
                label: "Recipients with tracking",
                value: String(tracking.size),
              },
              {
                label: "Contextual templates",
                value: String(templates?.templates.length ?? 0),
              },
            ],
            sourceLink,
          },
        ],
        sourceLinks: [sourceLink],
      });
    },
  },
  {
    identity: "meetings.read.analytics",
    inputSchema: analyticsInputSchema,
    async run({ actor }, input: z.infer<typeof analyticsInputSchema>) {
      const meeting = await getMeeting(actor.plantId, input.meetingId);
      if (!meeting) {
        return {
          kind: "clarification",
          mode: "missing",
          entityType: "meeting",
          prompt: "That meeting is unavailable.",
        };
      }
      const [trend, stats] = await Promise.all([
        getAttendanceTrend(actor.plantId, input.limit, input.type),
        getMeetingSummaryStats(actor.plantId, input.type),
      ]);
      const sourceLink = trustedEvryApplicationSourceLink({
        label: "Meeting analytics",
        href: `/meetings/${meeting.id}/analytics${input.type ? `?type=${input.type}` : ""}`,
      });
      return buildEvryReadArtifact({
        title: "Meeting analytics",
        filters: [
          { label: "Type", value: input.type ?? "All meeting types" },
          { label: "Window", value: `${input.limit} meetings` },
        ],
        exclusions: [],
        items: [
          {
            id: meeting.id,
            label: meetingDisplayTitle(meeting),
            facts: [
              { label: "Meetings", value: String(stats.totalMeetings) },
              {
                label: "Total attendance",
                value: String(stats.totalAttendees),
              },
              {
                label: "Average attendance",
                value: String(stats.avgAttendance),
              },
              { label: "Trend points", value: String(trend.length) },
            ],
            sourceLink,
          },
        ],
        sourceLinks: [sourceLink],
      });
    },
  },
  {
    identity: "meetings.read.schedule",
    inputSchema: locationsInputSchema,
    async run({ actor }) {
      const [locations, teams] = await Promise.all([
        listLocations(actor.plantId),
        listTeams(actor.plantId),
      ]);
      const newMeetingLink = trustedEvryApplicationSourceLink({
        label: "New meeting",
        href: "/meetings/new",
      });
      const items = [
        ...locations.map((location) => ({
          id: location.id,
          label: location.name,
          facts: [
            { label: "Kind", value: "Location" },
            { label: "Address", value: location.address },
            {
              label: "Capacity",
              value:
                location.capacity === null
                  ? "Not set"
                  : String(location.capacity),
            },
          ],
          sourceLink: newMeetingLink,
        })),
        ...teams.map((team) => ({
          id: team.id,
          label: team.name,
          facts: [
            { label: "Kind", value: "Team" },
            { label: "Filled roles", value: String(team.filledRoles) },
            { label: "Total roles", value: String(team.totalRoles) },
          ],
          sourceLink: newMeetingLink,
        })),
      ];
      return buildEvryReadArtifact({
        title: "Meeting scheduling options",
        filters: [
          { label: "Locations", value: String(locations.length) },
          { label: "Teams", value: String(teams.length) },
        ],
        exclusions: [],
        items,
        sourceLinks: [newMeetingLink],
      });
    },
  },
];

const READ_ADAPTER_BY_ID = new Map(
  READ_ADAPTERS.map((adapter) => [adapter.identity, adapter])
);

export const MEETINGS_READ_ADAPTER_IDENTITIES = Object.freeze(
  READ_ADAPTERS.map(({ identity }) => identity).toSorted()
);

/** Parse untrusted selection input, then run only a fixed plant-scoped adapter. */
export async function executeMeetingsRead(input: {
  authorization: MeetingsReadAuthorization;
  untrustedInput: unknown;
}): Promise<EvryReadContinuationArtifact | null> {
  const registration = input.authorization.registration;
  if (registration.operationKind !== "read") {
    return null;
  }
  const adapter = READ_ADAPTER_BY_ID.get(registration.identity);
  if (!adapter) return null;
  const parsed = adapter.inputSchema.safeParse(input.untrustedInput);
  if (!parsed.success) return null;
  return adapter.run(input.authorization, parsed.data as never);
}
