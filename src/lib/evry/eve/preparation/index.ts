import { z } from "zod";
import { PEOPLE_MODEL_PREPARATIONS } from "@/lib/evry/capabilities/preparations/people";
import { OPERATIONS_MODEL_PREPARATIONS } from "@/lib/evry/capabilities/preparations/operations";
import { CONTENT_MODEL_PREPARATIONS } from "@/lib/evry/capabilities/preparations/content";
import { defineEvryModelPreparation } from "@/lib/evry/capabilities/model-preparation";
import {
  requireFreshEvryPlantViewer,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";
import type { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import { evryConversationIdSchema } from "@/lib/evry/conversations/contract";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";
import type { EvryPageContext } from "@/lib/evry/resolvers/contract";
import { resolveAuthorizedEvryPageContext } from "@/lib/evry/resolvers/page-context";
import { meetingInvitationRequestSchema } from "@/lib/evry/recipes/meeting-invitation";
import { prepareMeetingInvitation } from "@/lib/evry/recipes/meeting-invitation-conversation";

const meetingInput = meetingInvitationRequestSchema
  .omit({ sourceText: true })
  .required({ meetingType: true, dateTime: true, durationMinutes: true })
  .refine(
    (value) => Boolean(value.audience) !== Boolean(value.guestPersonIds),
    {
      message: "Choose a named audience or specific people, not both.",
    }
  );

export const evePreparations = Object.freeze([
  ...PEOPLE_MODEL_PREPARATIONS,
  ...OPERATIONS_MODEL_PREPARATIONS,
  ...CONTENT_MODEL_PREPARATIONS,
  defineEvryModelPreparation({
    id: "recipe.meeting-invite",
    capabilityIdentities: [
      "meetings.create",
      "meetings.add-guests",
      "communication.messages.send",
    ],
    inputSchema: meetingInput.describe(
      "Prepare a meeting, its guests and invitation for review. Resolve dates with calendar.resolve first. Use a church-local date/time, explicit meeting type, duration and audience. Read communication templates and locations before preparing; subject/body remain editable by preparing a new review. Nothing is created or sent yet."
    ),
    run(context, request) {
      return prepareMeetingInvitation(context, {
        ...request,
        sourceText: context.literalUserText,
      });
    },
  }),
]);

const byOperation = new Map(evePreparations.map((entry) => [entry.id, entry]));
if (byOperation.size !== evePreparations.length)
  throw new Error("Duplicate Eve preparation operation");

/** Derived from domain contracts, never a second hand-maintained argument catalog. */
export const evePreparationInputSchema = z.strictObject({
  request: z.union(
    evePreparations.map((entry) =>
      z.strictObject({
        operation: z.literal(entry.id),
        arguments: entry.inputSchema,
      })
    )
  ),
});

/** Model discovery loads only the operations needed now; invocation still uses the full trusted registry. */
export function selectedEvePreparationSchema(operations: readonly string[]) {
  const selected = [...new Set(operations)].map((id) => {
    const entry = byOperation.get(id);
    if (!entry) throw new Error(`Unknown preparation operation: ${id}`);
    return z.strictObject({
      operation: z.literal(entry.id),
      arguments: entry.inputSchema,
    });
  });
  if (!selected.length)
    throw new Error("Select at least one preparation operation");
  return z.strictObject({ request: z.union(selected) });
}

export function createEvePreparation(options: {
  actor: EvryPlantActor;
  conversationId: string;
  userRequestKey: string;
  literalUserText: string;
  pageContext: EvryPageContext | null;
  now: Date;
  authorizeRead: typeof authorizeEvryReadCapability;
}) {
  const conversationId = evryConversationIdSchema.parse(options.conversationId);
  return {
    inputSchema: evePreparationInputSchema,
    async prepare(
      input: unknown,
      invocation: { callId: string; signal?: AbortSignal }
    ) {
      invocation.signal?.throwIfAborted();
      if (!invocation.callId.trim())
        return { status: "unavailable", reason: "missing_call_identity" };
      const parsed = evePreparationInputSchema.safeParse(input);
      if (!parsed.success)
        return {
          status: "invalid_input",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path: path.map(String).join("."),
            message,
          })),
        };
      const actor = await requireFreshEvryPlantViewer();
      if (
        actor.userId !== options.actor.userId ||
        actor.plantId !== options.actor.plantId
      )
        return { status: "unavailable", reason: "not_authorized" };
      const operation = byOperation.get(parsed.data.request.operation)!;
      const pageContext = await resolveAuthorizedEvryPageContext({
        actor,
        pageContext: options.pageContext,
      });
      invocation.signal?.throwIfAborted();
      const result = await operation.run(
        {
          actor,
          conversation: { id: conversationId },
          userRequestKey: deriveEvryPlanRequestKey("eve-preparation-call", [
            options.userRequestKey,
            invocation.callId,
          ]),
          literalUserText: options.literalUserText,
          pageContext,
          requestPageContext: options.pageContext,
          now: options.now,
        },
        parsed.data.request.arguments
      );
      invocation.signal?.throwIfAborted();
      return result ?? { status: "unavailable" };
    },
  };
}
