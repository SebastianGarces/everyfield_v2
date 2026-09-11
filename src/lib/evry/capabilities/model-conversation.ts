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
import type { EvryModelPreparation } from "./model-preparation";
import { createEvryReadBudget, EVRY_READ_BUDGET } from "./read-budget";
import type { EvryReadWorkflow } from "@/lib/evry/recipes/read-workflows";

class EvryReadUnavailable extends Error {}

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
  preparations = [],
  recipes = [],
  clock = Date.now,
  generate = generateEvryModelTurn,
  compose = generateEvryModelResponse,
  authorizeRead = authorizeEvryReadCapability,
}: {
  continuations: readonly EvryCapabilityConversationContinuation[];
  reads: readonly EvryModelRead[];
  preparations?: readonly EvryModelPreparation[];
  recipes?: readonly EvryReadWorkflow[];
  clock?: () => number;
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
    const budget = createEvryReadBudget(clock);
    const eligible = new Set(
      eligibleEvryCapabilitiesFor(input.actor).map(({ identity }) => identity)
    );
    const preparationCatalog = preparations.filter((entry) =>
      entry.capabilityIdentities.every((identity) => eligible.has(identity))
    );
    function structuredPreparation(operation: string, value: unknown) {
      const entry = preparationCatalog.find(({ id }) => id === operation);
      if (!entry || !entry.inputSchema.safeParse(value).success)
        return undefined;
      return {
        identity: `actions.prepare:${operation}`,
        matches: () => false,
        continue: (selection: EvryCapabilityConversationSelectionInput) =>
          entry.run(selection, value),
      } satisfies EvryCapabilityConversationContinuation;
    }
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
      recovering = false,
      preparedInputJson?: string
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
              ...(preparedInputJson === undefined ? {} : { preparedInputJson }),
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
        pending.preparedInputJson === undefined
          ? continuations.find(
              ({ identity }) => identity === pending.capabilityIdentity
            )
          : structuredPreparation(
              pending.capabilityIdentity.replace(/^actions\.prepare:/, ""),
              JSON.parse(pending.preparedInputJson)
            ),
        true
      );
      if (pending.userRequestKey === input.userRequestKey) return current;
    }
    const selection = { ...input, conversation: current };
    const selected = selectPreparation(continuations, selection);

    const catalog = reads.filter((read) =>
      eligible.has(read.capabilityIdentity)
    );
    const recipeCatalog = recipes.filter((recipe) =>
      recipe.readIds.every((id) => catalog.some((read) => read.id === id))
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
        workBudget: budget.remaining(),
      },
      reads: catalog.map((read) => ({
        id: read.id,
        description: read.inputSchema.description?.slice(0, 500),
      })),
      preparations: preparationCatalog.map((entry) => ({
        id: entry.id,
        description: entry.inputSchema.description?.slice(0, 500),
      })),
      recipes: recipeCatalog.map((entry) => ({
        id: entry.id,
        description: entry.description,
        schema: z.toJSONSchema(entry.inputSchema, { unrepresentable: "any" }),
      })),
    };
    let decision = await generate(modelInput);
    const actionIntent =
      decision.kind === "prepare_action" ||
      decision.kind === "prepare" ||
      ((decision.kind === "read" ||
        decision.kind === "recipe" ||
        decision.kind === "describe") &&
        decision.actionIntent === true);
    const requestedContracts = new Map<
      string,
      { kind: "read" | "action"; id: string; schema: unknown }
    >();
    const discoveryLimit = 2;
    let discoveries = 0;
    const freshReadResults: {
      readId: string;
      input: unknown;
      artifact: EvryReadContinuationArtifact;
    }[] = [];
    const planningContext = () => ({
      ...modelInput.context,
      originalRequestCanBePrepared:
        freshReadResults.length === 0 &&
        modelInput.context.originalRequestCanBePrepared,
      actionPreparationAllowed: actionIntent,
      requestedContracts: [...requestedContracts.values()],
      remainingDiscoveryCalls: discoveryLimit - discoveries,
      freshReadResults: freshReadResults.map(({ readId, input, artifact }) => ({
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
      })),
      remainingReads: budget.remaining().calls,
      workBudget: budget.remaining(),
    });
    async function query(readId: string, argumentsValue: unknown) {
      const read = catalog.find(({ id }) => id === readId);
      if (!read) throw new EvryReadUnavailable("Unknown read");
      const parsed = read.inputSchema.safeParse(argumentsValue);
      if (!parsed.success || !budget.claim(read.id, parsed.data))
        throw new EvryReadUnavailable(
          "Read is unavailable, repeated or exceeds the work budget"
        );
      const authorization = await authorizeRead(read.capabilityIdentity);
      if (
        !authorization ||
        authorization.actor.userId !== input.actor.userId ||
        authorization.actor.plantId !== input.actor.plantId
      )
        throw new EvryReadUnavailable("Read authorization unavailable");
      const artifact = await read.run(authorization, selection, argumentsValue);
      if (!artifact) throw new EvryReadUnavailable("Read returned no evidence");
      freshReadResults.push({ readId, input: argumentsValue, artifact });
      budget.record(
        artifact.kind === "read" ? artifact.items.length : 0,
        artifact
      );
      return artifact;
    }
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
    readLoop: for (
      let decisionCount = 0;
      decisionCount <= EVRY_READ_BUDGET.calls + discoveryLimit;
      decisionCount++
    ) {
      switch (decision.kind) {
        case "describe": {
          if (++discoveries > discoveryLimit || budget.exhausted())
            break readLoop;
          const before = requestedContracts.size;
          for (const key of decision.ids) {
            const kind = key.startsWith("read:") ? "read" : "action";
            const id = key.slice(key.indexOf(":") + 1);
            const entry =
              kind === "read"
                ? catalog.find((read) => read.id === id)
                : actionIntent
                  ? preparationCatalog.find((action) => action.id === id)
                  : undefined;
            if (entry)
              requestedContracts.set(key, {
                kind,
                id,
                schema: z.toJSONSchema(entry.inputSchema, {
                  unrepresentable: "any",
                }),
              });
          }
          if (before === requestedContracts.size) break readLoop;
          decision = await generate({
            ...modelInput,
            preparations: actionIntent ? modelInput.preparations : [],
            context: planningContext(),
          });
          continue readLoop;
        }
        case "reply":
          return answer(decision.body);
        case "settings":
          return finish({
            body: decision.body,
            artifacts: [
              { kind: "settings_handoff", sectionId: decision.sectionId },
            ],
          });
        case "recipe": {
          const recipeId = decision.id;
          const recipe = recipeCatalog.find(({ id }) => id === recipeId);
          if (!recipe || !recipe.inputSchema.safeParse(decision.input).success)
            break readLoop;
          try {
            await recipe.run(async (id, args) => {
              if (!recipe.readIds.includes(id))
                throw new EvryReadUnavailable(
                  "Recipe requested an undeclared read"
                );
              return query(id, args);
            }, decision.input);
          } catch (error) {
            if (!(error instanceof EvryReadUnavailable)) throw error;
            return answer(
              "The workflow could only retrieve part of its evidence. Explain the available results and the missing evidence; do not claim full coverage."
            );
          }
          if (decision.continueReading && !budget.exhausted()) {
            decision = await generate({
              ...modelInput,
              preparations: actionIntent ? modelInput.preparations : [],
              context: planningContext(),
            });
            continue readLoop;
          }
          return answer(
            `${recipe.description} Answer from the fresh evidence, distinguish each cohort and explain criteria and limitations.`
          );
        }
        case "read": {
          let artifact: EvryReadContinuationArtifact;
          try {
            artifact = await query(decision.id, decision.input);
          } catch (error) {
            if (!(error instanceof EvryReadUnavailable)) throw error;
            if (freshReadResults.length)
              return answer(
                "The evidence budget was reached or a requested read was unavailable or repeated. Answer from facts already retrieved and name what remains unknown."
              );
            break readLoop;
          }
          if (
            decision.continueReading &&
            artifact.kind === "read" &&
            !budget.exhausted()
          ) {
            decision = await generate({
              ...modelInput,
              context: planningContext(),
              preparations: actionIntent ? modelInput.preparations : [],
            });
            continue readLoop;
          }
          if (artifact.kind === "read")
            return answer(
              decision.continueReading
                ? "The request reached its evidence budget. Explain what the available evidence establishes and any remaining limitations."
                : "Answer the request using the fresh results and their actual selection criteria."
            );
          return finish({
            body: artifact.prompt,
            artifacts: [storedEvryClarificationArtifactDocument(artifact)],
          });
        }
        case "prepare":
          if (freshReadResults.length === 0 && actionIntent && selected)
            return prepare(selection, selected);
          break readLoop;
        case "prepare_action": {
          if (!actionIntent) break readLoop;
          const prepared = structuredPreparation(
            decision.operation,
            decision.input
          );
          const json = JSON.stringify(decision.input);
          if (!prepared || json === undefined || json.length > 16000)
            break readLoop;
          return prepare(selection, prepared, false, json);
        }
      }
    }
    if (freshReadResults.length)
      return answer(
        "A requested next step was unavailable. Explain what the retrieved evidence establishes and what could not be completed. No change was made."
      );
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
