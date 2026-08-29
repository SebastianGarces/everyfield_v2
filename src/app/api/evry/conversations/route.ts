import { z } from "zod";

import {
  evryConversationHistorySearchSchema,
  listEvryConversationHistory,
} from "@/lib/evry/conversations/history";
import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
import { createEvryConversation } from "@/lib/evry/conversations/service";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import { evryPageContextSchema } from "@/lib/evry/resolvers/contract";
import { resolveAuthorizedEvryPageContext } from "@/lib/evry/resolvers/page-context";
import {
  evryConversationActiveRunCoordinator,
  type EvryConversationActiveRunCoordinator,
} from "@/lib/evry/runs/conversation";
import { EvryActiveRunIdentityError } from "@/lib/evry/runs/contract";

import {
  evryConversationFailure,
  evryConversationJson,
  publicEvryConversation,
} from "./shared";
import { evryConversationStream, wantsEvryConversationStream } from "./stream";

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
  resolvePageContext?: typeof resolveAuthorizedEvryPageContext;
  activeRuns?: EvryConversationActiveRunCoordinator;
}>;

/** Build the auth-first conversation creation endpoint. */
export function createEvryConversationCreatePost({
  create = createEvryConversation,
  now = () => new Date(),
  resolvePageContext = resolveAuthorizedEvryPageContext,
  activeRuns = evryConversationActiveRunCoordinator,
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

      const requestPageContext = parsed.data.pageContext ?? null;
      const pageContext = await resolvePageContext({
        actor,
        pageContext: requestPageContext,
      });

      if (wantsEvryConversationStream(request)) {
        const startedAt = now();
        const prepared = await activeRuns.prepare({
          actor,
          requestKey: parsed.data.requestKey,
          identity: {
            kind: "conversation",
            operation: "create",
            conversationId: null,
            planId: null,
            planFingerprint: null,
          },
          fingerprintInput: {
            version: 1,
            operation: "create",
            message: parsed.data.message,
            pageContext: requestPageContext,
          },
          startedAt,
          perform: async (reportStage) => {
            const resumed = await create({
              actor,
              requestKey: parsed.data.requestKey,
              message: parsed.data.message,
              pageContext,
              requestPageContext,
              now: startedAt,
              reportStage,
            });
            return { conversation: publicEvryConversation(resumed) };
          },
        });
        return evryConversationStream({
          requestId: parsed.data.requestKey,
          status: 201,
          run: (reportStage) => activeRuns.run(prepared, reportStage),
          failureCode: (error) =>
            error instanceof EvryConversationIdempotencyError
              ? "stale"
              : "unavailable",
        });
      }

      const resumed = await create({
        actor,
        requestKey: parsed.data.requestKey,
        message: parsed.data.message,
        pageContext,
        requestPageContext,
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

export const POST = createEvryConversationCreatePost();

export type EvryConversationHistoryGetOptions = Readonly<{
  list?: typeof listEvryConversationHistory;
  now?: () => Date;
}>;

/** List only the freshly authenticated actor's conversations in this plant. */
export function createEvryConversationHistoryGet({
  list = listEvryConversationHistory,
  now = () => new Date(),
}: EvryConversationHistoryGetOptions = {}): (
  request: Request
) => Promise<Response> {
  return async function evryConversationHistoryGet(request) {
    try {
      // FIRST. Search text is still client input, including when it looks like
      // another account's private title.
      const actor = await requireEvryPlantViewer();
      const parsedSearch = evryConversationHistorySearchSchema.safeParse(
        new URL(request.url).searchParams.get("q") ?? ""
      );
      if (!parsedSearch.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }

      const conversations = await list({
        actor,
        search: parsedSearch.data,
        now: now(),
      });
      return evryConversationJson({
        status: "available",
        conversations,
      });
    } catch (error) {
      return evryConversationFailure(error);
    }
  };
}

export const GET = createEvryConversationHistoryGet();
