import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import { fixtureMessageSchema } from "@/lib/evry/eve/evals/http/transcript";
import { eveResultMarker } from "@/lib/evry/eve/presentation";
import {
  selectedEveResultReferences,
  projectEveMessage,
} from "@/components/evry/eve-message-projection";
import {
  selectedNotificationId,
  selectedNotificationRequest,
  selectedNotificationSetup,
} from "@/lib/evry/eve/evals/fixtures/selected-notifications";
import type { ProductionEvalRunner } from "@/lib/evry/eve/evals/fixtures/adapter";

const variants = [
  "correct",
  "wrong-three",
  "fourth-added",
  "missing-selected",
  "mark-all",
  "unshown-selection",
  "late-selection",
  "unshown-review",
  "already-read",
  "foreign",
  "visibility-drift",
] as const;
async function assistant(call: CapturedCall, turnId: string, show: boolean) {
  const { collectResult, publicResultArtifacts } =
    await import("@/lib/evry/eve/runtime/results");
  const records = collectResult(
    [],
    { reference: call.id, turnId, capability: call.name },
    z.json().parse(call.output)
  );
  return fixtureMessageSchema.parse({
    id: `${turnId}:${call.id}`,
    role: "assistant",
    metadata: { turnId, status: "complete" },
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
            turnId,
            results: records.map((r) => ({
              reference: r.reference,
              artifacts: publicResultArtifacts(r.artifacts),
            })),
          },
        },
      },
      {
        type: "text",
        text: show ? eveResultMarker(call.id) : "Scripted review not shown.",
      },
    ],
  });
}
test(
  "selected notifications preserve real visible context and exact unexecuted review through the production adapter",
  {
    skip: process.env.EVRY_EVE_SELECTED_NOTIFICATIONS_PROOF !== "1",
    timeout: 300_000,
  },
  async (t) => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
    };
    let external = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error("External fetch prohibited");
        }
        return previous.fetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const store = createFixtureStore(stack.container);
      let variant: (typeof variants)[number] = "correct",
        sequence = 0,
        repetition = 0;
      const runProduction: ProductionEvalRunner = async ({
        scenario,
        registry,
        actor,
        sessionId,
        onPresentResult,
      }) => {
        assert.deepEqual(scenario.turns, [
          selectedNotificationSetup,
          selectedNotificationRequest,
        ]);
        const baseline = store.sql(
          `select jsonb_agg(to_jsonb(n) order by n.id)::text from notifications n where church_id='${actor.plantId}'`
        );
        const calls: CapturedCall[] = [];
        const invoke = async (name: string, input: unknown) => {
          const id = `notification-${sequence++}`,
            output = await registry.invoke(name, input, { callId: id });
          const call = { id, name, input, output };
          calls.push(call);
          return call;
        };
        const setup = await invoke("notifications.query", {
          unreadOnly: true,
          limit: 3,
          offset: variant === "wrong-three" ? 2 : 0,
        });
        const read = capturedReadArtifactSchema.parse(setup.output);
        assert.equal(read.counts.matched, 5);
        assert.equal(read.items.length, 3);
        const shown = await assistant(
          setup,
          "turn_0",
          variant !== "unshown-selection"
        );
        for (const ref of selectedEveResultReferences(shown))
          onPresentResult(ref);
        const user = (id: string, text: string) =>
          fixtureMessageSchema.parse({
            id,
            role: "user",
            parts: [{ type: "text", text }],
          });
        const messages = [
          user("u0", selectedNotificationSetup),
          shown,
          user("u1", selectedNotificationRequest),
        ];
        if (variant === "late-selection") {
          messages.splice(1, 1);
          messages.push(shown);
        }
        let ids = read.items.map((r) => r.id);
        if (variant === "fourth-added") {
          const extra = capturedReadArtifactSchema.parse(
            (
              await invoke("notifications.query", {
                unreadOnly: true,
                limit: 1,
                offset: 3,
              })
            ).output
          );
          ids.push(extra.items[0]!.id);
        }
        if (variant === "missing-selected") ids = ids.slice(0, 2);
        if (variant === "already-read" || variant === "foreign") {
          // Negative control only: known inaccessible IDs never enter the positive strategy.
          const m = createFixtureManifest("notifications-03", repetition);
          assert.equal(m.ids.actor, actor.userId);
          ids[2] = selectedNotificationId(m, variant);
        }
        if (variant === "visibility-drift")
          store.sql(
            `update notification_preferences set enabled=false where user_id='${actor.userId}' and category='tasks' and channel='in_app';`
          );
        const prepared = await invoke("actions.prepare", {
          request:
            variant === "mark-all"
              ? { operation: "notifications.mark_all_read", arguments: {} }
              : {
                  operation: "notifications.mark_selected_read",
                  arguments: { notificationIds: ids },
                },
        });
        const hasReview = z
          .object({ artifacts: z.array(z.object({ kind: z.string() })) })
          .parse(prepared.output)
          .artifacts.some((a) => a.kind === "confirmation");
        if (["already-read", "foreign", "visibility-drift"].includes(variant))
          assert.equal(
            hasReview,
            false,
            "Ineligible selected record must not produce a partial review"
          );
        else
          assert.equal(
            hasReview,
            true,
            "Positive and wrong-cohort controls must reach actual canonical preparation"
          );
        if (hasReview && variant !== "unshown-review") {
          // Confirmations publish automatically, without a model marker. The
          // unshown control omits the entire delivered response, not its prose.
          const final = await assistant(prepared, "turn_1", false);
          messages.push(final);
          for (const ref of selectedEveResultReferences(final))
            onPresentResult(ref);
          if (variant === "correct")
            assert.ok(
              projectEveMessage(final).some(
                (p) =>
                  p.kind === "artifact" && p.artifact.kind === "confirmation"
              )
            );
        }
        assert.equal(
          store.sql(
            `select jsonb_agg(to_jsonb(n) order by n.id)::text from notifications n where church_id='${actor.plantId}'`
          ),
          baseline,
          "Query and preparation never mark or edit notifications"
        );
        return {
          eveSessionId: sessionId,
          messages,
          answer:
            "Scripted selected-notification proof; model quality not reviewed.",
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
      });
      const scenario = questions.find((q) => q.id === "notifications-03")!;
      for (const mode of variants)
        await t.test(mode, async () => {
          variant = mode;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture);
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(45_000),
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
      assert.equal(external, 0);
    } finally {
      globalThis.fetch = previous.fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
    }
  }
);
