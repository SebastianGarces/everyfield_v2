import { z } from "zod";

import type { TeamsEffectOperation } from "./effect-contracts";

const uuid = z.string().uuid();

export type TeamsEvryReadSelection =
  | Readonly<{ kind: "read_list"; status: string | null }>
  | Readonly<{ kind: "read_detail"; teamId: string }>
  | Readonly<{ kind: "read_health" }>
  | Readonly<{ kind: "read_training"; teamId: string }>
  | Readonly<{ kind: "read_meetings"; teamId: string }>
  | Readonly<{ kind: "read_responsibilities"; teamId: string }>
  | Readonly<{ kind: "read_candidates"; query: string }>;

export type TeamsEvryEffectSelection = Readonly<{
  kind: "effect";
  operation: TeamsEffectOperation;
  values: Readonly<Record<string, string>>;
}>;

export type TeamsEvryRequestSelection =
  | TeamsEvryReadSelection
  | TeamsEvryEffectSelection;

type LiteralText = Readonly<{
  literal: string;
  normalized: string;
  boundaries: readonly number[];
}>;

function literalText(value: string): LiteralText {
  const literal = value.trim();
  let normalized = "";
  const boundaries: number[] = [0];
  let literalOffset = 0;
  for (const character of literal) {
    const classified = character.normalize("NFKC");
    for (
      let index = normalized.length;
      index < normalized.length + classified.length;
      index += 1
    ) {
      boundaries[index] = literalOffset;
    }
    normalized += classified;
    literalOffset += character.length;
    boundaries[normalized.length] = literalOffset;
  }
  return { literal, normalized, boundaries };
}

function literalSlice(value: LiteralText, start: number, end: number): string {
  const literalStart = value.boundaries[start];
  const literalEnd = value.boundaries[end];
  if (literalStart === undefined || literalEnd === undefined)
    throw new Error("Unaligned Teams command span");
  return value.literal.slice(literalStart, literalEnd).trim();
}

function parseFields(
  value: LiteralText,
  start: number
): Readonly<Record<string, string>> | null {
  const tail = value.normalized.slice(start);
  if (tail.trim().length === 0) return {};
  const leadingWhitespace = tail.length - tail.trimStart().length;
  if (tail.trimStart().startsWith("{")) {
    const encoded = literalSlice(
      value,
      start + leadingWhitespace,
      value.normalized.length
    );
    try {
      const parsed = JSON.parse(encoded) as unknown;
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object" ||
        Object.getPrototypeOf(parsed) !== Object.prototype
      ) {
        return null;
      }
      const entries = Object.entries(parsed);
      if (
        entries.some(
          ([key, fieldValue]) =>
            !/^[a-z][a-zA-Z0-9]*$/.test(key) || typeof fieldValue !== "string"
        )
      ) {
        return null;
      }
      return Object.freeze(
        Object.fromEntries(entries) as Record<string, string>
      );
    } catch {
      return null;
    }
  }
  const fields: Record<string, string> = {};
  let cursor = start;
  for (const part of tail.split("|")) {
    const partStart = value.normalized.indexOf(part, cursor);
    cursor = partStart + part.length + 1;
    const separator = part.indexOf("=");
    if (separator <= 0) return null;
    const key = part.slice(0, separator).trim();
    const absoluteValueStart = partStart + separator + 1;
    const fieldValue = literalSlice(
      value,
      absoluteValueStart,
      partStart + part.length
    );
    if (!/^[a-z][a-zA-Z0-9]*$/.test(key) || key in fields) return null;
    fields[key] = fieldValue;
  }
  return Object.freeze(fields);
}

const EFFECT_COMMANDS = {
  "assign-member": "assignMemberAction",
  "assign-leader": "assignTeamLeaderAction",
  "create-meeting": "createMeetingAction",
  "create-responsibility": "createResponsibilityAction",
  "create-role": "createRoleAction",
  "create-team": "createTeamAction",
  "create-training-program": "createTrainingProgramAction",
  "delete-responsibility": "deleteResponsibilityAction",
  "delete-role": "deleteRoleAction",
  "import-roles": "importRoleTemplatesAction",
  initialize: "initializeTeamsAction",
  "initialize-with-roles": "initializeTeamsWithRolesAction",
  "initialize-responsibilities": "initializeResponsibilities",
  "mark-training-complete": "markTrainingCompleteAction",
  "remove-member": "removeMemberAction",
  "set-responsibility-complete": "setResponsibilityCompleteAction",
  "update-responsibility": "updateResponsibilityAction",
  "update-role": "updateRoleAction",
  "update-team": "updateTeamAction",
} as const satisfies Readonly<Record<string, TeamsEffectOperation>>;

const ALLOWED_FIELDS: Readonly<
  Record<TeamsEffectOperation, ReadonlySet<string>>
