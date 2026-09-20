import { defineDynamic, defineTool, type DynamicToolSet } from "eve/tools";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import {
  createBoundEveRegistry,
  describeEveRuntimeTools,
} from "../../src/lib/evry/eve/runtime/registry";
import { eveRuntimeToolSchema } from "../../src/lib/evry/eve/runtime/tool-schemas";
import { withEveRuntimeScope } from "../../src/lib/evry/eve/runtime/scope";
import { captureEveTurnInput } from "../../src/lib/evry/eve/runtime/turn-context";

export default defineDynamic({
  events: {
    async "turn.started"(_event, ctx) {
      await captureEveTurnInput({
        sessionId: ctx.session.id,
        identity: authenticatedSessionOf(ctx.session.auth.current),
        messages: ctx.messages,
      });
      const tools: Record<string, DynamicToolSet[string]> = {};
      for (const entry of describeEveRuntimeTools(
        authenticatedSessionOf(ctx.session.auth.current)
      )) {
        const name = entry.name;
        const key = name.replaceAll(".", "_");
        if (tools[key]) throw new Error("Duplicate provider tool name");
        tools[key] = defineTool({
          description: `${entry.description} Canonical code-mode name: ${entry.name}.`,
          inputSchema: eveRuntimeToolSchema(name),
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
