import { z } from "zod";
import { db } from "@/db";
import {
  APP_TIME_ZONE,
  formatDateWithoutWeekday,
  formatDateTimeWithZone,
} from "@/lib/datetime";
import { STATUS_LABELS } from "@/lib/people/status.shared";
import { backgroundCheckBadge } from "@/lib/people/background-check";
import { responseCardLabel } from "@/lib/meetings/response-card";
import { readEvryPlantTimeZone } from "@/lib/evry/reads/plant-time-zone";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import type {
  EvryReadArtifact,
  EvryReadItem,
} from "@/lib/evry/artifacts/types";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import {
  peopleQuerySchema,
  peopleGetManySchema,
  peopleHistoryQuerySchema,
  attendanceQuerySchema,
  buildPeopleQuery,
  buildPeopleGetManyQuery,
  buildPeopleHistoryQuery,
  buildAttendanceQuery,
} from "./people-query-sql";

const factValues = {
  stage: "Stage",
  source: "Source",
  email: "Email",
  phone: "Phone",
  household: "Household",
  background_check: "Background check",
  notes: "Notes",
  address: "Address",
  members: "Household members",
  author: "Recorded by",
  date: "Date",
  outcome: "Recorded outcome",
  content: "Recorded notes",
  meeting: "Meeting",
  status: "Attendance",
  attendance_type: "Attendance type",
  rsvp: "RSVP",
  response_card: "Response card",
  response_notes: "Response card notes",
  person_follow_up_recorded: "Completed follow-up task recorded for person",
} as const;
const rowSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  person_id: z.string().uuid().optional(),
  household_id: z.string().uuid().nullable().optional(),
  meeting_id: z.string().uuid().optional(),
  stage: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  household: z.string().nullable().optional(),
  background_check: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  members: z.number().int().nonnegative().optional(),
  author_id: z.string().uuid().nullable().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  outcome: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  meeting: z.string().optional(),
  status: z.string().optional(),
  attendance_type: z.string().nullable().optional(),
  rsvp: z.string().nullable().optional(),
  response_card: z.string().nullable().optional(),
  response_notes: z.string().nullable().optional(),
  person_follow_up_recorded: z.boolean().optional(),
});
const queryResultSchema = z.object({
  total: z.number().int().nonnegative(),
  people: z.number().int().nonnegative(),
  households: z.number().int().nonnegative(),
  without_household: z.number().int().nonnegative(),
  rows: z.array(rowSchema).max(50),
  groups: z
    .array(
      z.object({
        label: z.string(),
        count: z.number().int().nonnegative(),
        people: z.number().int().nonnegative(),
        households: z.number().int().nonnegative(),
      })
    )
    .max(50),
  group_total: z.number().int().nonnegative(),
  group_offset: z.number().int().nonnegative().optional(),
  has_more: z.boolean(),
});
type QueryResult = z.infer<typeof queryResultSchema>;
const listLink = () =>
  trustedEvryApplicationSourceLink({ label: "Open People", href: "/people" });

// Labels without a shared domain export follow the existing People and Meetings forms.
const recordedLabels: Readonly<Record<string, string>> = {
  ...STATUS_LABELS,
  personal_referral: "Personal Referral",
  social_media: "Social Media",
  vision_meeting: "Vision Meeting",
  website: "Website",
  event: "Event",
  partner_church: "Partner Church",
  other: "Other",
  qualified: "Qualified",
  qualified_with_notes: "Qualified with Notes",
  not_qualified: "Not Qualified",
  follow_up: "Follow-up Needed",
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  blocked: "Blocked",
  attended: "Attended",
  absent: "Absent",
  excused: "Excused",
  first_time: "First-time guest",
  returning: "Returning guest",
  confirmed: "Confirmed",
  declined: "Declined",
  interested: "Interested",
  ready_commit: "Ready to commit",
  questions: "Has questions",
  not_interested: "Not interested",
  note_added: "Note added",
  person_created: "Person created",
  person_updated: "Profile updated",
  status_changed: "Stage changed",
  interview_completed: "Interview completed",
  assessment_completed: "Assessment completed",
  commitment_recorded: "Commitment recorded",
  tag_added: "Tag added",
  tag_removed: "Tag removed",
  skill_added: "Skill added",
  skill_updated: "Skill updated",
  skill_removed: "Skill removed",
  household_created: "Household created",
  household_joined: "Joined household",
  household_left: "Left household",
  household_role_changed: "Household role changed",
};
function recordedLabel(value: string): string {
  return Object.hasOwn(recordedLabels, value) ? recordedLabels[value]! : value;
}
function calendarDateLabel(value: string): string {
  // SQL has already resolved history instants to the church calendar day.
  // Attendance dates are stored meeting wall clocks. Neither is an instant to shift again.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDateWithoutWeekday(
        new Date(`${value}T00:00:00.000Z`),
        "short",
        APP_TIME_ZONE
      )
    : value;
}
function displayFact(key: string, value: string): string {
  if (key === "date") return calendarDateLabel(value);
  if (key === "background_check") return backgroundCheckBadge(value).label;
  if (key === "response_card") return responseCardLabel(value);
  return [
    "stage",
    "source",
    "outcome",
    "status",
    "attendance_type",
    "rsvp",
  ].includes(key)
    ? recordedLabel(value)
    : value;
}
function displayGroup(label: string, criteria: unknown): string {
  const parsed = z
    .object({ result: z.object({ by: z.string() }) })
    .safeParse(criteria);
  const by = parsed.success ? parsed.data.result.by : undefined;
  if (by === "date") return calendarDateLabel(label);
  if (by && ["person", "author", "household", "meeting"].includes(by))
    return label.replace(/ \[(?:[0-9a-f-]{36}|unknown)\]$/i, "");
  return by &&
    [
      "stage",
      "source",
      "outcome",
      "status",
      "rsvp",
      "attendance_type",
    ].includes(by)
    ? recordedLabel(label)
    : label;
}

