import { z } from "zod";

import {
  EvryConversationIdempotencyError,
  EvryConversationStateConflictError,
} from "@/lib/evry/conversations/repository";
import { continueEvryConversation } from "@/lib/evry/conversations/service";
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
} from "../../shared";
import {
  evryConversationStream,
  wantsEvryConversationStream,
} from "../../stream";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({
  conversationId: z.string().uuid(),
});
const continueConversationBodySchema = z
  .object({
    requestKey: z.string().uuid(),
    message: z.string().min(1).max(8_000),
    pageContext: evryPageContextSchema.nullable().optional(),
  })
  .strict();
type RouteContext = Readonly<{
  params: Promise<{ conversationId: string }>;
}>;

export type EvryConversationMessagePostOptions = Readonly<{
  continueConversation?: typeof continueEvryConversation;
  now?: () => Date;
  resolvePageContext?: typeof resolveAuthorizedEvryPageContext;
  activeRuns?: EvryConversationActiveRunCoordinator;
}>;

/** Persist and compile one authenticated continuation without running a model. */
export function createEvryConversationMessagePost({
  continueConversation = continueEvryConversation,
  now = () => new Date(),
  resolvePageContext = resolveAuthorizedEvryPageContext,
  activeRuns = evryConversationActiveRunCoordinator,
}: EvryConversationMessagePostOptions = {}): (
  request: Request,
  context: RouteContext
) => Promise<Response> {
  return async function evryConversationMessagePost(request, context) {
    try {
      // FIRST. Both path identity and literal message bytes remain unread until
      // a fresh session-backed plant actor exists.
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
      const parsed = continueConversationBodySchema.safeParse(body);
      if (!parsed.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }

      const requestPageContext = parsed.data.pageContext ?? null;
      const resolveRequestPageContext = () =>
        resolvePageContext({ actor, pageContext: requestPageContext });

      if (wantsEvryConversationStream(request)) {
        const startedAt = now();
        const prepared = await activeRuns.prepare({
          actor,
          requestKey: parsed.data.requestKey,
          identity: {
            kind: "conversation",
            operation: "continue",
            conversationId: params.data.conversationId,
            planId: null,
            planFingerprint: null,
          },
          fingerprintInput: {
            version: 1,
            operation: "continue",
            conversationId: params.data.conversationId,
            message: parsed.data.message,
            pageContext: requestPageContext,
          },
          startedAt,
          perform: async (reportStage) => {
            const result = await continueConversation({
              actor,
              conversationId: params.data.conversationId,
              requestKey: parsed.data.requestKey,
              message: parsed.data.message,
              resolvePageContext: resolveRequestPageContext,
              requestPageContext,
              now: startedAt,
              reportStage,
            });
            return result
              ? { conversation: publicEvryConversation(result.resumed) }
              : null;
          },
        });
        return evryConversationStream({
          requestId: parsed.data.requestKey,
          run: (reportStage) => activeRuns.run(prepared, reportStage),
          failureCode: (error) =>
            error instanceof EvryConversationStateConflictError ||
            error instanceof EvryConversationIdempotencyError
              ? "stale"
              : "unavailable",
        });
      }

      const result = await continueConversation({
        actor,
        conversationId: params.data.conversationId,
        requestKey: parsed.data.requestKey,
        message: parsed.data.message,
        resolvePageContext: resolveRequestPageContext,
        requestPageContext,
        now: now(),
      });
      if (!result) {
        return evryConversationJson({ status: "unavailable" }, 404);
      }

      return evryConversationJson({
        status: result.status,
        conversation: publicEvryConversation(result.resumed),
        reference:
          result.reference.status === "not_applicable"
            ? { status: "not_applicable" }
            : result.reference.status === "resolved"
              ? {
                  status: "resolved",
                  entityType: result.reference.reference.entityType,
                  entityId: result.reference.reference.entityId,
                }
              : {
                  status: "clarification",
                  reason: result.reference.reason,
                  artifact: result.reference.artifact,
                },
      });
    } catch (error) {
      if (
        error instanceof EvryConversationStateConflictError ||
        error instanceof EvryConversationIdempotencyError ||
        error instanceof EvryActiveRunIdentityError
      ) {
        return evryConversationJson({ status: "stale" }, 409);
      }
      return evryConversationFailure(error);
    }
  };
}

export const POST = createEvryConversationMessagePost();
