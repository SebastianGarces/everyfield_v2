import { defineDynamic, defineTool, type DynamicToolSet } from "eve/tools";
import { z } from "zod";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import {
  createBoundEveRegistry,
  describeEveRuntimeTools,
} from "../../src/lib/evry/eve/runtime/registry";
import { eveProviderToolSchema } from "../../src/lib/evry/eve/runtime/provider-tool-schema";
import { withEveRuntimeScope } from "../../src/lib/evry/eve/runtime/scope";
import { withSafeEveToolErrors } from "../../src/lib/evry/eve/runtime/tool-errors";
import { captureEveTurnInput } from "../../src/lib/evry/eve/runtime/turn-context";
import { withResultPresentation } from "../../src/lib/evry/eve/runtime/results";
import { latestWorkingSetLoad } from "../../src/lib/evry/eve/runtime/skill-tools";
import {
  evryInitialWorkingSet,
  suggestInitialWorkingSet,
  workingSetCallIds,
} from "../../src/lib/evry/eve/runtime/initial-working-set";
import {
  evryTaskState,
  evryTurnInput,
} from "../../src/lib/evry/eve/runtime/task-state";
import { currentFixtureRun } from "../../src/lib/evry/eve/runtime/fixture-bridge";
import { createJevClient } from "../../src/lib/evry/eve/jev/client";
import { selectedEvePreparationSchema } from "../../src/lib/evry/eve/preparation";
import {
  evryLoadedTools,
  evryLoadedPreparations,
} from "../../src/lib/evry/eve/runtime/tool-selection";

export default defineDynamic({
  events: {
    async "turn.started"(event, ctx) {
      const {
        data: { turnId },
      } = z
        .object({ data: z.object({ turnId: z.string().min(1) }) })
        .parse(event);
      await captureEveTurnInput({
        sessionId: ctx.session.id,
        identity: authenticatedSessionOf(ctx.session.auth.current),
        messages: ctx.messages,
      });
      if (evryInitialWorkingSet.get().turnId === turnId) return null;
      // A completed hook's durable state avoids re-routing that turn and keeps
      // old skill history from overwriting its starting set. A crash inside the
      // hook can repeat the optional request before Eve checkpoints the state.
      evryInitialWorkingSet.update(() => ({
        turnId,
        priorLoadCallIds: workingSetCallIds(ctx.messages),
        skills: [],
      }));
      const fixture = currentFixtureRun();
      const initial = await suggestInitialWorkingSet({
        request: evryTurnInput.get().text,
        taskState: evryTaskState.get(),
        catalog: describeEveRuntimeTools(
          authenticatedSessionOf(ctx.session.auth.current)
        ),
        client: fixture
          ? (fixture.routingClient ?? createJevClient({}))
          : undefined,
        signal: ctx.abortSignal,
      });
      if (initial) {
        if (initial.preparationOperations.length)
          selectedEvePreparationSchema(initial.preparationOperations);
        evryLoadedTools.update(() => initial.names);
        evryLoadedPreparations.update(() => initial.preparationOperations);
        evryInitialWorkingSet.update((state) => ({
          ...state,
          skills: initial.skills,
        }));
      }
      return null;
    },
    "step.started"(_event, ctx) {
      const catalog = describeEveRuntimeTools(
        authenticatedSessionOf(ctx.session.auth.current)
      );
      const tools: Record<string, DynamicToolSet[string]> = {};
      const explicit = latestWorkingSetLoad(
        ctx.messages,
        catalog,
        evryInitialWorkingSet.get().priorLoadCallIds
      );
      if (explicit)
        evryInitialWorkingSet.update((state) => ({ ...state, skills: [] }));
      const workflow = explicit?.selection;
      if (workflow) {
        if (workflow.preparationOperations.length)
          selectedEvePreparationSchema(workflow.preparationOperations);
        evryLoadedTools.update(() => workflow.names);
        evryLoadedPreparations.update(() => workflow.preparationOperations);
      }
      const selected = new Set(evryLoadedTools.get());
      const preparations = evryLoadedPreparations.get();
      for (const entry of catalog.filter((entry) => selected.has(entry.name))) {
        const name = entry.name;
        // Eve persists callback captures as JSON. Capture the canonical name,
        // not the discovery entry containing the executable Zod input schema.
        // A restored session may predate operation-level selection. It can reload
        // an exact operation through load_tools without exposing the full union.
        if (name === "actions.prepare" && preparations.length === 0) continue;
        const key = name.replaceAll(".", "_");
        if (tools[key]) throw new Error("Duplicate provider tool name");
        tools[key] = defineTool({
          description: `${entry.description} Canonical code-mode name: ${entry.name}.`,
          inputSchema: eveProviderToolSchema(name, preparations),
          execute: (input, toolContext) => {
            const execute = () =>
              withEveRuntimeScope(toolContext, async (scope) => {
                const result = await createBoundEveRegistry(scope).invoke(
                  name,
                  input,
                  {
                    signal: toolContext.abortSignal,
                    callId: toolContext.callId,
                  }
                );
                return withResultPresentation(result, scope.turnId, [
                  toolContext.callId,
                ]);
              });
            return withSafeEveToolErrors(toolContext.abortSignal, execute);
          },
          toModelOutput: ({ data }) => ({ type: "json", value: data }),
        });
      }
      return tools;
    },
  },
});