function boundedText(value: string, maximum = 500): string {
  return value.length > maximum
    ? `${value.slice(0, maximum - 12)}… [excerpt]`
    : value;
}
function readableCriteria(value: unknown): string {
  if (value === null || value === undefined) return "Any";
  if (typeof value === "string") return value.replaceAll("_", " ");
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    if (
      value.length &&
      value.every(
        (item) =>
          typeof item === "string" && z.string().uuid().safeParse(item).success
      )
    )
      return `${value.length} selected record${value.length === 1 ? "" : "s"}`;
    return value.map(readableCriteria).join("; ");
  }
  if (typeof value === "object")
    return (
      Object.entries(value)
        .filter(([key]) => key !== "result")
        .map(
          ([key, entry]) =>
            `${key === "all" ? "All of (AND)" : key === "anyOf" ? "Any of (OR)" : key.replace(/([a-z])([A-Z])/g, "$1 $2")}: ${readableCriteria(entry)}`
        )
        .join("; ") || "All records"
    );
  return "Applied filters";
}

function rowItem(
  row: z.infer<typeof rowSchema>,
  resource: "people" | "attendance" | "households"
): EvryReadItem {
  const sourceLink =
    resource === "households"
      ? listLink()
      : resource === "attendance" && row.meeting_id
        ? trustedEvryApplicationSourceLink({
            label: "Open meeting",
            href: `/meetings/${row.meeting_id}`,
          })
        : trustedEvryApplicationSourceLink({
            label: `Open ${boundedText(row.label, 150)}`,
            href: `/people/${row.person_id ?? row.id}`,
          });
  return {
    id: row.id,
    label: boundedText(row.label, 160),
    sourceLink,
    facts: [
      ...Object.entries(factValues).flatMap(([key, label]) => {
        const value = row[key as keyof typeof factValues];
        return value === null || value === undefined
          ? []
          : [
              {
                label,
                value:
                  typeof value === "boolean"
                    ? value
                      ? "Yes"
                      : "No recorded completion"
                    : boundedText(displayFact(key, String(value))),
              },
            ];
      }),
      ...(["person_id", "author_id", "meeting_id"] as const).flatMap((key) =>
        row[key]
          ? [{ label: key, value: row[key], modelOnly: true as const }]
          : []
      ),
    ],
  };
}

