import { z } from "zod";

import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
import { createEvryConversation } from "@/lib/evry/conversations/service";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import { evryPageContextSchema } from "@/lib/evry/resolvers/contract";

import {
  evryConversationFailure,
  evryConversationJson,
  publicEvryConversation,
} from "./shared";

export const dynamic = "force-dynamic";

const createConversationBodySchema = z
  .object({
    requestKey: z.string().uuid(),
    message: z.string().min(1).max(8_000),
    pageContext: evryPageContextSchema.nullable().optional(),
  })
  .strict();

export type EvryConversationCreatePostOptions = Readonly<{
  create?: typeof createEvryConversation;
  now?: () => Date;
}>;

/** Build the auth-first conversation creation endpoint. */
export function createEvryConversationCreatePost({
  create = createEvryConversation,
  now = () => new Date(),
}: EvryConversationCreatePostOptions = {}): (
  request: Request
) => Promise<Response> {
  return async function evryConversationCreatePost(request) {
    try {
      // FIRST. Neither literal message bytes nor page context are read before
      // the actor is freshly minted for this request.
      const actor = await requireEvryPlantViewer();

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      const parsed = createConversationBodySchema.safeParse(body);
      if (!parsed.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }

      const resumed = await create({
        actor,
        requestKey: parsed.data.requestKey,
        message: parsed.data.message,
        pageContext: parsed.data.pageContext ?? null,
        now: now(),
      });
      return evryConversationJson(
        {
          status: "created",
          conversation: publicEvryConversation(resumed),
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

export const POST = createEvryConversationCreatePost();
