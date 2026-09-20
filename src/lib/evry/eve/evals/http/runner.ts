import {
  Client,
  type ClientSession,
  type MessageStreamEvent,
} from "eve/client";
import {
  assertIsolatedFixtureTarget,
  type EvalPriceCeiling,
  type HostCapture,
  type installIsolatedFixtureHost,
} from "./host";

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
};

/** Uses the production cookie-authenticated protocol, never /info or a replacement tool loop. */
export function createHttpEveEvalRunner(config: {
  origin: string;
  databaseUrl: string;
  host: FixtureHost;
  prices: EvalPriceCeiling;
  timeoutMs?: number;
  onEvent?: (event: MessageStreamEvent) => void;
}) {
  assertIsolatedFixtureTarget(config.origin, config.databaseUrl);
  const origin = new URL(config.origin).origin;
  return async (input: {
    scenario: { turns: readonly string[] };
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
    const client = new Client({
      host: origin,
      redirect: "error",
      headers: {
        cookie: `session=${encodeURIComponent(input.sessionToken)}`,
        origin,
        "sec-fetch-site": "same-origin",
      },
    });
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
    try {
      // Allocate the stable identity before any model work so cancellation never loses the target.
      ({ session } = await client.sessions.create({ signal }));
      for (const [index, text] of input.scenario.turns.entries()) {
        signal.throwIfAborted();
        const response = await session.send(text, {
          signal,
          streamReconnectPolicy: { reconnect: false },
        });
        if (index === 0) acknowledgementMs = performance.now() - started;
        let ended = false;
        for await (const event of response) {
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
          if (event.type === "input.requested") clarificationCount++;
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
      return {
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
