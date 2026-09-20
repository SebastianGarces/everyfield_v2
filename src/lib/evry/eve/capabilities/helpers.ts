import { createHash } from "node:crypto";
import { z } from "zod";
import { meetingTypes } from "@/db/schema";
import { SYSTEM_TEMPLATES } from "@/lib/communication/system-templates";
import { richTextToPlainText, toRichTextHtml } from "@/lib/rich-text/format";
import { toCalendarDate } from "@/lib/datetime";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import { eveCalendarInputSchema, resolveEveCalendar } from "./calendar";

export type EveOperationalLocation = Readonly<{
  id: string;
  name: string;
  address: string;
  capacity: number | null;
  isActive: boolean;
}>;
export type EveInvitationTemplate = Readonly<{
  id: string;
  name: string;
  sourceName: string | null;
  category: string;
  subject: string | null;
  body: string;
  bodyHtml: string | null;
  mergeFields: readonly string[];
}>;
export type EveHelperDependencies = Readonly<{
  readTimeZone(plantId: string): Promise<string>;
  listLocations(plantId: string): Promise<readonly EveOperationalLocation[]>;
  getLocation(
    plantId: string,
    id: string
  ): Promise<EveOperationalLocation | null>;
  listTemplates(plantId: string): Promise<readonly EveInvitationTemplate[]>;
}>;
export type EveHelperTool = Readonly<{
  name: string;
  description: string;
  inputSchema: z.ZodType;
  capabilityIdentity: string;
  run(
    authorization: EvryReadCapabilityAuthorization,
    input: unknown
  ): Promise<unknown>;
}>;

/** Stable versions bind the exact template content, not a display name. */
export function selectEveInvitationTemplate(
  meetingType: string,
  templates: readonly EveInvitationTemplate[]
) {
  const system = SYSTEM_TEMPLATES.find(
    (entry) => entry.invitesMeetingType === meetingType
  );
  if (!system)
    return { status: "unavailable" as const, reason: "no_invitation_template" };
  const selected = templates.find(
    (entry) =>
      entry.category === "meeting_invitation" &&
      (entry.sourceName === system.name || entry.name === system.name)
  );
  const bodyHtml = toRichTextHtml(
    selected?.bodyHtml ?? selected?.body ?? system.body
  );
  const subject = selected?.subject ?? system.subject;
  const mergeFields = [...(selected?.mergeFields ?? system.mergeFields)];
  const version = createHash("sha256")
    .update(JSON.stringify({ subject, bodyHtml, mergeFields }))
    .digest("hex");
  return {
    status: "available" as const,
    source: selected ? "visible_template" : "builtin_template",
    templateId: selected?.id ?? null,
    name: selected?.name ?? system.name,
    meetingType,
    subject,
    body: richTextToPlainText(bodyHtml),
    bodyHtml,
    mergeFields,
    version,
  };
}

