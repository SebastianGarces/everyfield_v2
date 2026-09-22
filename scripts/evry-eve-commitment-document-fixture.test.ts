import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  commitmentDocumentId,
  commitmentDocumentQuestion,
} from "@/lib/evry/eve/evals/fixtures/commitment-document";
import { fixtureMessageSchema } from "@/lib/evry/eve/evals/http/transcript";
import {
  projectEveMessage,
  selectedEveResultReferences,
} from "@/components/evry/eve-message-projection";
import type { ProductionEvalRunner } from "@/lib/evry/eve/evals/fixtures/adapter";
import {
  startDocumentFixtureStorage,
  type DocumentFixtureTransport,
} from "@/lib/evry/eve/evals/fixtures/document-storage";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

function isEmbeddedFixtureBinary(url: URL) {
  return (
    url.protocol === "data:" &&
    url.origin === "null" &&
    /^data:(?:application\/octet-stream|font\/ttf);base64,/i.test(url.href)
  );
}

test("commitment proof permits only its known embedded binary data URLs", () => {
  assert.equal(
    isEmbeddedFixtureBinary(
      new URL("data:application/octet-stream;base64,AGFzbQ==")
    ),
    true
  );
  assert.equal(
    isEmbeddedFixtureBinary(new URL("data:font/ttf;base64,AAEAAA==")),
    true
  );
  for (const value of [
    "data:text/plain;base64,SGVsbG8=",
    "data:application/octet-stream,not-base64",
    "data:application/javascript;base64,YWxlcnQoMSk=",
    "https://example.test/font.ttf",
  ])
    assert.equal(isEmbeddedFixtureBinary(new URL(value)), false, value);
});

