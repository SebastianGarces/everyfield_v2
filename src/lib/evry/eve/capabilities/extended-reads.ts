import { z } from "zod";
import type { EvryReadRegistration } from "@/lib/evry/reads/contract";
import { intelligenceQuerySchema } from "@/lib/evry/capabilities/queries/content-platform";
import { tasksQueryShape } from "@/lib/evry/capabilities/queries/operations-tasks";
import { communicationQuerySchema } from "@/lib/evry/capabilities/queries/content-communication";
import { EVE_CHURCH_MERGE_READ } from "./merge-context";
import { PLANT_INTELLIGENCE_READ_REGISTRATIONS } from "@/lib/evry/capabilities/plant-intelligence/reads";
import {
  TASK_TEMPLATES_READ,
  TASK_PHASE_TEMPLATE_PROMPT_READ,
} from "@/lib/evry/capabilities/tasks/reads";

function intelligenceRead(id: string) {
  const read = PLANT_INTELLIGENCE_READ_REGISTRATIONS.find(
    (entry) => entry.id === id
  );
  if (!read) throw new Error(`Missing registered intelligence reader: ${id}`);
  return read;
}
const checkins = intelligenceRead("plant-intelligence.checkins");
const feedback = intelligenceRead("plant-intelligence.feedback");
const signals = intelligenceRead("plant-intelligence.signals");
function decodeContinuation(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}
function continuation(read: EvryReadRegistration) {
  return z
    .string()
    .max(2000)
    .refine(
      (value) =>
        read.inputSchema.safeParse({ cursor: decodeContinuation(value) })
          .success,
      "Use the unchanged continuation cursor returned by this reader."
    )
    .nullable()
    .default(null);
}
const extraIntelligence = z.discriminatedUnion("resource", [
  z.strictObject({ resource: z.literal("checkins") }),
  z.strictObject({
    resource: z.literal("feedback"),
    cursor: continuation(feedback),
  }),
  z.strictObject({
    resource: z.literal("signals"),
    cursor: continuation(signals),
  }),
]);
const intelligenceInput = z.strictObject({
  query: z.union([intelligenceQuerySchema, extraIntelligence]),
});
const mergeContextInput = z.strictObject({
  resource: z.literal("merge_context"),
});
const communicationInput = z.strictObject({
  query: z.union([communicationQuerySchema, mergeContextInput]),
});
const taskCatalogInput = z.strictObject({
  resource: z.enum(["templates", "phase_prompt"]),
});
const ordinaryTasksInput = z.strictObject(tasksQueryShape);
// Keep an object at the provider boundary while each execution path is parsed
// into its own closed variant. Catalog requests cannot silently ignore filters.
const tasksInput = z
  .strictObject({
    where: tasksQueryShape.where.removeDefault().optional(),
    resource: z
      .enum(["tasks", "checklist", "all", "templates", "phase_prompt"])
      .optional(),
    query: tasksQueryShape.query.optional(),
  })
  .superRefine((input, context) => {
    const parsed = z
      .union([ordinaryTasksInput, taskCatalogInput])
      .safeParse(input);
    if (!parsed.success)
      context.addIssue({
        code: "custom",
        message:
          "Use task filters and query for tasks, or only resource templates/phase_prompt for catalog reads.",
      });
  });

export function extendedEveReadSchema(read: EvryReadRegistration): z.ZodType {
  if (read.id === "intelligence.query") return intelligenceInput;
  if (read.id === "tasks.query") return tasksInput;
  if (read.id === "communication.query") return communicationInput;
  return read.inputSchema;
}

/** Exact authorized readers reachable through this public contract, for the runtime audit. */
export function extendedEveReadIdentities(
  read: EvryReadRegistration
): string[] {
  const extensions =
    read.id === "intelligence.query"
      ? [checkins, feedback, signals]
      : read.id === "tasks.query"
        ? [TASK_TEMPLATES_READ, TASK_PHASE_TEMPLATE_PROMPT_READ]
        : read.id === "communication.query"
          ? [EVE_CHURCH_MERGE_READ]
          : [];
  return [read, ...extensions].map((entry) => entry.capabilityIdentity);
}

/** Resolve the exact inventory identity before authorization; no actor casts or delegated bypass. */
export function resolveEveReadInvocation(
  read: EvryReadRegistration,
  input: unknown
) {
  if (
    read.id === "communication.query" &&
    z.object({ query: mergeContextInput }).safeParse(input).success
  )
    return { read: EVE_CHURCH_MERGE_READ, input: {} };
  if (read.id === "intelligence.query") {
    const parsed = z.object({ query: extraIntelligence }).safeParse(input);
    if (parsed.success) {
      const query = parsed.data.query;
      if (query.resource === "checkins") return { read: checkins, input: {} };
      return {
        read: query.resource === "feedback" ? feedback : signals,
        input: {
          cursor:
            query.cursor === null ? null : decodeContinuation(query.cursor),
        },
      };
    }
  }
  if (read.id === "tasks.query") {
    const parsed = taskCatalogInput.safeParse(input);
    if (parsed.success)
      return {
        read:
          parsed.data.resource === "templates"
            ? TASK_TEMPLATES_READ
            : TASK_PHASE_TEMPLATE_PROMPT_READ,
        input: {},
      };
  }
  return { read, input };
}
