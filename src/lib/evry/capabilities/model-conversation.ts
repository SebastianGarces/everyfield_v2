import { z } from "zod";
import { compileEvryConversationContext } from "@/lib/evry/conversations/context";
import { evryConversationRequestKeySchema } from "@/lib/evry/conversations/contract";
import { storedEvryClarificationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import {
  authorizeEvryReadCapability,
  eligibleEvryCapabilitiesFor,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryReadContinuationArtifact } from "@/lib/evry/artifacts/types";
import {
  appendEvryCapabilityConversationResult,
  evryCapabilityConversationResultIdentity,
  hasDurableEvryCapabilityConversationResult,
  type EvryCapabilityConversationContinuation,
  type EvryCapabilityConversationRunner,
  type EvryCapabilityConversationResult,
  type EvryCapabilityConversationSelectionInput,
} from "./conversation";
import { generateEvryModelTurn } from "./model-turn";
import { generateEvryModelResponse } from "./model-response";
import { storedEvryResponse } from "./response-parts";

export type EvryModelRead = Readonly<{
  id: string;
  capabilityIdentity: string;
  inputSchema: z.ZodType;
  run(
    authorization: EvryReadCapabilityAuthorization,
    input: EvryCapabilityConversationSelectionInput,
    argumentsValue: unknown
  ): Promise<EvryReadContinuationArtifact | null>;
}>;

function selectPreparation(
  entries: readonly EvryCapabilityConversationContinuation[],
  input: EvryCapabilityConversationSelectionInput
) {
  const direct = entries.filter((entry) => entry.matches(input));
  const matches = direct.length
    ? direct
    : entries.filter((entry) => entry.matchesFollowUp?.(input));
  return matches.length === 1 ? matches[0] : null;
}

/** Visible rows are bounded historical reference hints, never current facts. */
export function evryVisibleReadContext(
  input: EvryCapabilityConversationSelectionInput
) {
  return input.conversation.messages
    .flatMap((message) =>
      message.artifacts.flatMap(({ artifact }) =>
        artifact.kind === "read"
          ? [
              {
                title: artifact.title,
                filters: artifact.filters,
                counts: artifact.counts,
                items: artifact.items.slice(0, 12).map((item) => ({
                  id: item.id,
                  label: item.label.slice(0, 160),
                  facts: item.facts.slice(0, 4).map((fact) => ({
                    label: fact.label.slice(0, 80),
                    value: fact.value.slice(0, 240),
                  })),
                })),
                historicalOnly: true,
              },
            ]
          : []
      )
    )
    .slice(-2);
}

export function createModelEvryConversation({
  continuations,
  reads,
  generate = generateEvryModelTurn,
  compose = generateEvryModelResponse,
  authorizeRead = authorizeEvryReadCapability,
}: {
  continuations: readonly EvryCapabilityConversationContinuation[];
  reads: readonly EvryModelRead[];
  generate?: typeof generateEvryModelTurn;
  compose?: typeof generateEvryModelResponse;
  authorizeRead?: typeof authorizeEvryReadCapability;
}) {
  const run: EvryCapabilityConversationRunner = async (input) => {
    if (
      hasDurableEvryCapabilityConversationResult({
        conversation: input.conversation,
        userRequestKey: input.userRequestKey,
      })
    )
      return input.conversation;
    let current = input.conversation;
    const pending = current.state.pendingModelPreparation;
    const finish = (
      result: EvryCapabilityConversationResult,
      selection = input
    ) =>
      appendEvryCapabilityConversationResult({
        selection: {
          ...selection,
          conversation: {
            ...current,
            state:
              current.state.pendingModelPreparation?.userRequestKey ===
              selection.userRequestKey
                ? { ...current.state, pendingModelPreparation: null }
                : current.state,
          },
        },
        store: input.store,
        identity: evryCapabilityConversationResultIdentity({
          conversationId: current.id,
          userRequestKey: selection.userRequestKey,
        }),
        result,
      });
    async function prepare(
      selection: typeof input,
      selected: EvryCapabilityConversationContinuation | undefined,
      recovering = false
    ) {
      if (!recovering && selected) {
        const identity = evryCapabilityConversationResultIdentity({
          conversationId: current.id,
          userRequestKey: selection.userRequestKey + ":preparation",
        });
        current = await input.store.append({
          messageId: identity.messageId,
          conversationId: current.id,
          actorUserId: input.actor.userId,
          plantId: input.actor.plantId,
          requestKey: identity.requestKey,
          expectedStateVersion: current.stateVersion,
          state: {
            ...current.state,
            pendingModelPreparation: {
              userRequestKey: evryConversationRequestKeySchema.parse(
                selection.userRequestKey
              ),
              capabilityIdentity: selected.identity,
            },
          },
          author: "assistant",
          body: "I'll prepare a review. Nothing will change until you confirm.",
          pageContext: null,
          requestPageContext: null,
          relevanceKeys: [],
          deliveryStatus: "complete",
          artifacts: [],
          idempotencyContext: { status: "none" },
          replayReference: null,
          activePlan: { mode: "preserve" },
          createdAt: selection.now,
          knownConversation: current,
        });
      }
      // Exact original bytes reach the date, recipient and literal-field resolvers.
      const result = await selected?.continue({
        ...selection,
        // The checkpoint is state, not a conversational answer to a clarification.
        conversation: { ...current, messages: selection.conversation.messages },
      });
      if (result) return finish(result, selection);
      const unavailable = await generate({
        reads: [],
        context: { latestRequest: selection.literalUserText },
        feedback:
          "This previously allowed request could not produce a review. No effects were executed. Explain the limitation briefly and offer the relevant application screen. Return only a reply with no operation.",
      });
      if (unavailable.kind !== "reply")
        throw new Error("Evry unavailable response attempted an operation");
      return finish({ body: unavailable.body, artifacts: [] }, selection);
    }
    if (pending) {
      const original = current.messages.find(
        (message) =>
          message.author === "user" &&
          message.requestKey === pending.userRequestKey
      );
      if (!original) throw new Error("The saved Evry request is unavailable");
      const selection = {
        ...input,
        userRequestKey: original.requestKey,
        literalUserText: original.body,
        now: original.createdAt,
        pageContext: original.pageContext,
        requestPageContext: original.requestPageContext ?? null,
        conversation: {
          ...current,
          messages: current.messages.filter(
            ({ sequence }) => sequence <= original.sequence
          ),
        },
      };
      current = await prepare(
        selection,
        continuations.find(
          ({ identity }) => identity === pending.capabilityIdentity
        ),
        true
      );
      if (pending.userRequestKey === input.userRequestKey) return current;
    }
    const selection = { ...input, conversation: current };
    const selected = selectPreparation(continuations, selection);

    const eligible = new Set(
      eligibleEvryCapabilitiesFor(input.actor).map(({ identity }) => identity)
    );
    const catalog = reads.filter((read) =>
      eligible.has(read.capabilityIdentity)
    );
    const historicalConfirmation = current.messages
      .flatMap(({ artifacts }) => artifacts)
      .findLast(
        ({ artifact }) =>
          artifact.kind === "confirmation" &&
          artifact.plan.planId === current.activePlan?.planId
      )?.artifact;
    const modelInput = {
      context: {
        latestRequest: input.literalUserText,
        conversation: compileEvryConversationContext({
          conversation: current,
          activePlan: null,
        }),
        historicalPendingPlan: current.activePlan
          ? {
              identity: current.activePlan,
              historicalOnly: true,
              currentStatus: "not_revalidated",
              ...(historicalConfirmation?.kind === "confirmation"
                ? {
                    title: historicalConfirmation.title,
                    actionLabel: historicalConfirmation.actionLabel,
                    consequences: historicalConfirmation.consequences.slice(
                      0,
                      2
                    ),
                  }
                : {}),
            }
          : null,
        visibleReadResults: evryVisibleReadContext(selection),
        pageContext: input.pageContext,
        originalRequestCanBePrepared: selected !== null,
      },
      reads: catalog.map((read) => ({
        id: read.id,
        schema: z.toJSONSchema(read.inputSchema, { unrepresentable: "any" }),
      })),
    };
    let decision = await generate(modelInput);
    const freshReadResults: {
      readId: string;
      input: unknown;
      artifact: EvryReadContinuationArtifact;
    }[] = [];
    const answer = async (draft: string) =>
      finish(
        storedEvryResponse(
          await compose({
            context: {
              ...modelInput.context,
              freshReadResults: freshReadResults.map(
                ({ readId, input, artifact }) => ({
                  readId,
                  input,
                  artifact:
                    artifact.kind === "read"
                      ? {
                          ...artifact,
                          items: artifact.items.slice(0, 25).map((item) => ({
                            ...item,
                            facts: item.facts.slice(0, 8).map((fact) => ({
                              label: fact.label,
                              value: fact.value.slice(0, 500),
                            })),
                          })),
                          explanationSampleIsPartial:
                            artifact.items.length > 25 ||
                            artifact.items.some(
                              (item) =>
                                item.facts.length > 8 ||
                                item.facts.some(
                                  (fact) => fact.value.length > 500
                                )
                            ),
                        }
                      : artifact,
                })
              ),
            },
            draft,
            results: freshReadResults.flatMap(({ artifact }) =>
              artifact.kind === "read" ? [artifact] : []
            ),
            onPreview: input.reportResponse,
          })
        )
      );
    readLoop: for (let readCount = 0; readCount < 4; readCount++) {
      switch (decision.kind) {
        case "reply":
          return answer(decision.body);
        case "settings":
          return finish({
            body: decision.body,
            artifacts: [
              { kind: "settings_handoff", sectionId: decision.sectionId },
            ],
          });
        case "read": {
          const readId = decision.id;
          const read = catalog.find(({ id }) => id === readId);
          if (!read || !read.inputSchema.safeParse(decision.input).success)
            break readLoop;
          const authorization = await authorizeRead(read.capabilityIdentity);
          if (
            !authorization ||
            authorization.actor.userId !== input.actor.userId ||
            authorization.actor.plantId !== input.actor.plantId
          )
            break readLoop;
          const artifact = await read.run(
            authorization,
            selection,
            decision.input
          );
          if (!artifact) break readLoop;
          freshReadResults.push({
            readId: read.id,
            input: decision.input,
            artifact,
          });
          if (
            decision.continueReading &&
            artifact.kind === "read" &&
            readCount < 3
          ) {
            decision = await generate({
              ...modelInput,
              context: {
                ...modelInput.context,
                originalRequestCanBePrepared: false,
                freshReadResults: freshReadResults.map(
                  ({ readId, input, artifact }) => ({
                    readId,
                    input,
                    ...(artifact.kind === "read"
                      ? {
                          title: artifact.title,
                          counts: artifact.counts,
                          filters: artifact.filters,
                          items: artifact.items.slice(0, 25),
                          truncated: artifact.items.length > 25,
                        }
                      : { clarification: artifact.prompt }),
                  })
                ),
                remainingReads: 3 - readCount,
              },
            });
            continue readLoop;
          }
          if (artifact.kind === "read")
            return answer(
              decision.continueReading
                ? "The request reached its four-read budget. Explain what the available evidence establishes and any remaining limitations."
                : "Answer the request using the fresh results and their actual selection criteria."
            );
          return finish({
            body: artifact.prompt,
            artifacts: [storedEvryClarificationArtifactDocument(artifact)],
          });
        }
        case "prepare":
          if (readCount === 0 && selected) return prepare(selection, selected);
          break readLoop;
      }
    }
    const clarification = await generate({
      ...modelInput,
      feedback:
        "The selected operation is unavailable or could not be resolved. No result was returned and no effect was executed. Ask a helpful question or explain the limitation. Return a reply only: readId, readInputJson and settingsSectionId null, prepareOriginalRequest false. Never claim success.",
    });
    if (clarification.kind !== "reply")
      throw new Error("Evry clarification attempted another operation");
    return finish({ body: clarification.body, artifacts: [] });
  };
  return Object.assign(run, { matchesBeforeReferences: () => true });
}
