import { defineDynamic, defineTool, type DynamicToolSet } from "eve/tools";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import {
  createBoundEveRegistry,
  describeEveRuntimeTools,
} from "../../src/lib/evry/eve/runtime/registry";
import { eveRuntimeToolSchema } from "../../src/lib/evry/eve/runtime/tool-schemas";
import { withEveRuntimeScope } from "../../src/lib/evry/eve/runtime/scope";
import { captureEveTurnInput } from "../../src/lib/evry/eve/runtime/turn-context";
import {
  evryLoadedTools,
  evryLoadedPreparations,
} from "../../src/lib/evry/eve/runtime/tool-selection";

export default defineDynamic({
  events: {
    async "turn.started"(_event, ctx) {
      await captureEveTurnInput({
        sessionId: ctx.session.id,
        identity: authenticatedSessionOf(ctx.session.auth.current),
        messages: ctx.messages,
      });
      return null;
    },
    "step.started"(_event, ctx) {
      const catalog = describeEveRuntimeTools(
        authenticatedSessionOf(ctx.session.auth.current)
      );
      const tools: Record<string, DynamicToolSet[string]> = {};
      const selected = new Set(evryLoadedTools.get());
      const preparations = evryLoadedPreparations.get();
      for (const entry of catalog.filter((entry) => selected.has(entry.name))) {
        const name = entry.name;
        // A restored session may predate operation-level selection. It can reload
        // an exact operation through load_tools without exposing the full union.
        if (name === "actions.prepare" && preparations.length === 0) continue;
        const key = name.replaceAll(".", "_");
        if (tools[key]) throw new Error("Duplicate provider tool name");
        tools[key] = defineTool({
          description: `${entry.description} Canonical code-mode name: ${entry.name}.`,
          inputSchema: eveRuntimeToolSchema(name, preparations),
          execute: (input, toolContext) =>
            withEveRuntimeScope(toolContext, (scope) =>
              createBoundEveRegistry(scope).invoke(name, input, {
                signal: toolContext.abortSignal,
                callId: toolContext.callId,
              })
            ),
        });
      }
      return tools;
    },
  },
});