test(
  "commitment lookup uses actual scoped history and authorized app downloads without effects",
  {
    skip: process.env.EVRY_EVE_COMMITMENT_DOCUMENT_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const storage = await startDocumentFixtureStorage();
    const oldStorage = Object.fromEntries(
      Object.keys(storage.environment).map((key) => [key, process.env[key]])
    );
    let preparedFiles: Parameters<DocumentFixtureTransport>[0] = [];
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
    };
    const rejectedFetches: { protocol: string; origin: string }[] = [];
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      Object.assign(process.env, storage.environment);
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        const allowedLoopback = [
          new URL(stack.proxyUrl).origin,
          storage.environment.AWS_ENDPOINT_URL_S3,
        ].includes(url.origin);
        if (!allowedLoopback && !isEmbeddedFixtureBinary(url)) {
          rejectedFetches.push({ protocol: url.protocol, origin: url.origin });
          throw new Error(
            `External fetch prohibited in commitment lookup proof: ${JSON.stringify(rejectedFetches.at(-1))}`
          );
        }
        return previous.fetch(input, init);
      };
      const [
        { createProductionEveEvalAdapter },
        { collectResult, publicResultArtifacts },
        { GET: downloadCommitment },
        { historyContinuationModelOutput, historyContinuationSchema },
      ] = await Promise.all([
        import("@/lib/evry/eve/evals/fixtures/adapter"),
        import("@/lib/evry/eve/runtime/results"),
        import("@/app/api/evry/people/files/commitments/[commitmentId]/route"),
        import("@/lib/evry/eve/runtime/history-continuation"),
      ]);
      const store = createFixtureStore(stack.container);
      const variants = [
        "correct",
        "latest-only",
        "wrong-person",
        "foreign",
        "hidden",
        "missing-history",
        "revoked",
      ] as const;
      let variant: (typeof variants)[number] = "correct",
        repetition = 0,
        serial = 0;
      const runProduction: ProductionEvalRunner = async ({
        scenario,
        registry,
        actor,
        onPresentResult,
        sessionId,
      }) => {
        assert.deepEqual(scenario.turns, [commitmentDocumentQuestion]);
        const m = createFixtureManifest(scenario.id, repetition);
        assert.equal(actor.plantId, m.ids.plant);
        const requestsBeforeInvalidId = [...storage.requestedKeys];
        const invalid = await downloadCommitment(
          new Request("http://fixture.invalid"),
          { params: Promise.resolve({ commitmentId: "not-a-uuid" }) }
        );
        assert.equal(invalid.status, 404);
        assert.equal(invalid.headers.get("location"), null);
        assert.equal(invalid.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(storage.requestedKeys, requestsBeforeInvalidId);
        const before = store.sql(
          `select jsonb_agg(to_jsonb(c) order by c.id)::text from commitments c where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
        );
        const calls: CapturedCall[] = [];
        const invoke = async (name: string, input: unknown) => {
          const id = `commitment-${serial++}`,
            output = await registry.invoke(name, input, { callId: id });
          const call = { id, name, input, output };
          calls.push(call);
          return call;
        };
        const messages = [
          fixtureMessageSchema.parse({
            id: "u0",
            role: "user",
            parts: [{ type: "text", text: commitmentDocumentQuestion }],
          }),
        ];
        const people = capturedReadArtifactSchema.parse(
          (
            await invoke("people.query", {
              cohort: {
                all: { search: variant === "wrong-person" ? "Jordan" : "Alex" },
              },
              result: { mode: "list" },
            })
          ).output
        );
        assert.equal(
          people.items.length,
          1,
          "The native search resolves one same-plant person despite the foreign homonym"
        );
        const documents: string[] = [];
        if (variant !== "missing-history") {
          let afterId: string | undefined;
          const cursors = new Set<string>();
          do {
            const historyInput = {
              resource: { kind: "commitments" },
              cohort: {
                all: { personIds: people.items.map((p) => p.id) },
              },
              latestPerPerson: variant === "latest-only",
              result: {
                mode: "list" as const,
                limit: 1,
                ...(afterId ? { afterId } : {}),
              },
            };
            const historyCall = await invoke(
              "people.history.query",
              historyInput
            );
            const original = z.json().parse(historyCall.output);
            const frozen = JSON.stringify(original);
            const page = capturedReadArtifactSchema
              .extend({
                continuation: historyContinuationSchema,
              })
              .parse(historyContinuationModelOutput(historyInput, original));
            assert.equal(JSON.stringify(original), frozen);
            assert.ok(
              original &&
                typeof original === "object" &&
                !Array.isArray(original)
            );
            assert.equal(Object.hasOwn(original, "continuation"), false);
            documents.push(...page.items.map((row) => row.id));
            assert.equal(page.continuation.status, "available");
            assert.ok(page.continuation.status === "available");
            afterId = page.continuation.nextAfterId ?? undefined;
            if (afterId) {
              assert.ok(
                page.items.length && !cursors.has(afterId),
                "History pagination makes progress"
              );
              cursors.add(afterId);
            }
          } while (afterId);
        } else documents.push(commitmentDocumentId(m, "alex-document"));
        if (variant === "foreign")
          documents.splice(
            0,
            documents.length,
            commitmentDocumentId(m, "foreign-document")
          );
        if (variant === "revoked") {
          store.revoke(m);
          const requestedBefore = [...storage.requestedKeys];
          await assert.rejects(
            invoke("people.commitment-download", {
              commitmentId: documents[0],
            }),
            UnauthorizedError
          );
          const refused = await downloadCommitment(
            new Request("http://fixture.invalid"),
            {
              params: Promise.resolve({
                commitmentId: commitmentDocumentId(m, "alex-document"),
              }),
            }
          );
          assert.equal(refused.status, 404);
          assert.equal(refused.headers.get("location"), null);
          assert.deepEqual(storage.requestedKeys, requestedBefore);
        } else
          for (const commitmentId of documents) {
            const requestedBefore = [...storage.requestedKeys];
            const call = await invoke("people.commitment-download", {
              commitmentId,
            });
            const read = capturedReadArtifactSchema.parse(call.output);
            const response = await downloadCommitment(
              new Request("http://fixture.invalid"),
              { params: Promise.resolve({ commitmentId }) }
            );
            assert.equal(
              response.headers.get("cache-control"),
              "private, no-store"
            );
            if (!read.items.length) {
              assert.equal(response.status, 404);
              assert.equal(response.headers.get("location"), null);
              assert.deepEqual(storage.requestedKeys, requestedBefore);
            } else {
              assert.equal(response.status, 303);
              const location = new URL(
                z.string().parse(response.headers.get("location"))
              );
              assert.equal(
                location.origin,
                storage.environment.AWS_ENDPOINT_URL_S3
              );
              assert.equal(location.searchParams.get("X-Amz-Expires"), "300");
              const file = preparedFiles.find(
                (file) => file.id === commitmentId
              );
              assert.ok(
                file,
                "Each downloadable record has a real staged fixture object"
              );
              const bytes = await fetch(location, { redirect: "error" });
              assert.equal(bytes.status, 200);
              const actual = Buffer.from(await bytes.arrayBuffer());
              assert.equal(actual.subarray(0, 5).toString(), "%PDF-");
              assert.equal(
                createHash("sha256").update(actual).digest("hex"),
                createHash("sha256").update(file.body).digest("hex")
              );
            }
            if (!read.items.length) continue;
            const records = collectResult(
              [],
              { reference: call.id, turnId: "turn_0", capability: call.name },
              z.json().parse(call.output)
            );
            const artifacts = records.flatMap((record) =>
              publicResultArtifacts(record.artifacts)
            );
            const message = fixtureMessageSchema.parse({
              id: call.id,
              role: "assistant",
              metadata: { turnId: "turn_0", status: "complete" },
              parts: [
                {
                  type: "dynamic-tool",
                  toolName: call.name.replaceAll(".", "_"),
                  toolCallId: call.id,
                  state: "output-available",
                  input: call.input,
                  output: {
                    data: call.output,
                    presentation: {
                      version: 1,
                      turnId: "turn_0",
                      results: [{ reference: call.id, artifacts }],
                    },
                  },
                },
                {
                  type: "text",
                  text:
                    variant === "hidden"
                      ? "I found a commitment."
                      : `[[evry-result:${call.id}]]`,
                },
              ],
            });
            messages.push(message);
            for (const reference of selectedEveResultReferences(message))
              onPresentResult(reference);
            if (variant === "correct")
              assert.ok(
                projectEveMessage(message).some(
                  (part) =>
                    part.kind === "artifact" && part.artifact.kind === "read"
                )
              );
          }
        assert.equal(
          store.sql(
            `select jsonb_agg(to_jsonb(c) order by c.id)::text from commitments c where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
          ),
          before
        );
        return {
          eveSessionId: sessionId,
          messages,
          answer: "Scripted commitment lookup; model quality not reviewed.",
          clarificationCount: 0,
          costUsd: 0,
          judge: null,
          latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
        };
      };
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        runProduction,
        prepareDocumentFiles: async (files) => {
          preparedFiles = files;
          return storage.prepareFiles(files);
        },
      });
      const scenario = questions.find((q) => q.id === "commitments-03")!;
      for (const mode of variants)
        await t.test(mode, async () => {
          variant = mode;
          const fixture = await adapter.prepare(scenario);
          assert.ok(
            fixture,
            "Root must register the new fixture family before this production proof"
          );
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(40_000),
                maxCostUsd: 0,
              })
            );
            const failures = gradeObservation(
              scenario.id,
              fixture.expectations,
              observation
            ).failures;
            assert.deepEqual(observation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(observation.judge, null);
            if (mode === "correct")
              assert.deepEqual(
                failures,
                ["quality_not_reviewed"],
                JSON.stringify(observation)
              );
            else
              assert.ok(
                failures.some((f) => f.startsWith("fact:")),
                `${mode}: ${JSON.stringify(failures)}`
              );
          } finally {
            await fixture.cleanup();
            repetition++;
          }
        });
      assert.deepEqual(
        rejectedFetches,
        [],
        `Rejected fetches: ${JSON.stringify(rejectedFetches)}`
      );
    } finally {
      globalThis.fetch = previous.fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      for (const [key, value] of Object.entries(oldStorage)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      try {
        await storage.cleanup();
      } finally {
        await stack.cleanup();
      }
    }
  }
);