/** Pagination metadata stays machine-readable in existing artifact filters. */
export function peopleQueryArtifact(
  title: string,
  data: QueryResult,
  mode: "list" | "count" | "group",
  resource: "people" | "attendance",
  criteria: unknown,
  now: Date,
  timeZone: string = APP_TIME_ZONE
): EvryReadArtifact {
  const sourceLink =
    resource === "attendance"
      ? trustedEvryApplicationSourceLink({
          label: "Open Meetings",
          href: "/meetings",
        })
      : listLink();
  const items: EvryReadItem[] =
    mode === "list"
      ? data.rows.map((row) => rowItem(row, resource))
      : mode === "group"
        ? data.groups.map((group, index) => ({
            id: `group-${index}`,
            label: boundedText(displayGroup(group.label, criteria), 160),
            sourceLink,
            facts: [
              { label: "Records", value: String(group.count) },
              { label: "Distinct people", value: String(group.people) },
              { label: "Distinct households", value: String(group.households) },
              {
                label: "Group key",
                value: boundedText(group.label),
                modelOnly: true,
              },
            ],
          }))
        : [
            {
              id: "total",
              label: title,
              sourceLink,
              facts: [
                { label: "Records", value: String(data.total) },
                { label: "Distinct people", value: String(data.people) },
                {
                  label: "Distinct households",
                  value: String(data.households),
                },
              ],
            },
          ];
  const matched = data.total;
  const artifact = buildEvryReadArtifact({
    title,
    items,
    sourceLinks: [sourceLink],
    filters: [
      { label: "Matching records", value: String(data.total) },
      ...(mode === "group"
        ? [{ label: "Matching groups", value: String(data.group_total) }]
        : []),
      { label: "Distinct people", value: String(data.people) },
      { label: "Distinct households", value: String(data.households) },
      {
        label: "Records without a household",
        value: String(data.without_household),
      },
      { label: "Criteria", value: boundedText(readableCriteria(criteria)) },
      { label: "Read at", value: formatDateTimeWithZone(now, timeZone) },
      { label: "Time zone", value: timeZone },
      {
        label: "Next page cursor",
        value: data.has_more
          ? mode === "group"
            ? String((data.group_offset ?? 0) + data.groups.length)
            : (data.rows.at(-1)?.id ?? "End of results")
          : "End of results",
      },
      {
        label: "Completeness",
        value:
          mode === "group" && data.group_total > data.groups.length
            ? `Showing ${data.groups.length} of ${data.group_total} groups, starting at offset ${data.group_offset ?? 0}. Counts use all matching records. Use result.offset with the next cursor for additional groups; concurrent edits can change group order.`
            : mode === "list"
              ? "Exact filtered total; displayed records are one page ordered by ID."
              : "Computed over all matching records, not a page.",
      },
      {
        label: "Evidence limits",
        value:
          "No record means no matching evidence in EveryField, not proof an event never happened. Follow-up evidence is a completed person-linked task, not a meeting attribution.",
      },
    ],
    exclusions: [],
  });
  return Object.freeze({
    ...artifact,
    resultMode: mode,
    counts: Object.freeze({ matched, returned: items.length, excluded: 0 }),
  });
}

export const PEOPLE_QUERY_READS = [
  defineEvryReadRegistration({
    id: "people.query",
    capabilityIdentity: "people.crm.people.list-people",
    inputShape: peopleQuerySchema.shape,
    async run({ authorization, now }, input) {
      const result = await db.execute(
        buildPeopleQuery(authorization.actor.plantId, input)
      );
      return peopleQueryArtifact(
        "People",
        queryResultSchema.parse(result.rows[0]),
        input.result.mode,
        "people",
        input,
        now ?? new Date(),
        await readEvryPlantTimeZone(authorization.actor.plantId)
      );
    },
  }),
  defineEvryReadRegistration({
    id: "people.get_many",
    capabilityIdentity: "people.crm.people.get-person",
    inputShape: peopleGetManySchema.shape,
    async run({ authorization }, input) {
      const result = await db.execute(
        buildPeopleGetManyQuery(authorization.actor.plantId, input)
      );
      const rows = z.array(rowSchema).max(50).parse(result.rows);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const requested = [...new Set(input.ids)];
      return buildEvryReadArtifact({
        title: input.resource === "person" ? "People" : "Households",
        sourceLinks: [listLink()],
        exclusions: [],
        filters: [
          {
            label: "Scope",
            value:
              "Current plant; unavailable IDs do not disclose whether a record exists elsewhere.",
          },
        ],
        items: requested.map((id) => {
          const row = byId.get(id);
          return row
            ? rowItem(
                row,
                input.resource === "person" ? "people" : "households"
              )
            : {
                id,
                label: "Record unavailable",
                facts: [{ label: "Availability", value: "Unavailable" }],
                sourceLink: listLink(),
              };
        }),
      });
    },
  }),
  defineEvryReadRegistration({
    id: "people.history.query",
    capabilityIdentity: "people.crm.notes.get-activities",
    inputShape: peopleHistoryQuerySchema.shape,
    async run({ authorization, now }, input) {
      const result = await db.execute(
        buildPeopleHistoryQuery(authorization.actor.plantId, input)
      );
      return peopleQueryArtifact(
        "Recorded people history",
        queryResultSchema.parse(result.rows[0]),
        input.result.mode,
        "people",
        input,
        now ?? new Date(),
        await readEvryPlantTimeZone(authorization.actor.plantId)
      );
    },
  }),
  defineEvryReadRegistration({
    id: "attendance.query",
    capabilityIdentity: "meetings.read.detail",
    inputShape: attendanceQuerySchema.shape,
    async run({ authorization, now }, input) {
      const result = await db.execute(
        buildAttendanceQuery(authorization.actor.plantId, input)
      );
      return peopleQueryArtifact(
        "Attendance and responses",
        queryResultSchema.parse(result.rows[0]),
        input.result.mode,
        "attendance",
        input,
        now ?? new Date(),
        await readEvryPlantTimeZone(authorization.actor.plantId)
      );
    },
  }),
] as const;
