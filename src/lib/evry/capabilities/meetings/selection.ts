import { z } from "zod";

import {
  attendanceStatuses,
  attendanceTypes,
  meetingStatuses,
  meetingSubtypes,
  meetingTypes,
  responseCardTypes,
  responseStatuses,
} from "@/db/schema/meetings";

import type { MeetingsActionExport } from "./catalog";

const uuid = z.string().uuid();
const instant = z.string().datetime();
const zone = z
  .string()
  .trim()
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });

export type MeetingsEvryReadSelection =
  | Readonly<{ kind: "read_list" }>
  | Readonly<{ kind: "read_detail" }>
  | Readonly<{ kind: "read_analytics" }>
  | Readonly<{ kind: "read_locations" }>;

export type MeetingsEvryEffectSelection = Readonly<{
  kind: "effect";
  exportName: MeetingsActionExport;
  values: Readonly<Record<string, unknown>>;
}>;

export type MeetingsEvryRequestSelection =
  | MeetingsEvryReadSelection
  | MeetingsEvryEffectSelection;

function effect(
  exportName: MeetingsActionExport,
  values: Readonly<Record<string, unknown>> = {}
): MeetingsEvryEffectSelection {
  return { kind: "effect", exportName, values };
}

function exactEnum<T extends readonly string[]>(
  value: string,
  values: T
): T[number] | null {
  return values.includes(value as T[number]) ? (value as T[number]) : null;
}

function personFields(value: string) {
  const [firstName, lastName, email = "", phone = ""] = value
    .split("|")
    .map((part) => part.trim());
  if (!firstName || !lastName) return null;
  return {
    firstName,
    lastName,
    email: email || null,
    phone: phone || null,
  };
}

function attendanceBatch(value: string) {
  const records = value.split(",").map((part) => {
    const [personId, rawStatus] = part.split("=").map((item) => item.trim());
    const status = exactEnum(rawStatus ?? "", attendanceStatuses);
    return personId && uuid.safeParse(personId).success && status
      ? { personId, status }
      : null;
  });
  return records.length > 0 && records.every(Boolean) ? records : null;
}

function agendaSections(value: string) {
  const sections = value.split(";").map((part, index) => {
    const [title, rawMinutes] = part.split("=").map((item) => item.trim());
    const minutes = Number(rawMinutes);
    return title && Number.isInteger(minutes) && minutes >= 0
      ? { id: `evry-section-${index + 1}`, title, minutes }
      : null;
  });
  return sections.length > 0 && sections.every(Boolean) ? sections : null;
}

const CREATE_MEETING_FIELDS = new Set([
  "type",
  "datetime",
  "timezone",
  "title",
  "locationId",
  "locationName",
  "locationAddress",
  "teamId",
  "meetingSubtype",
  "estimatedAttendance",
  "durationMinutes",
  "notes",
]);

const LOCATION_FIELDS = new Set([
  "name",
  "address",
  "contactName",
  "contactPhone",
  "contactEmail",
  "cost",
  "capacity",
  "notes",
]);

const UPDATE_MEETING_FIELDS = new Set([
  "timezone",
  "title",
  "datetime",
  "locationId",
  "locationName",
  "locationAddress",
  "meetingSubtype",
  "estimatedAttendance",
  "durationMinutes",
  "notes",
]);

const UPDATE_CHECKLIST_FIELDS = new Set(["notes", "assignedTo"]);

function closedFields(
  value: string,
  allowed: ReadonlySet<string>
): ReadonlyMap<string, string> | null {
  const entries = value.split("|").map((part) => part.trim());
  const fields = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) return null;
    const key = entry.slice(0, separator).trim();
    const fieldValue = entry.slice(separator + 1).trim();
    if (!allowed.has(key) || fields.has(key) || fieldValue.length === 0) {
      return null;
    }
    fields.set(key, fieldValue);
  }
  return fields;
}

function nullableValue(value: string): string | null {
  return value.toLowerCase() === "none" ? null : value;
}

