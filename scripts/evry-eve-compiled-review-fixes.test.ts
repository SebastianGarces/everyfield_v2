import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { neonConfig } from "@neondatabase/serverless";
import { projectEveMessage } from "@/components/evry/eve-message-projection";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import type { CompiledFixtureRequest } from "@/lib/evry/eve/evals/http/process-contract";

test(
  "compiled parallel reads retain both cards and selected notifications produce one exact, unexecuted review",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 240_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      endpoint: neonConfig.fetchEndpoint,
    };
    try {
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("compiled-review-fixes", 0);
      store.seed(m);
      const notificationIds = [1, 2, 3, 4, 5].map(
        (n) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`
      );
      store.sql(
        `insert into notifications(id,church_id,recipient_user_id,category,type,title,body,scheduled_for) values ${notificationIds.map((id, index) => `('${id}','${m.ids.plant}','${index === 4 ? m.ids["other-actor"] : m.ids.actor}','tasks','task.fixture','Fixture ${index}','Test notification','2026-09-19')`).join(",")};`
      );
      process.env.DATABASE_URL = stack.databaseUrl;
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const { requireEvryPlantViewerForSession } =
        await import("@/lib/evry/eligibility/viewer");
      const { authorizeEvryReadCapability } =
        await import("@/lib/evry/eligibility/capabilities");
      const { createEvePreparation } =
        await import("@/lib/evry/eve/preparation");
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      await withAuthenticatedSessionId(m.sessionId, () =>
        createEvePreparation({
          actor,
          conversationId: "92000000-0000-4000-8000-000000000001",
          userRequestKey: "92000000-0000-4000-8000-000000000002",
          literalUserText: "Mark selected notifications read",
          pageContext: null,
          now: FIXTURE_NOW,
          authorizeRead: authorizeEvryReadCapability,
        }).prepare(
          {
            request: {
              operation: "notifications.mark_selected_read",
              arguments: { notificationIds: notificationIds.slice(0, 3) },
            },
          },
          { callId: "direct-selected" }
        )
      );
      const run = (
        responses: Extract<
          CompiledFixtureRequest["model"],
          { mode: "scripted" }
        >["responses"]
      ) =>
        runCompiledEveFixture(
          {
            compiledEntry: resolve(".output/server/index.mjs"),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            sessionToken: m.sessionToken,
            actor: { userId: m.ids.actor, plantId: m.ids.plant },
            turns: ["Review the requested records"],
            now: FIXTURE_NOW.toISOString(),
            maxCostUsd: 1,
            prices: {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 2,
              maxInputBytes: 500000,
              maxOutputTokens: 1000,
            },
            model: { mode: "scripted", responses },
          },
          AbortSignal.timeout(120000)
        );
      const parallel = await run([
        {
          toolCalls: [
            {
              id: "load-reads",
              name: "load_tools",
              input: { names: ["tasks.query", "meetings.query"] },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "read-tasks",
              name: "tasks_query",
              input: { query: { mode: "list" } },
            },
            {
              id: "read-meetings",
              name: "meetings_query",
              input: { query: { mode: "list" } },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "show-tasks",
              name: "present_result",
              input: { reference: "read-tasks" },
            },
            {
              id: "show-meetings",
              name: "present_result",
              input: { reference: "read-meetings" },
            },
          ],
        },
        { text: "Here are the tasks and meetings." },
      ]);
      const cards = parallel.messages
        .flatMap(projectEveMessage)
        .filter((p) => p.kind === "artifact");
      assert.equal(
        cards.length,
        2,
        JSON.stringify(parallel.hostCapture.presented)
      );
      assert.ok(!JSON.stringify(cards).includes("modelOnly"));
      for (const includeForeign of [false, true]) {
        const selected = includeForeign
          ? [notificationIds[0]!, notificationIds[4]!]
          : notificationIds.slice(0, 3);
        const result = await run([
          {
            toolCalls: [
              {
                id: "load-preparation",
                name: "load_tools",
                input: { names: ["actions.prepare"] },
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "prepare-selected",
                name: "actions_prepare",
                input: {
                  request: {
                    operation: "notifications.mark_selected_read",
                    arguments: { notificationIds: selected },
                  },
                },
              },
            ],
          },
          { text: "Review the selected notifications before changing them." },
        ]);
        const reviews = result.messages
          .flatMap(projectEveMessage)
          .filter(
            (p) => p.kind === "artifact" && p.artifact.kind === "confirmation"
          );
        assert.equal(
          reviews.length,
          includeForeign ? 0 : 1,
          JSON.stringify({
            calls: result.hostCapture.calls,
            visible: result.messages.flatMap(projectEveMessage),
            failures: result.runtimeProof?.failures,
          })
        );
        const review = reviews[0];
        if (
          review?.kind === "artifact" &&
          review.artifact.kind === "confirmation" &&
          "steps" in review.artifact
        )
          assert.equal(review.artifact.steps.length, 3);
        assert.equal(result.hostCapture.outboundMessages, 0);
        assert.equal(
          Number(
            store.sql(
              `select count(*) from notifications where church_id='${m.ids.plant}' and read_at is not null`
            )
          ),
          0
        );
      }
    } finally {
      process.env.DATABASE_URL = previous.database;
      neonConfig.fetchEndpoint = previous.endpoint;
      await stack.cleanup();
    }
  }
);
