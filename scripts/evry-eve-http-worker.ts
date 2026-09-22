import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import { mockModel } from "eve/evals";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { neonConfig as sourceNeonConfig } from "@neondatabase/serverless";
import { installIsolatedFixtureHost } from "../src/lib/evry/eve/evals/http/host";
import { createHttpEveEvalRunner } from "../src/lib/evry/eve/evals/http/runner";
import { compiledFixtureRequest } from "../src/lib/evry/eve/evals/http/process-contract";
import { EVE_WORKFLOW_COVERAGE } from "../src/lib/evry/eve/capabilities/catalog";
import { bindFixtureUpload } from "../src/lib/evry/eve/evals/http/attachments";
import {
  fixtureAttachmentReferencesHidden,
  resolveScriptedAttachmentInput,
} from "../src/lib/evry/eve/evals/http/attachment-script";
import {
  assertObservedTask,
  isScriptedCompactionRequest,
  preparationFromObservedTask,
} from "../src/lib/evry/eve/evals/http/task-state-script";

const controller = new AbortController();
let unhandledRejections = 0;
// Nitro logs these itself, but a completed transcript must not hide them from
// evaluation. Retain only a count, never a provider error or message content.
process.on("unhandledRejection", () => {
  unhandledRejections += 1;
});
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
  const failures: string[] = [];
  const eventTypes: string[] = [];
  // Appended by onEvent in client arrival order; sequence is a turn-step
  // identity shared by requested/completed, not a monotonic event index.
  const compactions: Array<{
    type: "compaction.requested" | "compaction.completed";
    turnId: string;
    sequence: number;
  }> = [];
  const scriptedDiagnostics: string[] = [];
  const attachmentBindings: Array<{
    turnIndex: number;
    attachmentId: string;
    digest: string;
    reference: string;
    modelSawBinding: boolean | null;
    rawReferenceHiddenFromModel: boolean | null;
  }> = [];
  let host: ReturnType<typeof installIsolatedFixtureHost> | undefined;
  try {
    const { request, replaySessionId, followupSessionId } = z
      .object({
        type: z.literal("run"),
        request: compiledFixtureRequest,
        replaySessionId: z.string().optional(),
        followupSessionId: z.string().optional(),
      })
      .refine(
        (input) =>
          !input.followupSessionId ||
          (!input.replaySessionId &&
            input.request.model.mode === "scripted" &&
            input.request.turns.length === 1),
        "Saved-session follow-up is a separate single-turn scripted fixture"
      )
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
    // Native source staging/auth uses the source package, not Nitro's external copy.
    // Configure both before bindFixtureUpload dynamically imports any source DB/auth.
    sourceNeonConfig.fetchEndpoint = () => request.proxyUrl;
    sourceNeonConfig.useSecureWebSocket = false;
    phase = "scripted provider configuration";
    let responseIndex = 0;
    let responseFlags: { failStream?: boolean; failGenerate?: boolean } = {};
    const availableTools = new Set<string>();
    const originalRequest =
      typeof request.turns[0] === "string" ? request.turns[0] : undefined;
    const modelRequests: Array<{
      tools: string[];
      inputBytes: number;
      retainedOriginalRequest?: boolean;
      compaction?: boolean;
      observedTask?: {
        draftCallId: string;
        revision: number;
        factKeys: string[];
      };
      toolSchemas?: Array<{
        name: string;
        inputSchema: z.infer<ReturnType<typeof z.json>>;
      }>;
      toolErrors?: Array<{ id: string; name: string; output: unknown }>;
      authoredSkills?: Array<{ name: string; sha256: string }>;
    }> = [];
    const availableSkills = new Set<string>();
    const turnInputs: string[] = [];
    const routingRequests: z.infer<ReturnType<typeof z.json>>[] = [];
    const questionAnswers = new Set<string>();
    const model =
      request.model.mode === "scripted"
        ? mockModel({
            modelId: "isolated-runtime-script",
            respond: (modelRequest) => {
              if (request.model.mode !== "scripted")
                throw new Error("Invalid fixture model");
              const compaction = isScriptedCompactionRequest(modelRequest);
              const response:
                | (typeof request.model.responses)[number]
                | undefined =
                compaction && request.model.compactionSummary !== undefined
                  ? {
                      text: request.model.compactionSummary,
                      usage: { inputTokens: 12_000, outputTokens: 100 },
                    }
                  : request.model.responses[responseIndex++];
              if (!response)
                throw new Error("Scripted model responses exhausted");
              responseFlags = response;
              const taskPreparation =
                "taskPreparation" in response && response.taskPreparation
                  ? preparationFromObservedTask(
                      response.taskPreparation,
                      modelRequest.toolResults
                    )
                  : null;
              const assertedTask = response.assertTaskState
                ? assertObservedTask(
                    response.assertTaskState,
                    modelRequest.toolResults
                  )
                : null;
              for (const binding of attachmentBindings) {
                binding.modelSawBinding =
                  binding.modelSawBinding === true ||
                  modelRequest.messages.some(({ text }) =>
                    text.includes(binding.attachmentId)
                  );
                binding.rawReferenceHiddenFromModel =
                  binding.rawReferenceHiddenFromModel !== false &&
                  fixtureAttachmentReferencesHidden(modelRequest, [
                    binding.reference,
                  ]);
                if (!binding.rawReferenceHiddenFromModel)
                  throw new Error("Fixture attachment disclosure refused");
              }
              modelRequests.push({
                compaction,
                ...(taskPreparation
                  ? { observedTask: taskPreparation.observed }
                  : {}),
                ...(assertedTask
                  ? { observedTask: assertedTask.observed }
                  : {}),
                retainedOriginalRequest:
                  originalRequest !== undefined &&
                  modelRequest.messages.some((message) =>
                    message.text.includes(originalRequest)
                  ),
                tools: modelRequest.tools.map((tool) => tool.name),
                authoredSkills: modelRequest.messages.flatMap((message) =>
                  message.role === "system"
                    ? [
                        ...message.text.matchAll(
                          /<evry-authored-skill name="([a-z0-9-]+)">\n([\s\S]*?)\n<\/evry-authored-skill>/g
                        ),
                      ].map((match) => ({
                        name: match[1],
                        sha256: createHash("sha256")
                          .update(match[2])
                          .digest("hex"),
                      }))
                    : []
                ),
                // Scripted fixtures only: inspect the actual model boundary, including
                // validation errors that Eve deliberately omits from runtime actions.
                toolSchemas: modelRequest.tools.flatMap((tool) =>
                  tool.inputSchema === undefined
                    ? []
                    : [
                        {
                          name: tool.name,
                          inputSchema: z
                            .json()
                            .parse(
                              JSON.parse(JSON.stringify(tool.inputSchema))
                            ),
                        },
                      ]
                ),
                toolErrors: modelRequest.toolResults
                  .filter((result) => result.isError)
                  .map(({ id, name, output }) => ({ id, name, output })),
                inputBytes: Buffer.byteLength(
                  JSON.stringify({
                    messages: modelRequest.messages,
                    tools: modelRequest.tools,
                  })
                ),
              });
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
              return {
                ...response,
                ...(taskPreparation
                  ? { toolCalls: [taskPreparation.toolCall] }
                  : {}),
                ...(response.toolCalls
                  ? {
                      toolCalls: response.toolCalls.map((call) => ({
                        ...call,
                        input: resolveScriptedAttachmentInput(
                          call.input,
                          attachmentBindings.find(
                            (binding) =>
                              binding.turnIndex ===
                              request.attachments?.[0]?.turnIndex
                          )?.attachmentId,
                          modelRequest.messages
                        ),
                      })),
                    }
                  : {}),
                usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
              };
            },
          })
        : undefined;
    if (typeof model === "string")
      throw new Error("Fixture requires a direct model");
    const recordScriptedFailure = (error: unknown): never => {
      scriptedDiagnostics.push(
        error instanceof z.ZodError
          ? error.issues
              .map((issue) => `${issue.code}:${issue.path.join(".")}`)
              .join(";")
          : error instanceof Error
            ? `${error.name}:${error.message.slice(0, 500)}`
            : "unknown scripted failure"
      );
      throw error;
    };
    const scriptedModel = model
      ? wrapLanguageModel({
          model,
          middleware: {
            wrapGenerate: async ({ doGenerate }) => {
              const response = await Promise.resolve(doGenerate()).catch(
                recordScriptedFailure
              );
              if (
                request.model.mode === "scripted" &&
                responseFlags.failGenerate
              )
                throw new Error("EVRY_SCRIPTED_COMPACTION_FAILURE");
              return response;
            },
            wrapStream: async ({ doStream }) => {
              const response = await Promise.resolve(doStream()).catch(
                recordScriptedFailure
              );
              if (
                request.model.mode !== "scripted" ||
                !responseFlags.failStream
              )
                return response;
              return {
                ...response,
                stream: response.stream.pipeThrough(
                  new TransformStream({
                    transform(part, controller) {
                      if (part.type === "text-end")
                        throw new Error("EVRY_SCRIPTED_STREAM_FAILURE");
                      controller.enqueue(part);
                    },
                  })
                ),
              };
            },
          },
        })
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
      ...(request.routing && request.model.mode === "scripted"
        ? {
            routingClient: async (
              routingRequest: import("../src/lib/evry/eve/jev/client").JevRequest
            ) => {
              routingRequests.push(z.json().parse(routingRequest));
              const response = request.routing?.[routingRequests.length - 1];
              if (!response || response.status === "unavailable")
                return (
                  response ?? {
                    status: "unavailable" as const,
                    reason: "not_configured" as const,
                  }
                );
              const probabilities = Object.fromEntries(
                Object.entries(routingRequest.questions).map(
                  ([id, question]) => {
                    const { candidate } = z
                      .object({ candidate: z.object({ name: z.string() }) })
                      .parse(question.instructions);
                    return [id, response.probabilities[candidate.name] ?? 0.1];
                  }
                )
              );
              return {
                status: "available" as const,
                probabilities,
                usage: { inputTokens: 0, outputTokens: 0 },
                durationMs: 0,
              };
            },
          }
        : {}),
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
      expectedTurnFailureMessage: request.expectedTurnFailureMessage,
      replaySessionId,
      followupSessionId,
      async beforeTurn({ turnIndex, sessionId }) {
        const upload = request.attachments?.find(
          (item) => item.turnIndex === turnIndex
        );
        if (!upload) return undefined;
        if (
          attachmentBindings.some((binding) => binding.turnIndex === turnIndex)
        )
          throw new Error("Fixture attachment turn was bound more than once");
        const binding = await bindFixtureUpload({
          upload,
          sessionId,
          sessionToken: request.sessionToken,
          actor: request.actor,
          origin,
          onStage(stage) {
            phase = `attachment ${stage}`;
          },
        });
        phase = "authenticated runtime conversation";
        attachmentBindings.push({
          turnIndex,
          attachmentId: binding.descriptor.attachmentId,
          digest: binding.digest,
          reference: binding.reference,
          modelSawBinding: request.model.mode === "scripted" ? false : null,
          rawReferenceHiddenFromModel:
            request.model.mode === "scripted" ? true : null,
        });
        return {
          attachment: { attachmentId: binding.descriptor.attachmentId },
        };
      },
      onEvent(event) {
        if (
          event.type === "compaction.requested" ||
          event.type === "compaction.completed"
        )
          compactions.push({
            type: event.type,
            turnId: event.data.turnId,
            sequence: event.data.sequence,
          });
        eventTypes.push(event.type);
        if (event.type === "turn.failed")
          failures.push(
            event.data.message === request.expectedTurnFailureMessage
              ? `${event.data.code}:${event.data.message}`
              : event.data.code
          );
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
    if (unhandledRejections > 0)
      throw new Error("Compiled runtime had an unhandled rejection");
    const result = {
      type: "result",
      outcome: {
        ...outcome,
        ...(request.model.mode === "scripted" && request.routing
          ? { routingRequests }
          : {}),
        runtimeProof: {
          availableTools: [...availableTools],
          modelRequests:
            request.model.mode === "scripted"
              ? modelRequests
              : outcome.hostCapture.modelCalls.map((call) => ({
                  tools: call.tools,
                  inputBytes: call.inputBytes,
                })),
          availableSkills: [...availableSkills],
          turnInputs,
          questionAnswers: [...questionAnswers],
          modelCalls: outcome.hostCapture.modelCalls.length,
          failures,
          eventTypes,
          compactions,
          attachments: attachmentBindings.map(
            ({ reference: _reference, ...binding }) => ({
              ...binding,
              rawReferenceHiddenFromOutput: true,
            })
          ),
        },
      },
    };
    if (
      !fixtureAttachmentReferencesHidden(
        result,
        attachmentBindings.map(({ reference }) => reference)
      )
    )
      throw new Error("Fixture attachment disclosure refused");
    process.send?.(result);
  } catch (error) {
    const httpError = z
      .object({ status: z.number().int().min(400).max(599) })
      .safeParse(error);
    const reason =
      error instanceof Error &&
      [
        "Evaluation runtime ended with turn.failed",
        "Compiled runtime had an unhandled rejection",
        "Evaluation runtime ended with session.failed",
        "Evaluation stream ended before a durable turn boundary",
        "Evaluation exceeded its reserved budget",
        "A paused evaluation requires an explicit response, not another message",
        "Fixture response needs exactly one pending question",
        "Fixture attachment disclosure refused",
        "Fixture attachment turn was bound more than once",
        "Scripted attachment binding was not visible to the model",
      ].includes(error.message)
        ? error.message
        : "isolated runtime failure";
    const failure = {
      type: "failed",
      phase: `${phase}: ${reason}; http=${httpError.success ? httpError.data.status : "none"}; events=${eventTypes.slice(-5).join(",")}; failures=${failures.join(",")}; scripted=${scriptedDiagnostics.join(",")}`,
    };
    process.send?.(
      fixtureAttachmentReferencesHidden(
        failure,
        attachmentBindings.map(({ reference }) => reference)
      )
        ? failure
        : { type: "failed", phase: "Fixture attachment disclosure refused" }
    );
  } finally {
    host?.close();
  }
});