function nullableInteger(value: string): number | null | undefined {
  if (value.toLowerCase() === "none") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function closedCreateMeetingFields(
  value: string
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, CREATE_MEETING_FIELDS);
  if (!fields) return null;
  const type = exactEnum(fields.get("type") ?? "", meetingTypes);
  const datetime = fields.get("datetime");
  const timezone = fields.get("timezone");
  const teamId = fields.get("teamId") ?? null;
  const meetingSubtype = fields.get("meetingSubtype") ?? null;
  const locationId = fields.get("locationId") ?? null;
  const locationName = fields.get("locationName") ?? null;
  const locationAddress = fields.get("locationAddress") ?? null;
  const estimatedAttendance = fields.has("estimatedAttendance")
    ? Number(fields.get("estimatedAttendance"))
    : null;
  const durationMinutes = fields.has("durationMinutes")
    ? Number(fields.get("durationMinutes"))
    : null;
  if (
    !type ||
    !datetime ||
    !instant.safeParse(datetime).success ||
    !timezone ||
    !zone.safeParse(timezone).success ||
    (type === "team_meeting") !== Boolean(teamId) ||
    (teamId !== null && !uuid.safeParse(teamId).success) ||
    (meetingSubtype !== null && !exactEnum(meetingSubtype, meetingSubtypes)) ||
    (locationId !== null && !uuid.safeParse(locationId).success) ||
    (locationId !== null &&
      (locationName !== null || locationAddress !== null)) ||
    (locationName === null) !== (locationAddress === null) ||
    (estimatedAttendance !== null &&
      (!Number.isInteger(estimatedAttendance) || estimatedAttendance < 0)) ||
    (durationMinutes !== null &&
      (!Number.isInteger(durationMinutes) ||
        durationMinutes < 1 ||
        durationMinutes > 1_440))
  ) {
    return null;
  }
  return {
    type,
    datetime,
    timezone,
    title: fields.get("title") ?? null,
    locationId,
    locationName,
    locationAddress,
    teamId,
    meetingSubtype,
    estimatedAttendance,
    durationMinutes,
    notes: fields.get("notes") ?? null,
  };
}

function closedLocationFields(
  value: string,
  mode: "create" | "update"
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, LOCATION_FIELDS);
  if (!fields || (mode === "update" && fields.size === 0)) return null;
  const capacity = fields.has("capacity")
    ? nullableInteger(fields.get("capacity")!)
    : undefined;
  if (capacity !== undefined && capacity !== null && capacity < 0) return null;
  if (fields.has("capacity") && capacity === undefined) return null;

  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of fields) {
    result[key] = key === "capacity" ? capacity : nullableValue(fieldValue);
  }
  const locationSchema = z.strictObject({
    name: z.string().trim().min(1).max(255),
    address: z.string().trim().min(1).max(500),
    contactName: z.string().max(255).nullable(),
    contactPhone: z.string().max(50).nullable(),
    contactEmail: z.string().email().max(255).nullable(),
    cost: z.string().max(50).nullable(),
    capacity: z.number().int().nonnegative().nullable(),
    notes: z.string().nullable(),
  });
  if (mode === "create") {
    result.contactName ??= null;
    result.contactPhone ??= null;
    result.contactEmail ??= null;
    result.cost ??= null;
    result.capacity ??= null;
    result.notes ??= null;
  }
  const parsed = (
    mode === "create" ? locationSchema : locationSchema.partial()
  ).safeParse(result);
  return parsed.success ? parsed.data : null;
}

function closedMeetingUpdateFields(
  value: string
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, UPDATE_MEETING_FIELDS);
  if (!fields || fields.size < 2 || !fields.has("timezone")) return null;
  const result: Record<string, unknown> = { timezone: fields.get("timezone") };
  for (const [key, fieldValue] of fields) {
    if (key === "timezone") continue;
    if (key === "estimatedAttendance" || key === "durationMinutes") {
      const parsed = nullableInteger(fieldValue);
      if (
        parsed === undefined ||
        (parsed !== null &&
          (parsed < (key === "durationMinutes" ? 1 : 0) ||
            (key === "durationMinutes" && parsed > 1_440)))
      ) {
        return null;
      }
      result[key] = parsed;
    } else {
      result[key] = nullableValue(fieldValue);
    }
  }
  const parsed = z
    .strictObject({
      timezone: zone,
      title: z.string().max(255).nullable().optional(),
      datetime: instant.optional(),
      locationId: uuid.nullable().optional(),
      locationName: z.string().max(255).nullable().optional(),
      locationAddress: z.string().max(500).nullable().optional(),
      meetingSubtype: z.enum(meetingSubtypes).nullable().optional(),
      estimatedAttendance: z.number().int().nonnegative().nullable().optional(),
      durationMinutes: z.number().int().min(1).max(1_440).nullable().optional(),
      notes: z.string().nullable().optional(),
    })
    .safeParse(result);
  if (!parsed.success) return null;
  const hasLocationId = Object.hasOwn(parsed.data, "locationId");
  const hasLocationName = Object.hasOwn(parsed.data, "locationName");
  const hasLocationAddress = Object.hasOwn(parsed.data, "locationAddress");
  if (hasLocationName !== hasLocationAddress) return null;
  if (parsed.data.locationId && hasLocationName) return null;
  if (!hasLocationId && hasLocationName) {
    return { ...parsed.data, locationId: null };
  }
  return parsed.data;
}

