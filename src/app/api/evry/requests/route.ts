import type { LanguageModel } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  mintEvryAuditRequest,
  recordEvryRequestAudit,
  type EvryAuditRequest,
  type EvryCorrelationId,
  type EvryRequestAuditResult,
} from "@/lib/evry/audit";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";
import {
  classifyEvryRequest,
  type EvryPolicyDecision,
} from "@/lib/evry/policy";
import type {
  EvryReadContinuation,
  EvryReadContinuationContext,
} from "@/lib/evry/reads/contract";
import { evryPageContextSchema } from "@/lib/evry/resolvers/contract";

export const dynamic = "force-dynamic";

const evryRequestBodySchema = z
  .object({
    requestText: z.string().min(1),
    pageContext: evryPageContextSchema.nullable().optional(),
  })
  .strict();

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

function privateJson(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function viewerRefusal(error: unknown): NextResponse | null {
  if (isUnauthorized(error)) {
    return privateJson({ status: "unavailable" }, 401);
  }
  if (error instanceof EvryPlantViewerRefusalError) {
    return privateJson({ status: "unavailable" }, 404);
  }
  return null;
}

export type EvryRequestContinuationContext = EvryReadContinuationContext &
  Readonly<{
    correlationId: EvryCorrelationId;
    planRequestKey: EvryAuditRequest["planRequestKey"];
  }>;

export type EvryRequestActionContinuation = (
  context: EvryRequestContinuationContext
) => Promise<unknown | null>;

export type EvryRequestAuditRecorder = (input: {
  actor: Awaited<ReturnType<typeof requireEvryPlantViewer>>;
  request: EvryAuditRequest;
  result: EvryRequestAuditResult;
}) => Promise<void>;

const EVRY_REQUEST_CLASSIFIER: unique symbol = Symbol("EvryRequestClassifier");

export type EvryRequestClassifier = ((
  literalUserText: string
) => Promise<EvryPolicyDecision>) &
  Readonly<{ [EVRY_REQUEST_CLASSIFIER]: true }>;

function defineEvryRequestClassifier(
  classify: (literalUserText: string) => Promise<EvryPolicyDecision>
): EvryRequestClassifier {
  return Object.freeze(
    Object.assign(classify, { [EVRY_REQUEST_CLASSIFIER]: true as const })
  );
}

export type EvryRequestPostOptions = Readonly<{
  classify: EvryRequestClassifier;
  continueRead: EvryReadContinuation | null;
  continueAction: EvryRequestActionContinuation | null;
  audit?: EvryRequestAuditRecorder | null;
}>;

/** Bind #769's selected working model to the one policy classifier. */
export function evryRequestClassifierForModel(
  model: LanguageModel
): EvryRequestClassifier {
  return defineEvryRequestClassifier((literalUserText) =>
    classifyEvryRequest({ literalUserText, model })
  );
}

/**
 * Build the authenticated policy-first request surface.
 *
 * Authentication and capability eligibility are not dependencies: callers
 * cannot replace #760's authority adapters. The branded policy classifier is
 * the only model seam, and the two continuation functions are the only seam for
 * the read and plan tracks that follow.
 */
export function createEvryRequestPost({
  classify,
  continueRead,
  continueAction,
  audit = null,
}: EvryRequestPostOptions): (request: Request) => Promise<NextResponse> {
  return async function evryRequestPost(request: Request) {
    let auditContext:
      | Readonly<{
          actor: Awaited<ReturnType<typeof requireEvryPlantViewer>>;
          request: EvryAuditRequest;
        }>
      | undefined;
    let auditAttempted = false;

    try {
      // FIRST, before the body is parsed or sent to a model. The actor is fresh
      // for this request and is the only input capability eligibility accepts.
      const actor = await requireEvryPlantViewer();
      auditContext = { actor, request: mintEvryAuditRequest() };
      const record = async (result: EvryRequestAuditResult) => {
        if (audit === null) return;
        auditAttempted = true;
        await audit({ ...auditContext!, result });
      };

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        await record({
          eventType: "request_refused",
          resultCode: "request_invalid",
        });
        return privateJson({ status: "invalid" }, 400);
      }

      const parsed = evryRequestBodySchema.safeParse(body);
      if (!parsed.success) {
        await record({
          eventType: "request_refused",
          resultCode: "request_invalid",
        });
        return privateJson({ status: "invalid" }, 400);
      }

      // ONE working-model call. `classifyEvryRequest` owns structured output,
      // zero retries, provider storage opt-out, and fixed ambiguity on failure.
      const policy = await classify(parsed.data.requestText);

      if (!("continuation" in policy)) {
        await record({
          eventType: "request_refused",
          resultCode: "policy_refused",
        });
        return privateJson({
          status: "stopped",
          classification: policy.classification,
          artifact: policy.artifact,
        });
      }

      // No capability is eligible until policy has produced one of the two
      // allowed continuations. Reads and plans remain injected until #765/#762.
      const eligibleCapabilities = eligibleEvryCapabilitiesFor(actor);
      const context: EvryRequestContinuationContext = {
        correlationId: auditContext.request.correlationId,
        eligibleCapabilities,
        literalUserText: policy.continuation.literalUserText,
        pageContext: parsed.data.pageContext ?? null,
        planRequestKey: auditContext.request.planRequestKey,
      };
      const continuation =
        policy.classification === "application_read"
          ? continueRead
          : continueAction;
      if (continuation === null) {
        await record({
          eventType: "request_failed",
          resultCode: "request_failed",
        });
        return privateJson({ status: "unavailable" }, 503);
      }

      const artifact = await continuation(context);
      if (artifact === null) {
        await record({
          eventType: "request_failed",
          resultCode: "request_failed",
        });
        return privateJson({ status: "unavailable" }, 503);
      }

      if (policy.classification === "application_read") {
        await record({
          eventType: "request_read_completed",
          resultCode: "read_completed",
        });
      }

      return privateJson({
        status: "continued",
        classification: policy.classification,
        artifact,
      });
    } catch (error) {
      if (audit !== null && auditContext && !auditAttempted) {
        auditAttempted = true;
        await audit({
          ...auditContext,
          result: {
            eventType: "request_failed",
            resultCode: "request_failed",
          },
        });
      }
      if (error instanceof EvryRequestUnavailableError) {
        return privateJson({ status: "unavailable" }, 503);
      }
      const refusal = viewerRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
  };
}

class EvryRequestUnavailableError extends Error {}

const unavailableClassifier = defineEvryRequestClassifier(async () => {
  throw new EvryRequestUnavailableError();
});

/**
 * #769 owns production model selection and will instantiate the factory above.
 * Until then the same auth-first, strict-body surface terminates at an explicit
 * unavailable classifier and exposes no model, capability, read, or plan.
 */
export const POST = createEvryRequestPost({
  classify: unavailableClassifier,
  continueRead: null,
  continueAction: null,
  audit: recordEvryRequestAudit,
});
