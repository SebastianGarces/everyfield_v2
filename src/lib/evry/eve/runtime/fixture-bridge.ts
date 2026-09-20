import { defineState } from "eve/context";
import type { LanguageModelMiddleware } from "ai";

export type FixtureModelParams = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];
export type FixtureModel = Parameters<
  NonNullable<LanguageModelMiddleware["wrapStream"]>
>[0]["model"];

export type FixtureIdentity = {
  appSessionId: string;
  userId: string;
  plantId: string;
};
export type FixtureReservation = {
  finish(inputTokens: number, outputTokens: number): void;
};
export type FixtureRunHooks = {
  now: Date;
  maxOutputTokens: number;
  model?: FixtureModel;
  turnInput(text: string): void;
  authorize(allowed: boolean): void;
  call(value: {
    id: string;
    name: string;
    input: unknown;
    output: unknown;
  }): void;
  present(reference: string): void;
  reserve(params: FixtureModelParams): FixtureReservation;
};
export type IsolatedFixtureHost = {
  run(identity: FixtureIdentity): FixtureRunHooks;
};

declare global {
  // Set only by the isolated evaluation process before importing the compiled server.
  var __everyfieldIsolatedEveFixtureHost: IsolatedFixtureHost | undefined;
}

const binding = defineState<FixtureIdentity | null>(
  "evry.eval-fixture-binding",
  () => null
);

export function bindIsolatedFixtureTurn(identity: FixtureIdentity) {
  if (!globalThis.__everyfieldIsolatedEveFixtureHost) return;
  globalThis.__everyfieldIsolatedEveFixtureHost.run(identity);
  binding.update(() => identity);
}

export function fixtureRun(
  identity: FixtureIdentity
): FixtureRunHooks | undefined {
  return globalThis.__everyfieldIsolatedEveFixtureHost?.run(identity);
}

export function currentFixtureRun(): FixtureRunHooks | undefined {
  const host = globalThis.__everyfieldIsolatedEveFixtureHost;
  if (!host) return undefined;
  const identity = binding.get();
  if (!identity) throw new Error("Isolated evaluation turn was not bound");
  return host.run(identity);
}
