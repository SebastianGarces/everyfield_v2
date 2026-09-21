import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { startDocumentFixtureStorage } from "@/lib/evry/eve/evals/fixtures/document-storage";
import { createPeopleReviewAttachment } from "@/lib/evry/eve/evals/fixtures/content-actions";
import { createCompiledEveEvalRunner } from "@/lib/evry/eve/evals/http/compiled-adapter";

test(
  "compiled CSV review uses the supplied attachment and never imports rows",
  { skip: process.env.EVRY_EVE_COMPILED_CSV_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      const storage = await startDocumentFixtureStorage();
      const previousEndpoint = neonConfig.fetchEndpoint;
      const environment = {
        ...storage.environment,
        DATABASE_URL: stack.databaseUrl,
        RESEND_API_KEY: "re_compiled_csv_never_sent",
      };
      const previous = new Map(
        Object.keys(environment).map((key) => [key, process.env[key]])
      );
      let fixture: Awaited<
        ReturnType<import("@/lib/evry/eve/evals/runner").EvalAdapter["prepare"]>
      > = null;
      try {
        Object.assign(process.env, environment);
        neonConfig.fetchEndpoint = stack.proxyUrl;
        const { createProductionEveEvalAdapter } =
          await import("@/lib/evry/eve/evals/fixtures/adapter");
        const scenario = questions.find((q) => q.id === "documents-06")!;
        const adapter = createProductionEveEvalAdapter({
          store: createFixtureStore(stack.container),
          buildSha: "0".repeat(40),
          captureMode: "isolated_http",
          preparePeopleCsv: (manifest) =>
            createPeopleReviewAttachment(
              manifest,
              storage.environment.AWS_SECRET_ACCESS_KEY
            ),
          runProduction: createCompiledEveEvalRunner({
            compiledEntry: resolve(".output/server/index.mjs"),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            prices: {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 2,
              maxInputBytes: 500_000,
              maxOutputTokens: 1_000,
            },
            model(bound) {
              assert.equal(bound.turns[0], scenario.turns[0]);
              const supplied = bound.turns.at(-1)!;
              const attachmentReference =
                supplied.match(/Reference: (\S+)/)?.[1];
              const attachmentDigest = supplied.match(
                /SHA-256: ([a-f0-9]{64})/
              )?.[1];
              assert.ok(attachmentReference && attachmentDigest);
              return {
                mode: "scripted",
                responses: [
                  { text: "Please attach the CSV you want reviewed." },
                  {
                    toolCalls: [
                      {
                        id: "load-files",
                        name: "load_tools",
                        input: { names: ["files.inspect"] },
                      },
                    ],
                  },
                  {
                    toolCalls: [
                      {
                        id: "review-csv",
                        name: "files_inspect",
                        input: { attachmentReference, attachmentDigest },
                      },
                    ],
                  },
                  {
                    text: "The file has one possible duplicate and one row missing a first name. Nothing was imported. [[evry-result:review-csv]]",
                  },
                ],
              };
            },
            onOutcome(outcome) {
              assert.equal(outcome.costUsd, 0);
              assert.deepEqual(
                outcome.hostCapture.calls.map((call) => call.name),
                ["files.inspect"]
              );
              assert.equal(outcome.hostCapture.outboundMessages, 0);
            },
          }),
        });
        fixture = await adapter.prepare(scenario);
        assert.ok(fixture);
        const observation = observationSchema.parse(
          await fixture.run({
            scenario,
            signal: AbortSignal.timeout(60_000),
            maxCostUsd: 1,
          })
        );
        assert.deepEqual(
          gradeObservation(scenario.id, fixture.expectations, observation)
            .failures,
          ["quality_not_reviewed"]
        );
        assert.deepEqual(observation.effects, {
          domainWrites: 0,
          outboundMessages: 0,
        });
        assert.deepEqual(
          storage.requestedKeys,
          [],
          "The signed inline file needs no bucket access"
        );
      } finally {
        try {
          await fixture?.cleanup();
        } finally {
          try {
            await storage.cleanup();
          } finally {
            neonConfig.fetchEndpoint = previousEndpoint;
            for (const [key, value] of previous)
              value === undefined
                ? delete process.env[key]
                : (process.env[key] = value);
          }
        }
      }
    } finally {
      await stack.cleanup();
    }
  }
);