function closedChecklistUpdateFields(
  value: string
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, UPDATE_CHECKLIST_FIELDS);
  if (!fields || fields.size === 0) return null;
  const result: Record<string, unknown> = {};
  if (fields.has("notes")) result.notes = nullableValue(fields.get("notes")!);
  if (fields.has("assignedTo")) {
    result.assignedTo = nullableValue(fields.get("assignedTo")!);
  }
  const parsed = z
    .strictObject({
      notes: z.string().nullable().optional(),
      assignedTo: uuid.nullable().optional(),
    })
    .safeParse(result);
  return parsed.success ? parsed.data : null;
}

/** Closed command grammar. No branch accepts JSON, URLs, SQL, or action names. */
export function selectMeetingsEvryRequest(
  literalUserText: string
): MeetingsEvryRequestSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  if (/^(?:show|list)(?: me)? meetings[.!?]*$/i.test(text)) {
    return { kind: "read_list" };
  }
  if (/^(?:show|list) meeting locations[.!?]*$/i.test(text)) {
    return { kind: "read_locations" };
  }
  if (/^show (?:this )?meeting analytics[.!?]*$/i.test(text)) {
    return { kind: "read_analytics" };
  }
  if (/^show (?:this )?meeting(?: details)?[.!?]*$/i.test(text)) {
    return { kind: "read_detail" };
  }

  const fullCreate = /^create meeting:\s*([\s\S]+)$/i.exec(text);
  if (fullCreate?.[1]) {
    const fields = closedCreateMeetingFields(fullCreate[1]);
    return fields ? effect("createMeetingAction", fields) : null;
  }

  const createLocationFields = /^create meeting location:\s*([\s\S]+)$/i.exec(
    text
  );
  if (createLocationFields?.[1]?.includes("=")) {
    const fields = closedLocationFields(createLocationFields[1], "create");
    return fields ? effect("createLocationAction", fields) : null;
  }
  let match = /^create meeting location:\s*([^|]+)\|([\s\S]+)$/i.exec(text);
  if (match?.[1]?.trim() && match[2]?.trim()) {
    return effect("createLocationAction", {
      name: match[1].trim(),
      address: match[2].trim(),
    });
  }
  const updateLocationFields =
    /^update meeting location\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i.exec(text);
  if (
    updateLocationFields?.[1] &&
    uuid.safeParse(updateLocationFields[1]).success &&
    updateLocationFields[2]?.includes("=")
  ) {
    const fields = closedLocationFields(updateLocationFields[2], "update");
    return fields
      ? effect("updateLocationAction", {
          locationId: updateLocationFields[1],
          ...fields,
        })
      : null;
  }
  match =
    /^update meeting location\s+([0-9a-f-]{36}):\s*([^|]+)\|([\s\S]+)$/i.exec(
      text
    );
  if (
    match &&
    uuid.safeParse(match[1]).success &&
    match[2]?.trim() &&
    match[3]?.trim()
  ) {
    return effect("updateLocationAction", {
      locationId: match[1],
      name: match[2].trim(),
      address: match[3].trim(),
    });
  }
  match =
    /^create (vision_meeting|orientation) at (\S+) in (\S+)(?: titled ([\s\S]+))?$/i.exec(
      text
    );
  if (
    match &&
    exactEnum(match[1] ?? "", meetingTypes) &&
    instant.safeParse(match[2]).success &&
    zone.safeParse(match[3]).success
  ) {
    return effect("createMeetingAction", {
      type: match[1],
      datetime: match[2],
      timezone: match[3],
      title: match[4]?.trim() || null,
      locationId: null,
      locationName: null,
      locationAddress: null,
      teamId: null,
      meetingSubtype: null,
      estimatedAttendance: null,
      durationMinutes: null,
      notes: null,
    });
  }
  if (/^delete (?:this )?meeting[.!?]*$/i.test(text)) {
    return effect("deleteMeetingAction");
  }
  const updateMeetingFields = /^update (?:this )?meeting:\s*([\s\S]+)$/i.exec(
    text
  );
  if (updateMeetingFields?.[1]) {
    const fields = closedMeetingUpdateFields(updateMeetingFields[1]);
    return fields ? effect("updateMeetingAction", fields) : null;
  }
  match = /^reschedule (?:this )?meeting to (\S+) in (\S+)$/i.exec(text);
  if (
    match &&
    instant.safeParse(match[1]).success &&
    zone.safeParse(match[2]).success
  ) {
    return effect("updateMeetingAction", {
      datetime: match[1],
      timezone: match[2],
    });
  }
  match = /^set (?:this )?meeting status to ([a-z_]+)[.!?]*$/i.exec(text);
  const meetingStatus = match
    ? exactEnum(match[1] ?? "", meetingStatuses)
    : null;
  if (meetingStatus) {
    return effect("updateMeetingStatusAction", { status: meetingStatus });
  }
  if (/^finalize (?:this )?meeting attendance[.!?]*$/i.test(text)) {
    return effect("finalizeAttendanceAction");
  }

  match = /^add attendee\s+([0-9a-f-]{36})(?: as ([a-z_]+))?[.!?]*$/i.exec(
    text
  );
  if (match && uuid.safeParse(match[1]).success) {
    const attendanceType = match[2]
      ? exactEnum(match[2], attendanceTypes)
      : null;
    if (!match[2] || attendanceType) {
      return effect("addAttendeeAction", {
        personId: match[1],
        attendanceType,
      });
    }
  }
  match = /^add guest\s+([0-9a-f-]{36})[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("addToGuestListAction", { personId: match[1] });
  }
  match = /^add walk-in\s+([0-9a-f-]{36})[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("addWalkInAttendeeAction", { personId: match[1] });
  }
  for (const [prefix, exportName] of [
    ["create and add attendee", "quickAddAttendeeAction"],
    ["create and add guest", "quickAddPersonToGuestListAction"],
    ["create and add walk-in", "quickAddWalkInAction"],
  ] as const) {
    const quick = new RegExp(`^${prefix}:\\s*([\\s\\S]+)$`, "i").exec(text);
    if (!quick?.[1]) continue;
    const fields = personFields(quick[1]);
    if (fields) return effect(exportName, fields);
  }
  match = /^remove attendee\s+([0-9a-f-]{36})[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("removeAttendeeAction", { personId: match[1] });
  }
  match = /^remove guest\s+([0-9a-f-]{36})[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("removeFromGuestListAction", { personId: match[1] });
  }
  match = /^record attendance:\s*([\s\S]+)$/i.exec(text);
  const batch = match?.[1] ? attendanceBatch(match[1]) : null;
  if (batch) return effect("recordAttendanceBatchAction", { records: batch });

  match = /^set rsvp\s+([0-9a-f-]{36}) to ([a-z_]+)[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    const status = exactEnum(match[2] ?? "", responseStatuses);
    if (status) {
      return effect("updateRsvpStatusAction", {
        personId: match[1],
        status,
      });
    }
  }
  match = /^mark guest\s+([0-9a-f-]{36}) (attended|absent)[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("toggleAttendanceStatusAction", {
      personId: match[1],
      status: match[2],
    });
  }
  match = /^add attendee note\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success && match[2]?.trim()) {
    return effect("addAttendeeNoteAction", {
      personId: match[1],
      note: match[2].trim(),
    });
  }
  match =
    /^record response\s+([0-9a-f-]{36}) as ([a-z_]+)(?:\s*:\s*([\s\S]+))?$/i.exec(
      text
    );
  if (match && uuid.safeParse(match[1]).success) {
    const responseType = exactEnum(match[2] ?? "", responseCardTypes);
    if (responseType) {
      return effect("recordResponseCardAction", {
        personId: match[1],
        responseType,
        notes: match[3]?.trim() || null,
      });
    }
  }
  match = /^clear response\s+([0-9a-f-]{36})[.!?]*$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("clearResponseCardAction", { personId: match[1] });
  }
  match = /^set agenda:\s*([\s\S]+)$/i.exec(text);
  const sections = match?.[1] ? agendaSections(match[1]) : null;
  if (sections) return effect("saveAgendaAction", { sections });

  match =
    /^toggle checklist\s+([0-9a-f-]{36}) (checked|unchecked)[.!?]*$/i.exec(
      text
    );
  if (match && uuid.safeParse(match[1]).success) {
    return effect("toggleChecklistItemAction", {
      itemId: match[1],
      checked: match[2] === "checked",
    });
  }
  match = /^update checklist\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i.exec(text);
  if (match && uuid.safeParse(match[1]).success) {
    if (match[2]?.includes("=")) {
      const fields = closedChecklistUpdateFields(match[2]);
      return fields
        ? effect("updateChecklistItemAction", {
            itemId: match[1],
            ...fields,
          })
        : null;
    }
    return effect("updateChecklistItemAction", {
      itemId: match[1],
      notes: match[2]?.trim() || null,
    });
  }
  match =
    /^evaluate (?:this )?meeting:\s*([1-5](?:\s*,\s*[1-5]){7})(?:\s*\|\s*([\s\S]+))?$/i.exec(
      text
    );
  if (match?.[1]) {
    return effect("createEvaluationAction", {
      scores: match[1].split(",").map((value) => Number(value.trim())),
      notes: match[2]?.trim() || null,
    });
  }
  return null;
}

