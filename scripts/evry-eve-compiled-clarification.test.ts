import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import type { CompiledFixtureRequest } from "@/lib/evry/eve/evals/http/process-contract";

const question =
  "Do you mean individual 4C assessments or Plant Intelligence assessments for the church?";
const reply = "The individual 4C assessments.";
const completion =
  "The clarification reply was received. This scripted transport proof has not read any assessments.";

test(
  "compiled native clarification consumes an optional freeform reply while completed and unmarked prose turns do not",
  {
    skip: process.env.EVRY_EVE_CLARIFICATION_PROOF !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    try {
      const store = createFixtureStore(stack.container);
      for (const mode of [
        "native-question",
        "completed-answer",
        "unmarked-prose",
      ] as const) {
        await t.test(mode, async () => {
          const m = createFixtureManifest(`compiled-clarification-${mode}`, 0);
          store.seed(m);
          const audit = store.auditStart();
          const responses: Extract<
            CompiledFixtureRequest["model"],
            { mode: "scripted" }
          >["responses"] =
            mode === "native-question"
              ? [
                  {
                    toolCalls: [
                      {
                        id: "assessment-scope",
                        name: "ask_question",
                        input: { prompt: question, allowFreeform: true },
                      },
                    ],
                  },
                  { text: completion },
                ]
              : [{ text: mode === "completed-answer" ? completion : question }];
          const outcome = await runCompiledEveFixture(
            {
              compiledEntry: resolve(
                process.env.EVRY_EVE_COMPILED_ENTRY ??
                  ".output/server/index.mjs"
              ),
              databaseUrl: stack.databaseUrl,
              proxyUrl: stack.proxyUrl,
              sessionToken: m.sessionToken,
              actor: { userId: m.ids.actor, plantId: m.ids.plant },
              turns: [
                "Which assessments have recorded concerns, and when were they entered?",
                { respondIfAsked: reply },
                { respondIfAsked: "Must not submit after completion." },
              ],
              now: m.now,
              maxCostUsd: 1,
              prices: {
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 2,
                maxInputBytes: 500_000,
                maxOutputTokens: 1_000,
              },
              model: { mode: "scripted", responses },
            },
            AbortSignal.timeout(65_000)
          );
          const proof = outcome.runtimeProof;
          assert.ok(proof);
          assert.deepEqual(proof.failures, []);
          assert.deepEqual(outcome.hostCapture.calls, []);
          assert.equal(outcome.hostCapture.outboundMessages, 0);
          assert.deepEqual(store.writesSince(audit, m), []);
          assert.equal(
            outcome.judge,
            null,
            "Scripted protocol proof is not model-quality acceptance"
          );
          const questions = outcome.messages
            .flatMap((message) => message.parts)
            .filter(
              (part) =>
                part.type === "dynamic-tool" &&
                part.toolMetadata?.eve?.inputRequest?.kind === "question"
            );
          const prose = outcome.messages
            .filter((message) => message.role === "assistant")
            .flatMap((message) =>
              message.parts.flatMap((part) =>
                part.type === "text" ? [part.text] : []
              )
            );
          if (mode === "native-question") {
            assert.equal(proof.modelCalls, 2);
            assert.deepEqual(
              proof.questionAnswers,
              [reply],
              "Actual next model request must receive the native freeform answer"
            );
            assert.ok(proof.eventTypes.includes("input.requested"));
            assert.ok(proof.eventTypes.includes("input.resolved"));
            assert.equal(questions.length, 1);
            const pending = questions[0]!;
            assert.equal(pending.type, "dynamic-tool");
            if (pending.type === "dynamic-tool") {
              assert.equal(pending.toolName, "ask_question");
              assert.equal(
                pending.toolMetadata?.eve?.inputRequest?.prompt,
                question
              );
            }
            assert.deepEqual(
              prose,
              [completion],
              "Question is not duplicated as assistant prose"
            );
            assert.equal(outcome.clarificationCount, 1);
            assert.equal(
              outcome.clarificationMeasurement?.observedTurnIds.length,
              1
            );
          } else {
            assert.equal(proof.modelCalls, 1);
            assert.deepEqual(proof.questionAnswers, []);
            assert.equal(proof.eventTypes.includes("input.requested"), false);
            assert.equal(questions.length, 0);
            assert.equal(
              outcome.clarificationCount,
              0,
              "Unmarked prose remains a structural lower bound, not inferred intent"
            );
            assert.equal(
              outcome.clarificationMeasurement?.unmeasuredTurnIds.length,
              1
            );
            assert.deepEqual(
              proof.turnInputs,
              [
                "Which assessments have recorded concerns, and when were they entered?",
              ],
              "Optional reply must not manufacture a second user turn"
            );
          }
          assert.equal(
            proof.turnInputs.includes("Must not submit after completion."),
            false
          );
          assert.equal(
            outcome.answer,
            mode === "unmarked-prose" ? question : completion
          );
          assert.equal(
            store.sql(
              `select count(*) from evry_plan_confirmations where church_id='${m.ids.plant}'`
            ),
            "0"
          );
        });
      }
    } finally {
      await stack.cleanup();
    }
  }
);
