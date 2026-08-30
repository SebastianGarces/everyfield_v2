import { z } from "zod";

import { publicEvryConversation } from "@/lib/evry/conversations/public";
import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
import { reuseCompletedEvryRecipe } from "@/lib/evry/conversations/reuse";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";

import { evryConversationFailure, evryConversationJson } from "../../shared";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({
  conversationId: z.string().uuid(),
});
const reuseBodySchema = z.strictObject({
  requestKey: z.string().uuid(),
  resultArtifactId: z.string().uuid(),
});

type RouteContext = Readonly<{
  params: Promise<{ conversationId: string }>;
}>;

export type EvryRecipeReusePostOptions = Readonly<{
  reuse?: typeof reuseCompletedEvryRecipe;
  now?: () => Date;
}>;

/** Start one fresh production conversation from a registered completed recipe. */
export function createEvryRecipeReusePost({
  reuse = reuseCompletedEvryRecipe,
  now = () => new Date(),
}: EvryRecipeReusePostOptions = {}) {
  return async function evryRecipeReusePost(
    request: Request,
    context: RouteContext
  ): Promise<Response> {
    try {
      // FIRST. Neither a source conversation nor artifact id is inspected
      // before the actor is freshly minted for this request.
      const actor = await requireEvryPlantViewer();
      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      const parsed = reuseBodySchema.safeParse(body);
      if (!parsed.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      const result = await reuse({
        actor,
        sourceConversationId: params.data.conversationId,
        resultArtifactId: parsed.data.resultArtifactId,
        requestKey: parsed.data.requestKey,
        now: now(),
      });
      if (result.status === "unavailable") {
        return evryConversationJson({ status: "unavailable" }, 404);
      }
      return evryConversationJson(
        {
          status: "created",
          conversation: publicEvryConversation(result.resumed),
        },
        201
      );
    } catch (error) {
      if (error instanceof EvryConversationIdempotencyError) {
        return evryConversationJson({ status: "stale" }, 409);
      }
      return evryConversationFailure(error);
    }
  };
}

export const POST = createEvryRecipeReusePost();
