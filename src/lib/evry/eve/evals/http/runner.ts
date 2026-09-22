import {
  Client,
  type ClientSession,
  type MessageStreamEvent,
  type InputRequest,
  defaultMessageReducer,
  EveAgentStore,
} from "eve/client";
import {
  assertIsolatedFixtureTarget,
  type EvalPriceCeiling,
  type HostCapture,
  type installIsolatedFixtureHost,
} from "./host";
import { fixtureTranscript } from "./transcript";
import { observeClarifications } from "./clarifications";
import { splitEveResponse } from "../../presentation";
import type { Observation } from "../contract";
import type { FixtureTurn } from "./process-contract";
import type { EveJsonValue } from "../../capabilities/registry";
import { isDeepStrictEqual } from "node:util";
import {
  fixtureFailureDiagnostic,
  type FixtureFailureDiagnostic,
} from "./failure-diagnostic";
import {
  projectEveMessage,
  selectedEveResultReferences,
} from "@/components/evry/eve-message-projection";

type FixtureHost = ReturnType<typeof installIsolatedFixtureHost>;

/** Record visible questions as answers without repeating identical prose in the same message. */
export function projectHttpEvalAnswer(
  messages: ReturnType<typeof fixtureTranscript>
): string {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => {
      const parts = projectEveMessage(message);
      const prose = new Set(
        parts.flatMap((part) =>
          part.kind === "text" ? [part.text.trim()] : []
        )
      );
      return parts.flatMap((part) => {
        if (part.kind === "text") return [part.text.trim()];
        if (part.kind === "question" && !prose.has(part.prompt.trim()))
          return [part.prompt.trim()];
        return [];
      });
    })
    .filter(Boolean)
    .join("\n\n");
}

export type HttpEvalOutcome = {
  answer: string;
  latency: {
    acknowledgementMs: number;
    firstTextMs: number | null;
    firstInteractionMs?: number | null;
    totalMs: number;
  };
  clarificationCount: number;
  clarificationMeasurement: Observation["clarificationMeasurement"];
  judge: null;
  costUsd: number;
  hostCapture: HostCapture;
  eveSessionId: string;
  messages: ReturnType<typeof fixtureTranscript>;
  followupRestore?: {
    messages: ReturnType<typeof fixtureTranscript>;
    generations: number;
    invocations: number;
    capturedCalls: number;
  };
  replay?: {
    matchingTranscript: boolean;
    stableActivity: boolean;
    stableCapture: boolean;
    snapshots: number;
    eventCount: number;
    generationsBefore: number;
    generationsAfter: number;
    invocationsBefore: number;
    invocationsAfter: number;
  };
};

/** Receipt time of visible text or a question the chat can actually answer. */
export function createFirstInteractionObserver() {
  let firstInteractionMs: number | null = null;
  const textByStep = new Map<string, string>();
  return {
    get firstInteractionMs() {
      return firstInteractionMs;
    },
    receive(event: MessageStreamEvent, elapsedMs: number) {
      if (firstInteractionMs !== null) return;
      if (
        event.type === "input.requested" &&
        event.data.requests.some(
          (request) => request.kind === "question" && request.prompt.trim()
        )
      ) {
        firstInteractionMs = elapsedMs;
      } else if (
        event.type === "message.appended" ||
        event.type === "message.completed"
      ) {
        const key = JSON.stringify([event.data.turnId, event.data.stepIndex]);
        const complete = event.type === "message.completed";
        const text =
          event.type === "message.appended"
            ? (textByStep.get(key) ?? "") + event.data.messageDelta
            : (event.data.message ?? "");
        textByStep.set(key, text);
        if (
          splitEveResponse(text, complete).some(
            (part) => part.kind === "text" && part.text.trim()
          )
        )
          firstInteractionMs = elapsedMs;
      }
    },
  };
}

