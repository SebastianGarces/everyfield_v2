import { z } from "zod";

import { publicEvryConversation } from "@/lib/evry/conversations/public";
import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
import { reuseCompletedEvryRecipe } from "@/lib/evry/conversations/reuse";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import {
  evryConversationActiveRunCoordinator,
  type EvryConversationActiveRunCoordinator,
} from "@/lib/evry/runs/conversation";
import { EvryActiveRunIdentityError } from "@/lib/evry/runs/contract";

import { evryConversationFailure, evryConversationJson } from "../../shared";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({
  conversationId: z.string().uuid(),
});
const reuseBodySchema = z.strictObject({
  requestKey: z.string().uuid(),
  resultArtifactId: z.string().uuid(),
  recipeIdentity: z.string().trim().min(1).max(160),
});

type RouteContext = Readonly<{
  params: Promise<{ conversationId: string }>;
}>;

export type EvryRecipeReusePostOptions = Readonly<{
  reuse?: typeof reuseCompletedEvryRecipe;
  now?: () => Date;
  activeRuns?: EvryConversationActiveRunCoordinator;
}>;

/** Start one fresh production conversation from a registered completed recipe. */
export function createEvryRecipeReusePost({
  reuse = reuseCompletedEvryRecipe,
  now = () => new Date(),
  activeRuns = evryConversationActiveRunCoordinator,
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
      const startedAt = now();
      const prepared = await activeRuns.prepare({
        actor,
        requestKey: parsed.data.requestKey,
        identity: {
          kind: "conversation",
          operation: "reuse",
          conversationId: null,
          planId: null,
          planFingerprint: null,
        },
        fingerprintInput: {
          version: 1,
          operation: "reuse",
          sourceConversationId: params.data.conversationId,
          resultArtifactId: parsed.data.resultArtifactId,
          recipeIdentity: parsed.data.recipeIdentity,
        },
        startedAt,
        perform: async (reportStage) => {
          const result = await reuse({
            actor,
            sourceConversationId: params.data.conversationId,
            resultArtifactId: parsed.data.resultArtifactId,
            recipeIdentity: parsed.data.recipeIdentity,
            requestKey: parsed.data.requestKey,
            now: startedAt,
            reportStage,
          });
          return result.status === "created"
            ? { conversation: publicEvryConversation(result.resumed) }
            : null;
        },
      });
      const result = await activeRuns.run(prepared, () => undefined);
      if (result === null) {
        return evryConversationJson({ status: "unavailable" }, 404);
      }
      if ("status" in result) {
        return evryConversationJson(
          { status: "active", requestId: parsed.data.requestKey },
          202
        );
      }
      return evryConversationJson(
        {
          status: "created",
          conversation: result.conversation,
        },
        201
      );
    } catch (error) {
      if (
        error instanceof EvryConversationIdempotencyError ||
        error instanceof EvryActiveRunIdentityError
      ) {
        return evryConversationJson({ status: "stale" }, 409);
      }
      return evryConversationFailure(error);
    }
  };
}

export const POST = createEvryRecipeReusePost();
