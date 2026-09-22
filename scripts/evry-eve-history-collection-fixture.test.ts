import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  assessmentEvidenceId,
  assessmentEvidenceText,
  assessmentEvidenceTruth,
  seedAssessmentEvidenceFixture,
  type AssessmentEvidenceRecord,
} from "@/lib/evry/eve/evals/fixtures/assessment-evidence";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const factSchema = z.object({ label: z.string(), value: z.string() });
const collectedSchema = z.object({
  status: z.literal("complete"),
  scope: z.strictObject({
    resource: z.strictObject({ kind: z.literal("assessments") }),
    dateBasis: z.literal("created_at"),
    latestPerPerson: z.literal(false),
  }),
  matched: z.literal(53),
  timeZone: z.literal("America/New_York"),
  readCount: z.literal(4),
  snapshot: z.literal("multiple_reads"),
  records: z
    .array(
      z.object({
        item: z.object({
          id: z.uuid(),
          facts: z.array(factSchema),
        }),
        notes: z.string(),
        contentComplete: z.literal(true),
        totalCharacters: z.number().int().nonnegative(),
        resultReferences: z.array(z.string().min(1)).min(1),
      })
    )
    .length(53),
});
const childInputSchema = z.object({
  resource: z.object({ kind: z.literal("assessments") }),
  dateBasis: z.literal("created_at"),
  latestPerPerson: z.literal(false),
  recordIds: z.array(z.uuid()).optional(),
  contentOffset: z.number().int().nonnegative().optional(),
  result: z.object({
    mode: z.literal("list"),
    limit: z.literal(50),
    afterId: z.uuid().optional(),
  }),
});