> = {
  assignMemberAction: new Set(["teamId", "roleId", "personId", "startDate"]),
  assignTeamLeaderAction: new Set(["teamId", "personId"]),
  createMeetingAction: new Set([
    "teamId",
    "datetime",
    "timezone",
    "title",
    "locationId",
    "locationName",
    "locationAddress",
    "meetingSubtype",
    "estimatedAttendance",
    "durationMinutes",
    "notes",
  ]),
  createResponsibilityAction: new Set(["teamId", "title"]),
  createRoleAction: new Set([
    "teamId",
    "name",
    "description",
    "isLeadershipRole",
    "timeCommitment",
    "desiredSkills",
    "sortOrder",
  ]),
  createTeamAction: new Set(["name", "description", "icon"]),
  createTrainingProgramAction: new Set([
    "teamId",
    "name",
    "description",
    "isRequired",
  ]),
  deleteResponsibilityAction: new Set(["responsibilityId"]),
  deleteRoleAction: new Set(["roleId"]),
  importRoleTemplatesAction: new Set(["teamId", "teamKey", "roleKeys"]),
  initializeTeamsAction: new Set(["teamKeys"]),
  initializeTeamsWithRolesAction: new Set(),
  initializeResponsibilities: new Set(["teamId"]),
  markTrainingCompleteAction: new Set(["personId", "programId"]),
  removeMemberAction: new Set(["membershipId"]),
  setResponsibilityCompleteAction: new Set(["responsibilityId", "completed"]),
  updateResponsibilityAction: new Set(["responsibilityId", "title"]),
  updateRoleAction: new Set([
    "roleId",
    "name",
    "description",
    "isLeadershipRole",
    "timeCommitment",
    "desiredSkills",
    "sortOrder",
  ]),
  updateTeamAction: new Set([
    "teamId",
    "name",
    "description",
    "icon",
    "status",
  ]),
};

const EMPTY_FIELDS: Readonly<
  Partial<Record<TeamsEffectOperation, ReadonlySet<string>>>
> = {
  createTeamAction: new Set(["description", "icon"]),
  updateRoleAction: new Set(["description"]),
  updateTeamAction: new Set(["description", "icon"]),
};

function effectSelection(value: LiteralText): TeamsEvryEffectSelection | null {
  const match = /^teams\s+([a-z-]+)(?:\s*\|\s*)?/i.exec(value.normalized);
  if (!match) return null;
  const command = match[1]?.toLowerCase();
  const operation = command
    ? EFFECT_COMMANDS[command as keyof typeof EFFECT_COMMANDS]
    : undefined;
  if (!operation) return null;
  const fields = parseFields(value, match[0].length);
  if (!fields) return null;
  const allowed = ALLOWED_FIELDS[operation];
  if (Object.keys(fields).some((key) => !allowed.has(key))) return null;
  const emptyFields = EMPTY_FIELDS[operation] ?? new Set();
  if (
    Object.entries(fields).some(
      ([key, fieldValue]) => fieldValue.length === 0 && !emptyFields.has(key)
    )
  ) {
    return null;
  }
  return { kind: "effect", operation, values: fields };
}

/** Pure closed command selection. NFKC is classifier-only; payload stays literal. */
export function selectTeamsEvryRequest(
  input: string
): TeamsEvryRequestSelection | null {
  const value = literalText(input);
  const normalized = value.normalized;
  if (/^list ministry teams$/i.test(normalized))
    return { kind: "read_list", status: null };
  const listStatus =
    /^list ministry teams status=(forming|active|paused)$/i.exec(normalized);
  if (listStatus?.[1])
    return { kind: "read_list", status: listStatus[1].toLowerCase() };
  if (/^review team health$/i.test(normalized)) return { kind: "read_health" };
  const candidate = /^search team candidates\s*\|\s*/i.exec(normalized);
  if (candidate) {
    const query = literalSlice(value, candidate[0].length, normalized.length);
    return query ? { kind: "read_candidates", query } : null;
  }
  const target =
    /^review ministry team\s+([0-9a-f-]{36})(?:\s+(training|meetings|responsibilities))?$/i.exec(
      normalized
    );
  if (target?.[1] && uuid.safeParse(target[1]).success) {
    const teamId = target[1].toLowerCase();
    if (target[2]?.toLowerCase() === "training")
      return { kind: "read_training", teamId };
    if (target[2]?.toLowerCase() === "meetings")
      return { kind: "read_meetings", teamId };
    if (target[2]?.toLowerCase() === "responsibilities")
      return { kind: "read_responsibilities", teamId };
    return { kind: "read_detail", teamId };
  }
  return effectSelection(value);
}

export const TEAMS_EFFECT_COMMANDS = Object.freeze(EFFECT_COMMANDS);
