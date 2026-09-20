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
import { isDeepStrictEqual } from "node:util";

type FixtureHost = ReturnType<typeof installIsolatedFixtureHost>;
export type HttpEvalOutcome = {
  answer: string;
  latency: {
    acknowledgementMs: number;
    firstTextMs: number | null;
    totalMs: number;
  };
  clarificationCount: number;
  judge: null;
  costUsd: number;
  hostCapture: HostCapture;
  eveSessionId: string;
  messages: ReturnType<typeof fixtureTranscript>;
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

/** Uses the production cookie-authenticated protocol, never /info or a replacement tool loop. */
export function createHttpEveEvalRunner(config: {
  origin: string;
  databaseUrl: string;
  host: FixtureHost;
  prices: EvalPriceCeiling;
  timeoutMs?: number;
  verifyReplay?: boolean;
  /** Fixture-only restart path: attach and read, never create or submit. */
  replaySessionId?: string;
  onEvent?: (event: MessageStreamEvent) => void;
}) {
  assertIsolatedFixtureTarget(config.origin, config.databaseUrl);
  const origin = new URL(config.origin).origin;
  return async (input: {
    scenario: { turns: readonly (string | { respond: string })[] };
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
    let clarificationCount = 0;
    const messages: string[] = [];
    const events: MessageStreamEvent[] = [];
    let pendingQuestions: readonly InputRequest[] = [];
    try {
      // Allocate the stable identity before any model work so cancellation never loses the target.
      if (config.replaySessionId) {
        session = client.sessions.attach(config.replaySessionId);
        const restored = await session.snapshot({ signal });
        events.push(...restored.events);
      } else {
        ({ session } = await client.sessions.create({ signal }));
      }
      for (const [index, turn] of (config.replaySessionId
        ? []
        : input.scenario.turns
      ).entries()) {
        signal.throwIfAborted();
        if (typeof turn !== "string" && pendingQuestions.length !== 1)
          throw new Error(
            "Fixture response needs exactly one pending question"
          );
        const options = {
          signal,
          streamReconnectPolicy: { reconnect: false as const },
        };
        const response =
          typeof turn === "string"
            ? await session.send(turn, options)
            : await session.respond(
                [
                  {
                    requestId: pendingQuestions[0]!.requestId,
                    text: turn.respond,
                  },
                ],
                options
              );
        if (index === 0) acknowledgementMs = performance.now() - started;
        let ended = false;
        for await (const event of response) {
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
            messages.push(event.data.message);
          }
          if (event.type === "input.requested") {
            clarificationCount++;
            pendingQuestions = event.data.requests.filter(
              (request) => request.kind === "question"
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
            event.type === "turn.failed" ||
            event.type === "session.failed" ||
            event.type === "turn.cancelled"
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
      const hostCapture = fixture.snapshot();
      if (hostCapture.costUsd > input.maxCostUsd)
        throw new Error("Evaluation exceeded its reserved budget");
      const transcript = fixtureTranscript(
        new EveAgentStore({
          reducer: defaultMessageReducer(),
          initialEvents: events,
        }).snapshot.data.messages
      );
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
        ...(replay ? { replay } : {}),
        answer: messages.join("\n\n"),
        latency: {
          acknowledgementMs,
          firstTextMs,
          totalMs: performance.now() - started,
        },
        clarificationCount,
        judge: null,
        costUsd: hostCapture.costUsd,
        hostCapture,
        eveSessionId: session.state.sessionId,
      };
    } catch (error) {
      cancel();
      await cancellation;
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      fixture.dispose();
    }
  };
}