export const MEETINGS_SELECTION_EXAMPLES: Readonly<
  Record<MeetingsActionExport, string>
> = Object.freeze({
  addAttendeeAction:
    "add attendee 10000000-0000-4000-8000-000000000001 as first_time",
  addAttendeeNoteAction:
    "add attendee note 10000000-0000-4000-8000-000000000001: Follow up next week",
  addToGuestListAction: "add guest 10000000-0000-4000-8000-000000000001",
  addWalkInAttendeeAction: "add walk-in 10000000-0000-4000-8000-000000000001",
  clearResponseCardAction:
    "clear response 10000000-0000-4000-8000-000000000001",
  createEvaluationAction:
    "evaluate this meeting: 4,4,4,4,4,4,4,4 | Solid meeting",
  createLocationAction:
    "create meeting location: Community Center | 1 Main Street",
  createMeetingAction:
    "create vision_meeting at 2026-09-12T14:00:00.000Z in America/New_York titled Vision Night",
  deleteMeetingAction: "delete this meeting",
  finalizeAttendanceAction: "finalize this meeting attendance",
  quickAddAttendeeAction:
    "create and add attendee: Alex | Rivera | alex@example.com |",
  quickAddPersonToGuestListAction:
    "create and add guest: Alex | Rivera | alex@example.com |",
  quickAddWalkInAction:
    "create and add walk-in: Alex | Rivera | alex@example.com |",
  recordAttendanceBatchAction:
    "record attendance: 10000000-0000-4000-8000-000000000001=attended",
  recordResponseCardAction:
    "record response 10000000-0000-4000-8000-000000000001 as interested: Call next week",
  removeAttendeeAction: "remove attendee 10000000-0000-4000-8000-000000000001",
  removeFromGuestListAction:
    "remove guest 10000000-0000-4000-8000-000000000001",
  saveAgendaAction: "set agenda: Welcome=10; Vision=30",
  toggleAttendanceStatusAction:
    "mark guest 10000000-0000-4000-8000-000000000001 attended",
  toggleChecklistItemAction:
    "toggle checklist 10000000-0000-4000-8000-000000000001 checked",
  updateChecklistItemAction:
    "update checklist 10000000-0000-4000-8000-000000000001: Bring cables",
  updateLocationAction:
    "update meeting location 10000000-0000-4000-8000-000000000001: Main Hall | 2 Main Street",
  updateMeetingAction:
    "reschedule this meeting to 2026-09-13T14:00:00.000Z in America/New_York",
  updateMeetingStatusAction: "set this meeting status to ready",
  updateRsvpStatusAction:
    "set rsvp 10000000-0000-4000-8000-000000000001 to confirmed",
});
