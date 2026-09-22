import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  unlink,
  cp,
  mkdtemp,
  rm,
  realpath,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { documentReviewFiles } from "@/lib/evry/eve/evals/fixtures/document-review";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { startDocumentFixtureStorage } from "@/lib/evry/eve/evals/fixtures/document-storage";
import { createCompiledEveEvalRunner } from "@/lib/evry/eve/evals/http/compiled-adapter";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";

function rotatedPdf() {
  const stream =
    "q 0 1 -1 0 700 0 cm BT /F1 12 Tf 40 600 Td 16 TL (First rotated line) Tj T* (Second rotated line) Tj ET Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test(
  "standalone compiled document deployment reads PDF through the normal tool path",
  {
    skip: process.env.EVRY_EVE_COMPILED_DOCUMENT_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const deployment = await mkdtemp(join(tmpdir(), "evry-pdf-deployment-"));
    try {
      await cp(resolve(".output"), deployment, {
        recursive: true,
        dereference: true,
      });
      const entry = join(deployment, "server/index.mjs");
      const runtimeRequire = createRequire(entry);
      const pdfEntry = runtimeRequire.resolve(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      const worker = runtimeRequire.resolve(
        "pdfjs-dist/legacy/build/pdf.worker.mjs"
      );
      const canvas = createRequire(pdfEntry).resolve("@napi-rs/canvas");
      for (const dependency of [pdfEntry, worker, canvas])
        assert.ok(
          (await realpath(dependency)).startsWith(
            (await realpath(deployment)) + "/"
          ),
          `Dependency escaped standalone deployment: ${dependency}`
        );
      await t.test("real PDF text, malformed file and byte limit", async () => {
        const compiled = await readFile(entry, "utf8");
        const marker = "//#region node_modules/.pnpm/nitro@";
        const serverRegion = compiled.lastIndexOf(marker);
        assert.ok(
          serverRegion > 0 &&
            compiled.slice(serverRegion).includes("node-server.mjs")
        );
        assert.ok(
          compiled.includes(
            "async function extractGeneratedDocument(bytes, format)"
          )
        );
        // Keep the actual bundled extractor and dependency resolution directory. Only
        // omit the HTTP-listen entry and expose the existing function for this proof.
        const probe = join(
          dirname(entry),
          `document-extraction-proof-${randomUUID()}.mjs`
        );
        await writeFile(
          probe,
          compiled.slice(0, serverRegion) +
            "\nexport { extractGeneratedDocument };\n"
        );
        try {
          const { extractGeneratedDocument } = await import(
            pathToFileURL(probe).href
          );
          const file = documentReviewFiles(
            createFixtureManifest("documents-04", 0)
          ).find((file) => file.format === "pdf")!;
          const result = await extractGeneratedDocument(file.body, "pdf");
          assert.equal(result.complete, true);
          const rotated = await extractGeneratedDocument(rotatedPdf(), "pdf");
          assert.equal(rotated.complete, true);
          assert.equal(
            rotated.sections[0].text,
            "First rotated line\nSecond rotated line"
          );
          assert.equal(
            result.sections
              .map(
                (section: { citation: string; text: string }) =>
                  `[${section.citation}]\n${section.text}`
              )
              .join("\n\n"),
            file.text
          );
          await assert.rejects(
            extractGeneratedDocument(
              new TextEncoder().encode("not a PDF"),
              "pdf"
            )
          );
          assert.deepEqual(
            await extractGeneratedDocument(
              new Uint8Array(8 * 1024 * 1024 + 1),
              "pdf"
            ),
            {
              sections: [],
              complete: false,
              limitation: "File exceeds the 8 MiB extraction limit",
            }
          );
        } finally {
          await unlink(probe);
        }
      });
      await t.test(
        "authorized documents04 comparison reads both actual files via compiled HTTP",
        async () => {
          const stack = await startFixtureStack(process.cwd());
          try {
            const storage = await startDocumentFixtureStorage();
            const previous = {
              database: process.env.DATABASE_URL,
              resend: process.env.RESEND_API_KEY,
              endpoint: neonConfig.fetchEndpoint,
            };
            const previousStorage = new Map(
              Object.keys(storage.environment).map((key) => [
                key,
                process.env[key],
              ])
            );
            let fixture: Awaited<
              ReturnType<
                import("@/lib/evry/eve/evals/runner").EvalAdapter["prepare"]
              >
            > = null;
            try {
              process.env.DATABASE_URL = stack.databaseUrl;
              process.env.RESEND_API_KEY = "re_compiled_pdf_never_sent";
              Object.assign(process.env, storage.environment);
              neonConfig.fetchEndpoint = stack.proxyUrl;
              const { createProductionEveEvalAdapter } =
                await import("@/lib/evry/eve/evals/fixtures/adapter");
              const scenario = questions.find((q) => q.id === "documents-04")!;
              const adapter = createProductionEveEvalAdapter({
                store: createFixtureStore(stack.container),
                buildSha: "0".repeat(40),
                captureMode: "isolated_http",
                prepareDocumentFiles: storage.prepareFiles,
                runProduction: createCompiledEveEvalRunner({
                  compiledEntry: entry,
                  databaseUrl: stack.databaseUrl,
                  proxyUrl: stack.proxyUrl,
                  prices: {
                    inputUsdPerMillion: 1,
                    outputUsdPerMillion: 2,
                    maxInputBytes: 500_000,
                    maxOutputTokens: 1_000,
                  },
                  model(bound) {
                    const documentSelection = bound.turns[1];
                    assert.ok(
                      typeof documentSelection === "string",
                      "Document fixture requires explicit text document links"
                    );
                    const ids = [
                      ...documentSelection.matchAll(
                        /\/api\/documents\/history\/([0-9a-f-]{36})/g
                      ),
                    ].map((match) => z.uuid().parse(match[1]));
                    assert.equal(ids.length, 2);
                    return {
                      mode: "scripted",
                      responses: [
                        { text: "Which two documents should I compare?" },
                        {
                          toolCalls: [
                            {
                              id: "load-documents",
                              name: "load_tools",
                              input: { names: ["documents.read"] },
                            },
                          ],
                        },
                        {
                          toolCalls: [
                            {
                              id: "read-documents",
                              name: "documents_read",
                              input: { ids, offset: 0, maxCharacters: 5000 },
                            },
                          ],
                        },
                        {
                          text: "Both agendas were read. [[evry-result:read-documents]]",
                        },
                      ],
                    };
                  },
                  onOutcome(outcome) {
                    assert.equal(outcome.costUsd, 0);
                    assert.equal(outcome.hostCapture.calls.length, 1);
                    const read = z
                      .object({
                        items: z.array(
                          z.object({
                            facts: z.array(
                              z.object({ label: z.string(), value: z.string() })
                            ),
                          })
                        ),
                        exclusions: z.array(z.unknown()),
                      })
                      .parse(outcome.hostCapture.calls[0]!.output);
                    assert.equal(read.items.length, 2);
                    assert.deepEqual(read.exclusions, []);
                    assert.ok(
                      read.items.some((item) =>
                        item.facts.some(
                          (f) => f.label === "Format" && f.value === "PDF"
                        )
                      )
                    );
                  },
                }),
              });
              fixture = await adapter.prepare(scenario);
              assert.ok(fixture);
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(60_000),
                  // Scripted usage is zero. Allow the fixture host's conservative
                  // per-call reservation for 500k input bytes; no provider exists.
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
              assert.equal(storage.requestedKeys.length, 2);
            } finally {
              try {
                await fixture?.cleanup();
              } finally {
                try {
                  await storage.cleanup();
                } finally {
                  for (const [key, value] of previousStorage)
                    value === undefined
                      ? delete process.env[key]
                      : (process.env[key] = value);
                  previous.database === undefined
                    ? delete process.env.DATABASE_URL
                    : (process.env.DATABASE_URL = previous.database);
                  previous.resend === undefined
                    ? delete process.env.RESEND_API_KEY
                    : (process.env.RESEND_API_KEY = previous.resend);
                  neonConfig.fetchEndpoint = previous.endpoint;
                }
              }
            }
          } finally {
            await stack.cleanup();
          }
        }
      );
    } finally {
      await rm(deployment, { recursive: true, force: true });
    }
  }
);
