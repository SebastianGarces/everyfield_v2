import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import { mockModel } from "eve/evals";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { installIsolatedFixtureHost } from "../src/lib/evry/eve/evals/http/host";
import { createHttpEveEvalRunner } from "../src/lib/evry/eve/evals/http/runner";
import { compiledFixtureRequest } from "../src/lib/evry/eve/evals/http/process-contract";
import { EVE_WORKFLOW_COVERAGE } from "../src/lib/evry/eve/capabilities/catalog";

const controller = new AbortController();
let used = false;
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Port unavailable");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}
process.on("message", async (message) => {
  if (z.object({ type: z.literal("cancel") }).safeParse(message).success) {
    controller.abort();
    return;
  }
  if (used) return;
  used = true;
  let phase = "configuration";
  let host: ReturnType<typeof installIsolatedFixtureHost> | undefined;
  try {
    const { request } = z
      .object({ type: z.literal("run"), request: compiledFixtureRequest })
      .parse(message);
    phase = "compiled entry lookup";
    await access(request.compiledEntry);
    phase = "loopback port allocation";
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    process.env.NITRO_PORT = String(port);
    process.env.NITRO_HOST = "127.0.0.1";
    const proxy = new URL(request.proxyUrl);
    if (
      proxy.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(proxy.hostname)
    )
      throw new Error("Proxy must be isolated");
    // Configure the exact external Neon module used by the compiled artifact.
    phase = "Neon fixture proxy configuration";
    const neonPath = join(
      dirname(request.compiledEntry),
      "node_modules/@neondatabase/serverless/index.mjs"
    );
    const neon = await import(pathToFileURL(neonPath).href);
    neon.neonConfig.fetchEndpoint = () => request.proxyUrl;
    neon.neonConfig.useSecureWebSocket = false;
    phase = "scripted provider configuration";
    let responseIndex = 0;
    const availableTools = new Set<string>();
    const availableSkills = new Set<string>();
    const turnInputs: string[] = [];
    const questionAnswers = new Set<string>();
    const failures: string[] = [];
    const eventTypes: string[] = [];
    const model =
      request.model.mode === "scripted"
        ? mockModel({
            modelId: "isolated-runtime-script",
            respond: (modelRequest) => {
              for (const tool of modelRequest.tools)
                availableTools.add(tool.name);
              for (const result of modelRequest.toolResults) {
                if (result.name !== "ask_question" || result.isError) continue;
                const answer = z
                  .object({ status: z.literal("answered"), text: z.string() })
                  .safeParse(result.output);
                if (answer.success) questionAnswers.add(answer.data.text);
              }
              const systemText = modelRequest.messages
                .filter((message) => message.role === "system")
                .map((message) => message.text)
                .join("\n");
              for (const skill of EVE_WORKFLOW_COVERAGE) {
                if (systemText.includes(skill.name))
                  availableSkills.add(skill.name);
              }
              if (request.model.mode !== "scripted")
                throw new Error("Invalid fixture model");
              const response = request.model.responses[responseIndex++];
              if (!response)
                throw new Error("Scripted model responses exhausted");
              return {
                ...response,
                usage: { inputTokens: 0, outputTokens: 0 },
              };
            },
          })
        : undefined;
    if (typeof model === "string")
      throw new Error("Fixture requires a direct model");
    const scriptedModel = model
      ? wrapLanguageModel({ model, middleware: [] })
      : undefined;
    phase = "isolated host configuration";
    host = installIsolatedFixtureHost({
      origin,
      databaseUrl: request.databaseUrl,
      onTurnInput: (text) => turnInputs.push(text),
      ...(request.model.mode === "live"
        ? { allowPaidProviderCalls: true }
        : {}),
      ...(scriptedModel ? { scriptedModel } : {}),
    });
    phase = "compiled runtime startup";
    await import(pathToFileURL(request.compiledEntry).href);
    for (let attempt = 0; attempt < 100; attempt++) {
      controller.signal.throwIfAborted();
      try {
        const health = await fetch(`${origin}/eve/v1/health`);
        if (health.ok || health.status === 401) break;
      } catch {
        /* Server socket is still starting. */
      }
      if (attempt === 99) throw new Error("Runtime did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    phase = "authenticated runtime conversation";
    const run = createHttpEveEvalRunner({
      origin,
      databaseUrl: request.databaseUrl,
      host,
      prices: request.prices,
      timeoutMs: request.timeoutMs,
      verifyReplay: request.verifyReplay,
      onEvent(event) {
        eventTypes.push(event.type);
        if (event.type === "action.result" && event.data.status !== "completed")
          failures.push(
            `${event.data.result.kind}:${event.data.error?.code ?? event.data.status}`
          );
      },
    });
    const outcome = await run({
      scenario: { turns: request.turns },
      actor: request.actor,
      sessionToken: request.sessionToken,
      now: new Date(request.now),
      signal: controller.signal,
      maxCostUsd: request.maxCostUsd,
    });
    process.send?.({
      type: "result",
      outcome: {
        ...outcome,
        runtimeProof: {
          availableTools: [...availableTools],
          availableSkills: [...availableSkills],
          turnInputs,
          questionAnswers: [...questionAnswers],
          modelCalls: responseIndex,
          failures,
          eventTypes,
        },
      },
    });
  } catch {
    process.send?.({ type: "failed", phase });
  } finally {
    host?.close();
  }
});