test(
  "compiled history collection preserves all SQL assessment notes and entry times across record pages and Unicode chunks",
  {
    skip: process.env.EVRY_EVE_HISTORY_COLLECTION_PROOF !== "1",
    timeout: 240_000,
  },
  async () => {
    const compiledEntry = process.env.EVRY_EVE_COMPILED_ENTRY;
    assert.ok(compiledEntry, "Use the root's verified compiled artifact");
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const m = createFixtureManifest("assessments-03", 927);
    try {
      store.seed(m);
      seedAssessmentEvidenceFixture(m, store);
      const truth = assessmentEvidenceTruth(m, store);
      assert.ok(truth);
      assert.equal(truth.records.length, 53);
      const auditStart = store.auditStart();
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(compiledEntry),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: m.sessionToken,
          actor: { userId: m.ids.actor, plantId: m.ids.plant },
          turns: [
            "Read all individual 4C assessment notes and when they were entered.",
          ],
          now: m.now,
          maxCostUsd: 1,
          verifyReplay: true,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model: {
            mode: "scripted",
            responses: [
              {
                toolCalls: [
                  {
                    id: "load-history",
                    name: "load_tools",
                    input: { names: ["people.history.query"] },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "collect-history",
                    name: "code_mode",
                    // No fixture IDs, notes, expected totals or classification
                    // clues are supplied to the collection helper.
                    input: {
                      js: "return await history.collect({resource:{kind:'assessments'}, dateBasis:'created_at', latestPerPerson:false});",
                    },
                  },
                ],
              },
              { text: "The recorded assessment notes have been read." },
            ],
          },
        },
        AbortSignal.timeout(180_000)
      );
      assert.deepEqual(outcome.runtimeProof?.failures, []);
      assert.equal(outcome.runtimeProof?.modelCalls, 3);
      assert.ok(
        outcome.runtimeProof?.modelRequests?.[1].tools.includes(
          "people_history_query"
        ),
        "The actual compiled provider request must contain the loaded schema"
      );
      const part = outcome.messages
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolCallId === "collect-history"
        );
      assert.ok(
        part?.type === "dynamic-tool" && part.state === "output-available"
      );
      const { data } = z
        .object({
          data: z.object({
            status: z.literal("completed"),
            calls: z.literal(4),
            output: collectedSchema,
          }),
        })
        .parse(part.output);
      const records = data.output.records;
      assert.deepEqual(
        records.map(({ item }) => item.id).sort(),
        truth.records.map(({ id }) => id).sort()
      );
      const calls = outcome.hostCapture.calls;
      assert.equal(calls.length, 4);
      assert.deepEqual(
        calls.map(({ id }) => id),
        Array.from(
          { length: 4 },
          (_, index) => `collect-history:tool-${index + 1}`
        )
      );
      const readIds = new Set(calls.map(({ id }) => id));
      for (const record of records) {
        const expected: AssessmentEvidenceRecord | undefined =
          truth.records.find(({ id }) => id === record.item.id);
        assert.ok(expected);
        const fullText = assessmentEvidenceText(expected);
        assert.equal(digest(record.notes), digest(fullText));
        assert.equal(record.notes, fullText);
        assert.equal(record.totalCharacters, Array.from(fullText).length);
        assert.equal(
          record.item.facts.find(({ label }) => label === "Recorded at (UTC)")
            ?.value,
          expected.entered
        );
        assert.equal(
          record.item.facts.some(({ label }) =>
            [
              "Recorded notes",
              "Notes character count",
              "Notes character offset",
              "Next content offset",
            ].includes(label)
          ),
          false,
          "Complete notes must not be duplicated as stale chunk facts"
        );
        assert.ok(record.resultReferences.every((ref) => readIds.has(ref)));
        for (const reference of record.resultReferences) {
          const source = calls.find(({ id }) => id === reference);
          assert.ok(source);
          assert.ok(
            capturedReadArtifactSchema
              .parse(source.output)
              .items.some(({ id }) => id === record.item.id),
            "Each record reference must name a real reader response containing it"
          );
        }
      }
      const listRows: string[] = [];
      const offsets: number[] = [];
      for (const [index, call] of calls.entries()) {
        assert.equal(call.name, "people.history.query");
        const input = childInputSchema.parse(call.input);
        assert.equal(
          Object.hasOwn(
            z.record(z.string(), z.unknown()).parse(call.input),
            "text"
          ),
          false
        );
        const output = capturedReadArtifactSchema.parse(call.output);
        assert.equal(
          Object.hasOwn(
            z.record(z.string(), z.unknown()).parse(call.output),
            "continuation"
          ),
          false,
          "The authoritative journal retains original reader output"
        );
        if (index < 2) {
          assert.equal(input.recordIds, undefined);
          assert.equal(input.contentOffset ?? 0, 0);
          assert.equal(output.items.length, index === 0 ? 50 : 3);
          assert.equal(output.counts.matched, 53);
          assert.equal(
            input.result.afterId,
            index === 0 ? undefined : listRows.at(-1)
          );
          listRows.push(...output.items.map(({ id }) => id));
        } else {
          const offset = input.contentOffset;
          assert.ok(offset !== undefined);
          offsets.push(offset);
          assert.equal(input.result.afterId, undefined);
          assert.deepEqual(input.recordIds, [
            assessmentEvidenceId(m, "recorded-concern"),
          ]);
          assert.equal(output.counts.matched, 1);
        }
        for (const item of output.items) {
          const expected: AssessmentEvidenceRecord | undefined =
            truth.records.find(({ id }) => id === item.id);
          assert.ok(expected);
          assert.equal(
            item.facts?.find(({ label }) => label === "Recorded notes")?.value,
            Array.from(assessmentEvidenceText(expected))
              .slice(input.contentOffset ?? 0, (input.contentOffset ?? 0) + 240)
              .join("")
          );
        }
      }
      assert.deepEqual(
        listRows,
        truth.records.map(({ id }) => id)
      );
      assert.deepEqual(offsets, [240, 480]);
      const jordan = records.find(
        ({ item }) => item.id === assessmentEvidenceId(m, "implicit-concern")
      );
      assert.ok(jordan);
      assert.match(jordan.notes, /missed three agreed check-ins/);
      assert.doesNotMatch(jordan.notes, /concern/i);
      const blank = truth.records.find(
        ({ id }) => id === assessmentEvidenceId(m, "low-without-notes")
      );
      assert.ok(blank);
      assert.ok(blank.notes.every((note) => note === null));
      assert.equal(
        records.find(({ item }) => item.id === blank.id)?.notes,
        assessmentEvidenceText(blank),
        "Absent narrative remains scores with blank notes, not invented concerns"
      );
      const unicode = records.find(
        ({ item }) => item.id === assessmentEvidenceId(m, "recorded-concern")
      );
      assert.ok(unicode);
      assert.ok(unicode.notes.includes("🙂"));
      assert.ok(unicode.notes.length > Array.from(unicode.notes).length);
      for (const forbidden of ["foreign", "deleted"])
        assert.equal(
          JSON.stringify(data.output).includes(
            assessmentEvidenceId(m, forbidden)
          ),
          false
        );
      assert.equal(outcome.hostCapture.freshAuthorizations, 4);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.deepEqual(store.writesSince(auditStart, m), []);
      assert.equal(outcome.costUsd, 0);
      assert.equal(
        outcome.judge,
        null,
        "Scripted retrieval is not model-quality evidence"
      );
      assert.ok(
        outcome.replay?.matchingTranscript &&
          outcome.replay.stableActivity &&
          outcome.replay.stableCapture
      );
    } finally {
      try {
        store.revoke(m);
      } finally {
        await stack.cleanup();
      }
    }
  }
);