/** Uses the production cookie-authenticated protocol, never /info or a replacement tool loop. */
export function createHttpEveEvalRunner(config: {
  origin: string;
  databaseUrl: string;
  host: FixtureHost;
  prices: EvalPriceCeiling;
  timeoutMs?: number;
  verifyReplay?: boolean;
  expectedTurnFailureMessage?:
    | "EVRY_PROCESSING_LIMIT_REACHED"
    | "EVRY_SCRIPTED_STREAM_FAILURE"
    | "EVRY_SCRIPTED_COMPACTION_FAILURE";
  /** Fixture-only restart path: attach and read, never create or submit. */
  replaySessionId?: string;
  /** Separate fixture path: restore first, then submit the scripted follow-up. */
  followupSessionId?: string;
  /** Isolated native-upload setup; returns only the normal model-safe client context. */
  beforeTurn?(input: {
    turnIndex: number;
    sessionId: string;
  }): Promise<Record<string, EveJsonValue> | undefined>;
  onEvent?: (event: MessageStreamEvent) => void;
  onFailure?: (diagnostic: FixtureFailureDiagnostic) => void;
}) {
  assertIsolatedFixtureTarget(config.origin, config.databaseUrl);
  if (config.replaySessionId && config.followupSessionId)
    throw new Error("Replay and follow-up cannot share one fixture run");
  const origin = new URL(config.origin).origin;
  return async (input: {
    scenario: {
      turns: readonly FixtureTurn[];
    };
    actor: { userId: string; plantId: string };
    sessionToken: string;
    now: Date;
    signal: AbortSignal;
    maxCostUsd: number;
  }): Promise<HttpEvalOutcome> => {
    input.signal.throwIfAborted();
    if (!input.scenario.turns.length)
      throw new Error("Evaluation needs at least one turn");
    const fixture = config.host.register({
      ...input.actor,
      sessionToken: input.sessionToken,
      now: input.now,
      maxCostUsd: input.maxCostUsd,
      prices: config.prices,
    });
    const clientOptions = {
      host: origin,
      redirect: "error" as const,
      headers: {
        cookie: `session=${encodeURIComponent(input.sessionToken)}`,
        origin,
        "sec-fetch-site": "same-origin",
      },
    };
    const client = new Client(clientOptions);
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(config.timeoutMs ?? 120_000),
    ]);
    let session: ClientSession | undefined;
    let cancellation: Promise<unknown> | undefined;
    const cancel = () => {
      fixture.stop();
      if (session && !cancellation)
        cancellation = session
          .cancel({ signal: AbortSignal.timeout(5_000) })
          .catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    const started = performance.now();
    let acknowledgementMs = 0;
    let firstTextMs: number | null = null;
    const interaction = createFirstInteractionObserver();
    const events: MessageStreamEvent[] = [];
    let pendingQuestions: readonly InputRequest[] = [];
    let followupRestore: HttpEvalOutcome["followupRestore"];
    try {
      // Allocate the stable identity before any model work so cancellation never loses the target.
      const existingSessionId =
        config.replaySessionId ?? config.followupSessionId;
      const historicalReferences = new Set<string>();
      if (existingSessionId) {
        session = client.sessions.attach(existingSessionId);
        const restored = await session.snapshot({ signal });
        events.push(...restored.events);
        // The replacement host journal owns only new calls. Restored native
        // envelopes remain in the transcript but cannot become new evidence.
        if (config.followupSessionId) {
          session = client.sessions.attach(existingSessionId, {
            streamIndex: restored.session.streamIndex,
          });
          const historical = fixtureTranscript(
            new EveAgentStore({
              reducer: defaultMessageReducer(),
              initialEvents: restored.events,
            }).snapshot.data.messages
          );
          const activity = fixture.activity();
          followupRestore = {
            messages: historical,
            generations: activity.generations,
            invocations: activity.invocations,
            capturedCalls: fixture.snapshot().calls.length,
          };
          for (const message of historical)
            for (const reference of selectedEveResultReferences(message))
              historicalReferences.add(reference);
        }
      } else {
        ({ session } = await client.sessions.create({ signal }));
      }
      for (const [index, scriptedTurn] of (config.replaySessionId
        ? []
        : input.scenario.turns
      ).entries()) {
        signal.throwIfAborted();
        let turn: Exclude<FixtureTurn, { respondIfAsked: string }>;
        if (
          typeof scriptedTurn !== "string" &&
          "respondIfAsked" in scriptedTurn
        ) {
          // Skip before beforeTurn: an unused reply must not stage a file or
          // create a new user turn after an already complete answer.
          if (pendingQuestions.length === 0) continue;
          if (
            pendingQuestions.length !== 1 ||
            pendingQuestions[0]?.kind !== "question"
          )
            throw new Error(
              "Optional fixture reply needs exactly one native pending question"
            );
          turn = { respond: scriptedTurn.respondIfAsked };
        } else turn = scriptedTurn;
        const questionReply =
          typeof turn === "string" &&
          pendingQuestions.length === 1 &&
          pendingQuestions[0]?.kind === "question";
        if (
          typeof turn === "string" &&
          pendingQuestions.length &&
          !questionReply
        )
          throw new Error(
            "A paused evaluation requires an explicit response, not another message"
          );
        if (typeof turn !== "string" && pendingQuestions.length !== 1)
          throw new Error(
            "Fixture response needs exactly one pending question"
          );
        const explicitUsageStop =
          typeof turn !== "string" &&
          "optionId" in turn &&
          turn.optionId === "stop" &&
          pendingQuestions[0]?.kind === "session-limit";
        const options = {
          signal,
          streamReconnectPolicy: { reconnect: false as const },
          clientContext: await config.beforeTurn?.({
            turnIndex: index,
            sessionId: session.state.sessionId,
          }),
        };
        const response =
          typeof turn === "string" &&
          (!questionReply || options.clientContext?.attachment)
            ? await session.send(turn, options)
            : await session.respond(
                [
                  {
                    requestId: pendingQuestions[0]!.requestId,
                    ...(typeof turn === "string"
                      ? { text: turn }
                      : "optionId" in turn
                        ? { optionId: turn.optionId }
                        : { text: turn.respond }),
                  },
                ],
                options
              );
        if (index === 0) acknowledgementMs = performance.now() - started;
        let ended = false;
        for await (const event of response) {
          interaction.receive(event, performance.now() - started);
          events.push(event);
          config.onEvent?.(event);
          if (
            event.type === "message.appended" &&
            event.data.messageDelta &&
            firstTextMs === null
          )
            firstTextMs = performance.now() - started;
          if (event.type === "message.completed" && event.data.message) {
            if (firstTextMs === null) firstTextMs = performance.now() - started;
          }
          if (event.type === "input.requested") {
            pendingQuestions = event.data.requests.filter(
              (request) =>
                request.kind === "question" || request.kind === "session-limit"
            );
          }
          if (event.type === "input.resolved") {
            const resolved = new Set(
              event.data.resolutions.map((resolution) => resolution.requestId)
            );
            pendingQuestions = pendingQuestions.filter(
              (request) => !resolved.has(request.requestId)
            );
          }
          if (
            (event.type === "turn.failed" &&
              !(
                config.expectedTurnFailureMessage &&
                [
                  "MODEL_CALL_FAILED",
                  "EVENT_HANDLER_FAILED",
                  "COMPACTION_FAILED",
                ].includes(event.data.code) &&
                event.data.message === config.expectedTurnFailureMessage
              )) ||
            event.type === "session.failed" ||
            (event.type === "turn.cancelled" && !explicitUsageStop)
          )
            throw new Error(`Evaluation runtime ended with ${event.type}`);
          if (
            event.type === "session.waiting" ||
            event.type === "session.completed"
          )
            ended = true;
        }
        signal.throwIfAborted();
        if (!ended)
          throw new Error(
            "Evaluation stream ended before a durable turn boundary"
          );
      }
      const transcript = fixtureTranscript(
        new EveAgentStore({
          reducer: defaultMessageReducer(),
          initialEvents: events,
        }).snapshot.data.messages
      );
      // Selection comes from the same trusted native envelopes rendered in chat.
      // The private host journal independently rejects any unobserved reference.
      if (!config.replaySessionId)
        for (const message of transcript)
          for (const reference of selectedEveResultReferences(message))
            if (!historicalReferences.has(reference))
              fixture.present(reference);
      const hostCapture = fixture.snapshot();
      if (hostCapture.costUsd > input.maxCostUsd)
        throw new Error("Evaluation exceeded its reserved budget");
      let replay: HttpEvalOutcome["replay"];
      if (config.verifyReplay || config.replaySessionId) {
        const before = fixture.activity();
        const fresh = new Client(clientOptions).sessions.attach(
          session.state.sessionId
        );
        let matchingTranscript = true;
        let eventCount = 0;
        for (let index = 0; index < 2; index++) {
          const snapshot = await fresh.snapshot({ signal });
          const restored = fixtureTranscript(
            new EveAgentStore({
              reducer: defaultMessageReducer(),
              initialEvents: snapshot.events,
            }).snapshot.data.messages
          );
          matchingTranscript &&= isDeepStrictEqual(restored, transcript);
          eventCount = snapshot.events.length;
        }
        const after = fixture.activity();
        replay = {
          matchingTranscript,
          stableActivity: isDeepStrictEqual(before, after),
          stableCapture: isDeepStrictEqual(hostCapture, fixture.snapshot()),
          snapshots: 2,
          eventCount,
          generationsBefore: before.generations,
          generationsAfter: after.generations,
          invocationsBefore: before.invocations,
          invocationsAfter: after.invocations,
        };
      }
      return {
        messages: transcript,
        ...(followupRestore ? { followupRestore } : {}),
        ...(replay ? { replay } : {}),
        answer: projectHttpEvalAnswer(transcript),
        latency: {
          acknowledgementMs,
          firstTextMs,
          firstInteractionMs: interaction.firstInteractionMs,
          totalMs: performance.now() - started,
        },
        ...observeClarifications(transcript),
        judge: null,
        costUsd: hostCapture.costUsd,
        hostCapture,
        eveSessionId: session.state.sessionId,
      };
    } catch (error) {
      // Observe the failure before cancellation cleanup can cross the deadline.
      const diagnostic = fixtureFailureDiagnostic({
        signal,
        elapsedMs: performance.now() - started,
        capture: fixture.snapshot(),
      });
      cancel();
      await cancellation;
      config.onFailure?.(diagnostic);
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      fixture.dispose();
    }
  };
}
