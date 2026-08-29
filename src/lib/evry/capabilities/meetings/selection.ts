import { z } from "zod";

import {
  attendanceStatuses,
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

type LiteralText = Readonly<{
  literal: string;
  normalized: string;
  boundaries: readonly number[];
}>;

type LiteralMatch = RegExpExecArray & {
  indices: readonly (readonly [number, number] | undefined)[];
};

/** Keep an exact literal beside the NFKC classifier text and align their spans. */
function literalText(value: string): LiteralText {
  const literal = value.trim();
  let normalized = "";
  const boundaries: number[] = [0];
  let literalOffset = 0;
  for (const character of literal) {
    const classified = character.normalize("NFKC");
    const normalizedOffset = normalized.length;
    normalized += classified;
    for (let index = normalizedOffset; index < normalized.length; index += 1) {
      boundaries[index] = literalOffset;
    }
    literalOffset += character.length;
    boundaries[normalized.length] = literalOffset;
  }
  return { literal, normalized, boundaries };
}

function literalSlice(
  value: LiteralText,
  start: number,
  end: number
): LiteralText {
  const literalStart = value.boundaries[start];
  const literalEnd = value.boundaries[end];
  if (literalStart === undefined || literalEnd === undefined) {
    throw new Error("Normalized literal span is not aligned");
  }
  return literalText(value.literal.slice(literalStart, literalEnd));
}

function execLiteral(pattern: RegExp, value: LiteralText): LiteralMatch | null {
  const flags = pattern.flags.includes("d")
    ? pattern.flags
    : `${pattern.flags}d`;
  return new RegExp(pattern.source, flags).exec(
    value.normalized
  ) as LiteralMatch | null;
}

function capturedLiteral(
  value: LiteralText,
  match: LiteralMatch,
  index: number
): LiteralText | null {
  const span = match.indices[index];
  return span ? literalSlice(value, span[0], span[1]) : null;
}

function splitLiteral(value: LiteralText, separator: string): LiteralText[] {
  const parts: LiteralText[] = [];
  let start = 0;
  let at = value.normalized.indexOf(separator);
  while (at !== -1) {
    parts.push(literalSlice(value, start, at));
    start = at + separator.length;
    at = value.normalized.indexOf(separator, start);
  }
  parts.push(literalSlice(value, start, value.normalized.length));
  return parts;
}

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

function personFields(value: LiteralText) {
  const [firstName, lastName, email, phone] = splitLiteral(value, "|");
  const firstNameLiteral = firstName?.literal.trim() ?? "";
  const lastNameLiteral = lastName?.literal.trim() ?? "";
  const emailLiteral = email?.literal.trim() ?? "";
  const phoneLiteral = phone?.literal.trim() ?? "";
  if (!firstNameLiteral || !lastNameLiteral) return null;
  return {
    firstName: firstNameLiteral,
    lastName: lastNameLiteral,
    email: emailLiteral || null,
    phone: phoneLiteral || null,
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

function agendaSections(value: LiteralText) {
  const sections = splitLiteral(value, ";").map((part, index) => {
    const separator = part.normalized.indexOf("=");
    if (separator <= 0) return null;
    const title = literalSlice(part, 0, separator).literal.trim();
    const rawMinutes = part.normalized.slice(separator + 1).trim();
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
  value: LiteralText,
  allowed: ReadonlySet<string>
): ReadonlyMap<string, LiteralText> | null {
  const entries = splitLiteral(value, "|");
  const fields = new Map<string, LiteralText>();
  for (const entry of entries) {
    const separator = entry.normalized.indexOf("=");
    if (separator <= 0) return null;
    const key = entry.normalized.slice(0, separator).trim();
    const fieldValue = literalSlice(
      entry,
      separator + 1,
      entry.normalized.length
    );
    if (
      !allowed.has(key) ||
      fields.has(key) ||
      fieldValue.normalized.trim().length === 0
    ) {
      return null;
    }
    fields.set(key, literalText(fieldValue.literal));
  }
  return fields;
}

function nullableValue(value: LiteralText): string | null {
  return value.normalized.toLowerCase() === "none" ? null : value.literal;
}

function nullableClassifiedValue(value: LiteralText): string | null {
  return value.normalized.toLowerCase() === "none" ? null : value.normalized;
}

function nullableInteger(value: LiteralText): number | null | undefined {
  if (value.normalized.toLowerCase() === "none") return null;
  const parsed = Number(value.normalized);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function closedCreateMeetingFields(
  value: LiteralText
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, CREATE_MEETING_FIELDS);
  if (!fields) return null;
  const type = exactEnum(fields.get("type")?.normalized ?? "", meetingTypes);
  const datetime = fields.get("datetime")?.normalized;
  const timezone = fields.get("timezone")?.normalized;
  const teamId = fields.get("teamId")?.normalized ?? null;
  const meetingSubtype = fields.get("meetingSubtype")?.normalized ?? null;
  const locationId = fields.get("locationId")?.normalized ?? null;
  const locationName = fields.get("locationName")?.literal ?? null;
  const locationAddress = fields.get("locationAddress")?.literal ?? null;
  const estimatedAttendance = fields.has("estimatedAttendance")
    ? Number(fields.get("estimatedAttendance")?.normalized)
    : null;
  const durationMinutes = fields.has("durationMinutes")
    ? Number(fields.get("durationMinutes")?.normalized)
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
    title: fields.get("title")?.literal ?? null,
    locationId,
    locationName,
    locationAddress,
    teamId,
    meetingSubtype,
    estimatedAttendance,
    durationMinutes,
    notes: fields.get("notes")?.literal ?? null,
  };
}

function closedLocationFields(
  value: LiteralText,
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
  value: LiteralText
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, UPDATE_MEETING_FIELDS);
  if (!fields || fields.size < 2 || !fields.has("timezone")) return null;
  const result: Record<string, unknown> = {
    timezone: fields.get("timezone")?.normalized,
  };
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
    } else if (
      key === "datetime" ||
      key === "locationId" ||
      key === "meetingSubtype"
    ) {
      result[key] = nullableClassifiedValue(fieldValue);
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
  value: LiteralText
): Readonly<Record<string, unknown>> | null {
  const fields = closedFields(value, UPDATE_CHECKLIST_FIELDS);
  if (!fields || fields.size === 0) return null;
  const result: Record<string, unknown> = {};
  if (fields.has("notes")) result.notes = nullableValue(fields.get("notes")!);
  if (fields.has("assignedTo")) {
    result.assignedTo = nullableClassifiedValue(fields.get("assignedTo")!);
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
  const input = literalText(literalUserText);
  const text = input.normalized;
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

  const fullCreate = execLiteral(/^create meeting:\s*([\s\S]+)$/i, input);
  if (fullCreate?.[1]) {
    const captured = capturedLiteral(input, fullCreate, 1);
    const fields = captured ? closedCreateMeetingFields(captured) : null;
    return fields ? effect("createMeetingAction", fields) : null;
  }

  const createLocationFields = execLiteral(
    /^create meeting location:\s*([\s\S]+)$/i,
    input
  );
  if (createLocationFields?.[1]?.includes("=")) {
    const captured = capturedLiteral(input, createLocationFields, 1);
    const fields = captured ? closedLocationFields(captured, "create") : null;
    return fields ? effect("createLocationAction", fields) : null;
  }
  let match = execLiteral(
    /^create meeting location:\s*([^|]+)\|([\s\S]+)$/i,
    input
  );
  if (match?.[1]?.trim() && match[2]?.trim()) {
    const name = capturedLiteral(input, match, 1)?.literal;
    const address = capturedLiteral(input, match, 2)?.literal;
    if (!name || !address) return null;
    return effect("createLocationAction", {
      name,
      address,
    });
  }
  const updateLocationFields = execLiteral(
    /^update meeting location\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i,
    input
  );
  if (
    updateLocationFields?.[1] &&
    uuid.safeParse(updateLocationFields[1]).success &&
    updateLocationFields[2]?.includes("=")
  ) {
    const captured = capturedLiteral(input, updateLocationFields, 2);
    const fields = captured ? closedLocationFields(captured, "update") : null;
    return fields
      ? effect("updateLocationAction", {
          locationId: updateLocationFields[1],
          ...fields,
        })
      : null;
  }
  match = execLiteral(
    /^update meeting location\s+([0-9a-f-]{36}):\s*([^|]+)\|([\s\S]+)$/i,
    input
  );
  if (
    match &&
    uuid.safeParse(match[1]).success &&
    match[2]?.trim() &&
    match[3]?.trim()
  ) {
    const name = capturedLiteral(input, match, 2)?.literal;
    const address = capturedLiteral(input, match, 3)?.literal;
    if (!name || !address) return null;
    return effect("updateLocationAction", {
      locationId: match[1],
      name,
      address,
    });
  }
  match = execLiteral(
    /^create (vision_meeting|orientation) at (\S+) in (\S+)(?: titled ([\s\S]+))?$/i,
    input
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
      title: capturedLiteral(input, match, 4)?.literal || null,
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
  const updateMeetingFields = execLiteral(
    /^update (?:this )?meeting:\s*([\s\S]+)$/i,
    input
  );
  if (updateMeetingFields?.[1]) {
    const captured = capturedLiteral(input, updateMeetingFields, 1);
    const fields = captured ? closedMeetingUpdateFields(captured) : null;
    return fields ? effect("updateMeetingAction", fields) : null;
  }
  match = execLiteral(
    /^reschedule (?:this )?meeting to (\S+) in (\S+)$/i,
    input
  );
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
  match = execLiteral(
    /^set (?:this )?meeting status to ([a-z_]+)[.!?]*$/i,
    input
  );
  const meetingStatus = match
    ? exactEnum(match[1] ?? "", meetingStatuses)
    : null;
  if (meetingStatus) {
    return effect("updateMeetingStatusAction", { status: meetingStatus });
  }
  if (/^finalize (?:this )?meeting attendance[.!?]*$/i.test(text)) {
    return effect("finalizeAttendanceAction");
  }

  match = execLiteral(/^add attendee\s+([0-9a-f-]{36})[.!?]*$/i, input);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("addAttendeeAction", { personId: match[1] });
  }
  match = execLiteral(/^add guest\s+([0-9a-f-]{36})[.!?]*$/i, input);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("addToGuestListAction", { personId: match[1] });
  }
  match = execLiteral(/^add walk-in\s+([0-9a-f-]{36})[.!?]*$/i, input);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("addWalkInAttendeeAction", { personId: match[1] });
  }
  for (const [prefix, exportName] of [
    ["create and add attendee", "quickAddAttendeeAction"],
    ["create and add guest", "quickAddPersonToGuestListAction"],
    ["create and add walk-in", "quickAddWalkInAction"],
  ] as const) {
    const quick = execLiteral(
      new RegExp(`^${prefix}:\\s*([\\s\\S]+)$`, "i"),
      input
    );
    if (!quick?.[1]) continue;
    const captured = capturedLiteral(input, quick, 1);
    const fields = captured ? personFields(captured) : null;
    if (fields) return effect(exportName, fields);
  }
  match = execLiteral(/^remove attendee\s+([0-9a-f-]{36})[.!?]*$/i, input);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("removeAttendeeAction", { personId: match[1] });
  }
  match = execLiteral(/^remove guest\s+([0-9a-f-]{36})[.!?]*$/i, input);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("removeFromGuestListAction", { personId: match[1] });
  }
  match = execLiteral(/^record attendance:\s*([\s\S]+)$/i, input);
  const batch = match?.[1] ? attendanceBatch(match[1]) : null;
  if (batch) return effect("recordAttendanceBatchAction", { records: batch });

  match = execLiteral(
    /^set rsvp\s+([0-9a-f-]{36}) to ([a-z_]+)[.!?]*$/i,
    input
  );
  if (match && uuid.safeParse(match[1]).success) {
    const status = exactEnum(match[2] ?? "", responseStatuses);
    if (status) {
      return effect("updateRsvpStatusAction", {
        personId: match[1],
        status,
      });
    }
  }
  match = execLiteral(
    /^mark guest\s+([0-9a-f-]{36}) (attended|absent)[.!?]*$/i,
    input
  );
  if (match && uuid.safeParse(match[1]).success) {
    return effect("toggleAttendanceStatusAction", {
      personId: match[1],
      status: match[2],
    });
  }
  match = execLiteral(
    /^add attendee note\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i,
    input
  );
  if (match && uuid.safeParse(match[1]).success && match[2]?.trim()) {
    const note = capturedLiteral(input, match, 2)?.literal;
    if (!note) return null;
    return effect("addAttendeeNoteAction", {
      personId: match[1],
      note,
    });
  }
  match = execLiteral(
    /^record response\s+([0-9a-f-]{36}) as ([a-z_]+)(?:\s*:\s*([\s\S]+))?$/i,
    input
  );
  if (match && uuid.safeParse(match[1]).success) {
    const responseType = exactEnum(match[2] ?? "", responseCardTypes);
    if (responseType) {
      return effect("recordResponseCardAction", {
        personId: match[1],
        responseType,
        notes: capturedLiteral(input, match, 3)?.literal || null,
      });
    }
  }
  match = execLiteral(/^clear response\s+([0-9a-f-]{36})[.!?]*$/i, input);
  if (match && uuid.safeParse(match[1]).success) {
    return effect("clearResponseCardAction", { personId: match[1] });
  }
  match = execLiteral(/^set agenda:\s*([\s\S]+)$/i, input);
  const agenda = match ? capturedLiteral(input, match, 1) : null;
  const sections = agenda ? agendaSections(agenda) : null;
  if (sections) return effect("saveAgendaAction", { sections });

  match = execLiteral(
    /^toggle checklist\s+([0-9a-f-]{36}) (checked|unchecked)[.!?]*$/i,
    input
  );
  if (match && uuid.safeParse(match[1]).success) {
    return effect("toggleChecklistItemAction", {
      itemId: match[1],
      checked: match[2] === "checked",
    });
  }
  match = execLiteral(
    /^update checklist\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i,
    input
  );
  if (match && uuid.safeParse(match[1]).success) {
    const captured = capturedLiteral(input, match, 2);
    if (match[2]?.includes("=")) {
      const fields = captured ? closedChecklistUpdateFields(captured) : null;
      return fields
        ? effect("updateChecklistItemAction", {
            itemId: match[1],
            ...fields,
          })
        : null;
    }
    return effect("updateChecklistItemAction", {
      itemId: match[1],
      notes: captured?.literal || null,
    });
  }
  match = execLiteral(
    /^evaluate (?:this )?meeting:\s*([1-5](?:\s*,\s*[1-5]){7})(?:\s*\|\s*([\s\S]+))?$/i,
    input
  );
  if (match?.[1]) {
    return effect("createEvaluationAction", {
      scores: match[1].split(",").map((value) => Number(value.trim())),
      notes: capturedLiteral(input, match, 2)?.literal || null,
    });
  }
  return null;
}

export const MEETINGS_SELECTION_EXAMPLES: Readonly<
  Record<MeetingsActionExport, string>
> = Object.freeze({
  addAttendeeAction: "add attendee 10000000-0000-4000-8000-000000000001",
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
