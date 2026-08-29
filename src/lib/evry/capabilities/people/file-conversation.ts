import type { StoredEvryConversationArtifactDocument } from "@/lib/evry/conversations/artifacts";
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
import {
  composeEvryCapabilityConversationContinuations,
  evryCapabilityConversationResultIdentity,
  hasDurableEvryCapabilityConversationResult,
} from "@/lib/evry/capabilities/conversation";

const recoverOnlyPeopleFileContinuation =
  composeEvryCapabilityConversationContinuations([]);

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
      findByRequestKey?: typeof findEvryConversationRecordByRequestKey;
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
  return resumeEvryConversation({
    actor: input.actor,
    conversationId: loaded.id,
    now: input.now,
    store: input.store,
    revalidatePlan: input.revalidatePlan,
  });
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
 * Persist a staged People file review through the same durable conversation
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