export function createEveHelperTools(
  dependencies: EveHelperDependencies,
  now: Date
): readonly EveHelperTool[] {
  function helper<S extends z.ZodType>(entry: {
    name: string;
    description: string;
    inputSchema: S;
    capabilityIdentity: string;
    run(
      authorization: EvryReadCapabilityAuthorization,
      input: z.output<S>
    ): Promise<unknown>;
  }): EveHelperTool {
    return {
      ...entry,
      run: (authorization, input) =>
        entry.run(authorization, entry.inputSchema.parse(input)),
    };
  }
  return [
    helper({
      name: "context.get",
      description:
        "Get the server reference time, church-local day and timezone for this request. This is minimal operational context, not a settings reader. Actor identity and timezone cannot be supplied as arguments.",
      inputSchema: z.strictObject({}),
      capabilityIdentity: "tasks.read.list",
      async run({ actor }) {
        const timeZone = await dependencies.readTimeZone(actor.plantId);
        return {
          referenceInstant: now.toISOString(),
          today: toCalendarDate(now, timeZone),
          timeZone,
        };
      },
    }),
    helper({
      name: "calendar.resolve",
      description:
        "Resolve interpreted calendar constraints against the server clock and church timezone. Use weekday/upcoming for next Sunday; infer omitted year with month_day. Returns exact date/time and DST ambiguity. Retain its result in the draft rather than recomputing on later turns.",
      inputSchema: eveCalendarInputSchema,
      capabilityIdentity: "tasks.read.list",
      async run({ actor }, input) {
        return resolveEveCalendar(input, {
          now,
          timeZone: await dependencies.readTimeZone(actor.plantId),
        });
      },
    }),
    helper({
      name: "locations.query",
      description:
        "Find saved active operational meeting locations. Look here before asking the user for the church location. A search returning multiple plausible places needs clarification, not an invented default.",
      inputSchema: z.strictObject({
        search: z.string().trim().min(1).max(200).optional(),
        offset: z.number().int().min(0).max(100000).default(0),
        limit: z.number().int().min(1).max(50).default(25),
      }),
      capabilityIdentity: "meetings.read.schedule",
      async run({ actor }, input) {
        const query = input.search?.toLocaleLowerCase("en-US");
        const rows = (await dependencies.listLocations(actor.plantId)).filter(
          (location) =>
            location.isActive &&
            (!query ||
              `${location.name} ${location.address}`
                .toLocaleLowerCase("en-US")
                .includes(query))
        );
        const end = input.offset + input.limit;
        return {
          items: rows.slice(input.offset, end),
          total: rows.length,
          nextOffset: end < rows.length ? end : null,
        };
      },
    }),
    helper({
      name: "locations.get",
      description:
        "Read one saved location by ID within the current plant. A missing or foreign location is unavailable.",
      inputSchema: z.strictObject({ id: z.string().uuid() }),
      capabilityIdentity: "meetings.read.schedule",
      async run({ actor }, { id }) {
        const location = await dependencies.getLocation(actor.plantId, id);
        return location
          ? { status: "available", location }
          : { status: "unavailable" };
      },
    }),
    helper({
      name: "templates.for_meeting",
      description:
        "Read the full subject/body/placeholders for a meeting type's invitation, honoring the church's renamed template fork. Provides a versioned built-in default if none is stored. Use one editable template preview, not repeated per-recipient bodies. This does not send anything.",
      inputSchema: z.strictObject({ meetingType: z.enum(meetingTypes) }),
      capabilityIdentity: "communication.delivery.get-message",
      async run({ actor }, { meetingType }) {
        return selectEveInvitationTemplate(
          meetingType,
          await dependencies.listTemplates(actor.plantId)
        );
      },
    }),
  ];
}

export const productionEveHelperDependencies: EveHelperDependencies = {
  async readTimeZone(plantId) {
    const { readEvryPlantTimeZone } =
      await import("@/lib/evry/reads/plant-time-zone");
    return readEvryPlantTimeZone(plantId);
  },
  async listLocations(plantId) {
    const { listLocations } = await import("@/lib/meetings/locations");
    return (await listLocations(plantId)).map(
      ({ id, name, address, capacity, isActive }) => ({
        id,
        name,
        address,
        capacity,
        isActive,
      })
    );
  },
  async getLocation(plantId, id) {
    const { getLocation } = await import("@/lib/meetings/locations");
    const location = await getLocation(plantId, id);
    if (!location) return null;
    return {
      id: location.id,
      name: location.name,
      address: location.address,
      capacity: location.capacity,
      isActive: location.isActive,
    };
  },
  async listTemplates(plantId) {
    const [
      { getTemplates },
      { db },
      { messageTemplates },
      { and, eq, inArray, isNull },
    ] = await Promise.all([
      import("@/lib/communication/templates"),
      import("@/db"),
      import("@/db/schema/communication"),
      import("drizzle-orm"),
    ]);
    const rows = await getTemplates(plantId, {
      category: "meeting_invitation",
    });
    const sourceIds = rows.flatMap((row) =>
      row.sourceTemplateId ? [row.sourceTemplateId] : []
    );
    const sources = sourceIds.length
      ? await db
          .select({ id: messageTemplates.id, name: messageTemplates.name })
          .from(messageTemplates)
          .where(
            and(
              inArray(messageTemplates.id, sourceIds),
              isNull(messageTemplates.churchId),
              eq(messageTemplates.isSystem, true)
            )
          )
      : [];
    const sourceNames = new Map(sources.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceName: row.sourceTemplateId
        ? (sourceNames.get(row.sourceTemplateId) ?? null)
        : null,
      category: row.category,
      subject: row.subject,
      body: row.body,
      bodyHtml: row.bodyHtml,
      mergeFields: row.mergeFields ?? [],
    }));
  },
};
