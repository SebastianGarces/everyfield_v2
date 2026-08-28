import { z } from "zod";

import { resumeEvryConversation } from "@/lib/evry/conversations/service";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";

import {
  evryConversationFailure,
  evryConversationJson,
  publicEvryConversation,
} from "../shared";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({
  conversationId: z.string().uuid(),
});
type RouteContext = Readonly<{
  params: Promise<{ conversationId: string }>;
}>;

export type EvryConversationGetOptions = Readonly<{
  resume?: typeof resumeEvryConversation;
  now?: () => Date;
}>;

/** Reopen stored history without replaying a model, read, plan, or effect. */
export function createEvryConversationGet({
  resume = resumeEvryConversation,
  now = () => new Date(),
}: EvryConversationGetOptions = {}): (
  request: Request,
  context: RouteContext
) => Promise<Response> {
  return async function evryConversationGet(_request, context) {
    try {
      // FIRST. A foreign or malformed path is not inspected before auth.
      const actor = await requireEvryPlantViewer();
      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }

      const resumed = await resume({
        actor,
        conversationId: params.data.conversationId,
        now: now(),
      });
      if (!resumed) {
        return evryConversationJson({ status: "unavailable" }, 404);
      }
      return evryConversationJson({
        status: "available",
        conversation: publicEvryConversation(resumed),
      });
    } catch (error) {
      return evryConversationFailure(error);
    }
  };
}

export const GET = createEvryConversationGet();
