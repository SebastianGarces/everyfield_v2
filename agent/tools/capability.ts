import { defineDynamic, defineTool, type DynamicToolSet } from "eve/tools";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import {
  createBoundEveRegistry,
  describeEveRuntimeTools,
} from "../../src/lib/evry/eve/runtime/registry";
import { withEveRuntimeScope } from "../../src/lib/evry/eve/runtime/scope";

export default defineDynamic({
  events: {
    "turn.started"(_event, ctx) {
      const tools: Record<string, DynamicToolSet[string]> = {};
      for (const entry of describeEveRuntimeTools(
        authenticatedSessionOf(ctx.session.auth.current)
      )) {
        const key = entry.name.replaceAll(".", "_");
        if (tools[key]) throw new Error("Duplicate provider tool name");
        tools[key] = defineTool({
          description: `${entry.description} Canonical code-mode name: ${entry.name}.`,
          inputSchema: entry.inputSchema,
          execute: (input, toolContext) =>
            withEveRuntimeScope(toolContext, (scope) =>
              createBoundEveRegistry(scope).invoke(entry.name, input, {
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
