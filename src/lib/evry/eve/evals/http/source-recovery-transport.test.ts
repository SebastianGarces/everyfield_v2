import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  compiledFixtureRequest,
  httpEvalOutcomeSchema,
  sourceRecoveryPreparationPrompt,
} from "./process-contract";
import { createFixtureManifest } from "../fixtures/manifest";
import {
  bindSourceRecoveryTurns,
  sourceRecoveryRequest,
} from "../fixtures/source-recovery";
import {
  createCompositionBudget,
  runEvryComposition,
} from "../../composition/runner";

const m = createFixtureManifest("edges-13", 0);
const request = {
  compiledEntry: "/private/tmp/compiled/index.mjs",
  databaseUrl: "postgresql://fixture:fixture@127.0.0.1:5432/eve_fixture",
  proxyUrl: "http://127.0.0.1:4444/sql",
  sessionToken: m.sessionToken,
  actor: { userId: m.ids.actor, plantId: m.ids.plant },
  turns: bindSourceRecoveryTurns([sourceRecoveryRequest]),
  now: m.now,
  maxCostUsd: 1,
  prices: {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 1,
    maxInputBytes: 10000,
    maxOutputTokens: 1000,
  },
  model: { mode: "scripted", responses: [{ text: "Fixture" }] },
};
test("fault opt-in is host-only and bound to original edges-13 setup and question", () => {
  assert.equal(compiledFixtureRequest.parse(request).sourceRecovery, undefined);
  assert.equal(
    compiledFixtureRequest.parse({ ...request, sourceRecovery: "edges-13" })
      .sourceRecovery,
    "edges-13"
  );
  assert.equal(
    compiledFixtureRequest.safeParse({
      ...request,
      sourceRecovery: "edges-13",
      model: { mode: "live", spendingApproved: true },
    }).success,
    true,
    "Metered live fixtures can test the same dependency fault"
  );
  for (const invalid of [
    { sourceRecovery: "cross-01" },
    { sourceRecovery: { caseId: "edges-13", plantId: m.ids["foreign-plant"] } },
    { sourceRecovery: "edges-13", turns: [sourceRecoveryRequest] },
    {
      sourceRecovery: "edges-13",
      turns: ["Different setup", sourceRecoveryRequest],
    },
    { sourceRecovery: "edges-13", verifyRestart: true },
    {
      sourceRecoveryFaults: [
        {
          source: "meetings.query",
          boundary: "neon_http",
          plantId: m.ids.plant,
          ordinal: 1,
        },
      ],
    },
  ])
    assert.equal(
      compiledFixtureRequest.safeParse({ ...request, ...invalid }).success,
      false
    );
});
test("preparation fault is limited to its exact scripted proof and cannot opt in live", () => {
  const preparation = {
    ...request,
    sourceRecovery: "edges-13",
    turns: [sourceRecoveryPreparationPrompt],
  };
  assert.ok(compiledFixtureRequest.safeParse(preparation).success);
  for (const override of [
    { model: { mode: "live", spendingApproved: true } },
    { turns: [sourceRecoveryPreparationPrompt, "Another turn"] },
    { turns: ["Another preparation"] },
    { verifyRestart: true },
    { attachments: [] },
  ])
    assert.equal(
      compiledFixtureRequest.safeParse({ ...preparation, ...override }).success,
      false
    );
});
test("fault receipts are separate from successful host capture and strictly parsed", () => {
  const outcome = {
    answer: "",
    clarificationCount: 0,
    latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 1 },
    costUsd: 0,
    judge: null,
    eveSessionId: "fixture-session",
    messages: [],
    hostCapture: {
      calls: [],
      presented: [],
      freshAuthorizations: 0,
      refusedAuthorizations: 0,
      outboundMessages: 0,
      costUsd: 0,
      costBasis: "provider_usage",
      modelCalls: [],
    },
  };
  const fault = {
    source: "meetings.query",
    boundary: "neon_http",
    plantId: m.ids.plant,
    ordinal: 1,
  };
  assert.equal(
    httpEvalOutcomeSchema.parse(outcome).sourceRecoveryFaults,
    undefined
  );
  const parsed = httpEvalOutcomeSchema.parse({
    ...outcome,
    sourceRecoveryFaults: [fault],
  });
  assert.deepEqual(parsed.sourceRecoveryFaults, [fault]);
  assert.deepEqual(parsed.hostCapture.calls, []);
  for (const receipts of [
    [fault, fault],
    [{ ...fault, source: "tasks.query" }],
    [{ ...fault, privateError: "raw database exception" }],
    [{ ...fault, ordinal: 0 }],
  ])
    assert.equal(
      httpEvalOutcomeSchema.safeParse({
        ...outcome,
        sourceRecoveryFaults: receipts,
      }).success,
      false
    );
});
test("actual sandbox exposes SDK generic rejection, never underlying dependency error", async () => {
  const result = await runEvryComposition({
    callId: "source-error-shape",
    budget: createCompositionBudget(),
    registry: {
      describe: () => [
        {
          name: "meetings.query",
          description: "Fixture rejection",
          effect: "read",
          inputSchema: z.object({}),
        },
      ],
      invoke: async () => {
        throw new Error("private dependency sentinel");
      },
    },
    js: "const results = await Promise.allSettled([tools['meetings.query']({})]); return results.map(r => r.status === 'fulfilled' ? r : {status:r.status,reason:r.reason.message});",
  });
  assert.deepEqual(result, {
    status: "completed",
    output: [{ status: "rejected", reason: "Host tool failed." }],
    calls: 1,
  });
  assert.ok(!JSON.stringify(result).includes("private dependency sentinel"));
});
