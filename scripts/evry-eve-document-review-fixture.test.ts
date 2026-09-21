import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  documentReviewFixtureIds,
  documentReviewFiles,
  documentReviewId,
} from "@/lib/evry/eve/evals/fixtures/document-review";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startDocumentFixtureStorage } from "@/lib/evry/eve/evals/fixtures/document-storage";

test(
  "original document questions use actual authorized metadata and stored bytes",
  {
    skip: process.env.EVRY_EVE_DOCUMENT_REVIEW_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    let storage:
      | Awaited<ReturnType<typeof startDocumentFixtureStorage>>
      | undefined;
    let outbound = 0;
    try {
      storage = await startDocumentFixtureStorage();
      const { requestedKeys } = storage;
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      Object.assign(process.env, storage.environment);
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated fixture database fetch is allowed");
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let variant:
        | "correct"
        | "all"
        | "broad"
        | "older"
        | "metadata"
        | "partial"
        | "one-file"
        | "corrupt" = "correct";
      let manifest = createFixtureManifest("documents-03", 0);
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        prepareDocumentFiles: storage.prepareFiles,
        async runProduction({ scenario, registry }) {
          let call = 0;
          const invoke = async (name: string, input: unknown) => {
            const output = await registry.invoke(name, input, {
              callId: `document-${call++}`,
            });
            assert.equal(
              JSON.stringify(output).includes("FOREIGN_DOCUMENT_SECRET"),
              false
            );
            return capturedReadArtifactSchema
              .extend({
                exclusions: z.array(
                  z.object({ reason: z.string(), count: z.number() })
                ),
              })
              .parse(output);
          };
          if (scenario.id === "documents-03") {
            await invoke("documents.query", {
              query: {
                resource: "generated",
                mode: "list",
                ...(variant === "broad" ? {} : { search: "agenda" }),
                limit: variant === "all" ? 50 : 1,
                ...(variant === "older" ? { offset: 1 } : {}),
              },
            });
          } else {
            assert.equal(
              scenario.turns[0],
              "Compare the agendas in these two generated documents."
            );
            assert.equal(
              scenario.turns.length,
              2,
              "Explicit user references must be retained in the runner"
            );
            const ids = [
              ...scenario.turns[1]!.matchAll(
                /\/api\/documents\/history\/([0-9a-f-]{36})/g
              ),
            ].map((match) => z.uuid().parse(match[1]));
            assert.equal(ids.length, 2);
            if (variant === "metadata")
              await invoke("documents.query", {
                query: { resource: "generated", search: "agenda", limit: 50 },
              });
            else
              for (const id of variant === "one-file"
                ? ids.slice(0, 1)
                : variant === "corrupt"
                  ? [ids[0]!, documentReviewId(manifest, "corrupt")]
                  : ids) {
                let offset = 0;
                while (true) {
                  const result = await invoke("documents.read", {
                    ids: [id],
                    offset,
                    maxCharacters: 500,
                  });
                  if (!result.items.length) break;
                  const next = result.items[0]!.facts?.find(
                    (fact) => fact.label === "Next offset"
                  )?.value;
                  assert.ok(next);
                  if (
                    variant === "partial" ||
                    next === "End of extracted content"
                  )
                    break;
                  offset = Number(next);
                  assert.ok(Number.isInteger(offset) && offset > 0);
                }
              }
            // Unavailable foreign IDs are indistinguishable from missing IDs, and
            // must never reach the private object transport.
            let unavailable: unknown;
            for (const name of ["foreign", "unknown", "missing", "corrupt"]) {
              const result = await invoke("documents.read", {
                ids: [documentReviewId(manifest, name)],
              });
              assert.equal(result.items.length, 0, name);
              if (name === "foreign") unavailable = result.exclusions;
              if (name === "unknown")
                assert.deepEqual(
                  result.exclusions,
                  unavailable,
                  "Foreign and nonexistent IDs have the same answer"
                );
            }
          }
          return {
            answer:
              "Unpaid production metadata/file read proof. Human comparison and wording have not been evaluated.",
            clarificationCount: scenario.id === "documents-04" ? 1 : 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const [repetition, id] of documentReviewFixtureIds.entries())
        await t.test(id, async () => {
          manifest = createFixtureManifest(id, repetition);
          requestedKeys.length = 0;
          const files = documentReviewFiles(manifest);
          const scenario = questions.find((question) => question.id === id)!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must be wired`);
          try {
            for (const mode of id === "documents-03"
              ? (["correct", "all", "broad", "older"] as const)
              : ([
                  "correct",
                  "metadata",
                  "partial",
                  "one-file",
                  "corrupt",
                ] as const)) {
              variant = mode;
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(45_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                id,
                fixture.expectations,
                observation
              ).failures;
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.ok(failures.includes("quality_not_reviewed"));
              if (mode === "correct" || mode === "all")
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(observation.facts)
                );
              else
                assert.ok(
                  failures.some((failure) => failure.startsWith("fact:")),
                  `${id}/${mode} must reject incomplete or wrong evidence`
                );
            }
            assert.equal(
              requestedKeys.includes(
                files.find((file) => file.name === "foreign")!.key
              ),
              false
            );
            if (id === "documents-04")
              for (const name of ["agenda-a", "agenda-b", "corrupt"])
                assert.ok(
                  requestedKeys.includes(
                    files.find((file) => file.name === name)!.key
                  )
                );
            else
              assert.equal(
                requestedKeys.length,
                0,
                "Finding a download must not regenerate or read the file"
              );
          } finally {
            await fixture.cleanup();
          }
        });
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = originalFetch;
      await storage?.cleanup();
      await stack.cleanup();
    }
  }
);
