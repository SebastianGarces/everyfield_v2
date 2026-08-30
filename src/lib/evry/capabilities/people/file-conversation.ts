import type { StoredEvryConversationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { z } from "zod";
import {
  evryConversationIdSchema,
  evryConversationRequestKeySchema,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";
import {
  EvryConversationIdempotencyError,
  findEvryConversationRecordByRequestKey,
} from "@/lib/evry/conversations/repository";
import {
  appendTrustedEvryConversationMessage,
  continueEvryConversation,
  createEvryConversation,
  resumeEvryConversation,
  type EvryConversationStore,
  type EvryResumedConversation,
} from "@/lib/evry/conversations/service";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { findExactEvryActionPlan } from "@/lib/evry/plans/repository";
import {
  composeEvryCapabilityConversationContinuations,
  evryCapabilityConversationResultIdentity,
  hasDurableEvryCapabilityConversationResult,
} from "@/lib/evry/capabilities/conversation";

import { EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH } from "./attachment-contract";

const recoverOnlyPeopleFileContinuation =
  composeEvryCapabilityConversationContinuations([]);

export type EvryPeopleFileReviewIdentity = Readonly<{
  kind: "person_photo" | "people_csv" | "commitment_document";
  digest: string;
}>;

type RecoveredPlanAttachment = EvryPeopleFileReviewIdentity &
  Readonly<{ reference: string }>;

function fileAttachmentFromPlan(
  document: unknown
): RecoveredPlanAttachment | null {
  const parsed = z
    .object({
      steps: z.array(
        z.object({
          capabilityIdentity: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        })
      ),
    })
    .safeParse(document);
  if (!parsed.success || parsed.data.steps.length !== 1) return null;
  const step = parsed.data.steps[0]!;
  if (
    step.capabilityIdentity === "people.crm.people.upload-person-photo" ||
    step.capabilityIdentity === "people.crm.imports.execute-bulk-import"
  ) {
    const attachment = z
      .object({
        attachmentReference: z
          .string()
          .min(1)
          .max(EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH),
        attachmentDigest: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .safeParse(step.arguments);
    return attachment.success
      ? {
          kind:
            step.capabilityIdentity === "people.crm.people.upload-person-photo"
              ? "person_photo"
              : "people_csv",
          digest: attachment.data.attachmentDigest,
          reference: attachment.data.attachmentReference,
        }
      : null;
  }
  if (
    step.capabilityIdentity === "people.crm.assessments.create-commitment" &&
    typeof step.arguments.attachmentJson === "string"
  ) {
    try {
      const attachment = z
        .object({
          reference: z
            .string()
            .min(1)
            .max(EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH),
          digest: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .parse(JSON.parse(step.arguments.attachmentJson));
      return { kind: "commitment_document", ...attachment };
    } catch {
      return null;
    }
  }
  return null;
}

export type EvryPeopleFileReviewInput = Readonly<{
  actor: EvryPlantActor;
  conversationId: string | null;
  requestKey: string;
  userMessage: string;
  now: Date;
  store?: EvryConversationStore;
  revalidatePlan?: Parameters<
    typeof resumeEvryConversation
  >[0]["revalidatePlan"];
}>;

/** Read-only response-loss recovery that runs before staged-file resolution. */
export async function recoverEvryPeopleFileReview(
  input: EvryPeopleFileReviewInput &
    Readonly<{
      expectedAttachment: EvryPeopleFileReviewIdentity;
      findByRequestKey?: typeof findEvryConversationRecordByRequestKey;
      loadPlan?: typeof findExactEvryActionPlan;
    }>
) {
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  const loaded = input.conversationId
    ? input.store
      ? await input.store.find({
          conversationId: input.conversationId,
          actorUserId: input.actor.userId,
          plantId: input.actor.plantId,
        })
      : (
          await resumeEvryConversation({
            actor: input.actor,
            conversationId: input.conversationId,
            now: input.now,
            revalidatePlan: input.revalidatePlan,
          })
        )?.conversation
    : await (input.findByRequestKey ?? findEvryConversationRecordByRequestKey)({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
  if (
    !loaded ||
    !hasDurableEvryCapabilityConversationResult({
      conversation: loaded,
      userRequestKey: requestKey,
    })
  ) {
    return null;
  }
  const userMessage = loaded.messages.find(
    (message) => message.author === "user" && message.requestKey === requestKey
  );
  if (
    !userMessage ||
    userMessage.body !== input.userMessage ||
    userMessage.pageContext !== null
  ) {
    throw new EvryConversationIdempotencyError();
  }
  if (!loaded.activePlan) throw new EvryConversationIdempotencyError();
  const storedPlan = await (input.loadPlan ?? findExactEvryActionPlan)({
    planId: loaded.activePlan.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: loaded.activePlan.fingerprint,
  });
  const attachment = fileAttachmentFromPlan(storedPlan?.document);
  if (
    !attachment ||
    attachment.kind !== input.expectedAttachment.kind ||
    attachment.digest !== input.expectedAttachment.digest
  ) {
    throw new EvryConversationIdempotencyError();
  }
  const resumed = await resumeEvryConversation({
    actor: input.actor,
    conversationId: loaded.id,
    now: input.now,
    store: input.store,
    revalidatePlan: input.revalidatePlan,
  });
  return resumed ? { resumed, attachment } : null;
}

/**
 * Resolve the immutable request-key result before touching the staged file.
 * This is intentionally separate from completion: a response-loss retry must
 * remain available after the temporary attachment has expired or been removed.
 */
export async function beginEvryPeopleFileReview(
  input: EvryPeopleFileReviewInput
) {
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  const resumed = input.conversationId
    ? (
        await continueEvryConversation({
          actor: input.actor,
          conversationId: input.conversationId,
          requestKey,
          message: input.userMessage,
          pageContext: null,
          requestPageContext: null,
          now: input.now,
          continueCapabilityConversation: recoverOnlyPeopleFileContinuation,
          resolveReference: () => ({ status: "not_applicable" }),
          store: input.store,
          revalidatePlan: input.revalidatePlan,
        })
      )?.resumed
    : await createEvryConversation({
        actor: input.actor,
        requestKey,
        message: input.userMessage,
        pageContext: null,
        requestPageContext: null,
        now: input.now,
        continueCapabilityConversation: recoverOnlyPeopleFileContinuation,
        store: input.store,
      });
  if (!resumed) return null;
  return Object.freeze({
    resumed,
    completed: hasDurableEvryCapabilityConversationResult({
      conversation: resumed.conversation,
      userRequestKey: requestKey,
    }),
  });
}

export async function completeEvryPeopleFileReview(
  input: Readonly<{
    actor: EvryPlantActor;
    requestKey: string;
    assistantMessage: string;
    artifacts: readonly StoredEvryConversationArtifactDocument[];
    plan: EvryConversationPlanIdentity;
    now: Date;
    resumed: EvryResumedConversation;
    store?: EvryConversationStore;
    revalidatePlan?: Parameters<
      typeof resumeEvryConversation
    >[0]["revalidatePlan"];
  }>
) {
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: input.resumed.conversation.id,
    userRequestKey: requestKey,
  });
  const stored = await appendTrustedEvryConversationMessage({
    messageId: identity.messageId,
    actor: input.actor,
    conversationId: evryConversationIdSchema.parse(
      input.resumed.conversation.id
    ),
    requestKey: identity.requestKey,
    expectedStateVersion: input.resumed.conversation.stateVersion,
    state: input.resumed.conversation.state,
    author: "assistant",
    body: input.assistantMessage,
    pageContext: null,
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: input.artifacts,
    idempotencyContext: { status: "none" },
    replayReference: null,
    activePlan: { mode: "set", plan: input.plan },
    now: input.now,
    store: input.store,
  });
  return resumeEvryConversation({
    actor: input.actor,
    conversationId: stored.id,
    now: input.now,
    store: input.store,
    revalidatePlan: input.revalidatePlan,
  });
}

/**
 * Persist an inline People file review through the same durable conversation
 * append boundary as ordinary Evry turns. The caller-provided request key owns
 * both the user turn and the derived assistant result, so response-loss retry
 * returns the same conversation and exact plan instead of duplicating either.
 */
export async function persistEvryPeopleFileReview(input: {
  actor: EvryPlantActor;
  conversationId: string | null;
  requestKey: string;
  userMessage: string;
  assistantMessage: string;
  artifacts: readonly StoredEvryConversationArtifactDocument[];
  plan: EvryConversationPlanIdentity;
  now: Date;
  store?: EvryConversationStore;
  revalidatePlan?: Parameters<
    typeof resumeEvryConversation
  >[0]["revalidatePlan"];
}) {
  const begun = await beginEvryPeopleFileReview(input);
  if (!begun) return null;
  if (begun.completed) return begun.resumed;
  return completeEvryPeopleFileReview({
    ...input,
    resumed: begun.resumed,
  });
}
