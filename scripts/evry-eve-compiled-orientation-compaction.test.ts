import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { regressions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  orientationTemplateExpectations,
  readPreparedOrientationFacts,
} from "@/lib/evry/eve/evals/fixtures/prepared-facts";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import type { CompiledFixtureRequest } from "@/lib/evry/eve/evals/http/process-contract";

type CompactionEvent = {
  type: "compaction.requested" | "compaction.completed";
  turnId: string;
  sequence: number;
};
function assertSuccessfulCompactionOrder(
  events: readonly CompactionEvent[],
  turnId: string
) {
  const completedIndex = events.findIndex(
    (event) => event.type === "compaction.completed" && event.turnId === turnId
  );
  assert.ok(
    completedIndex >= 0,
    JSON.stringify({
      reason: "missing successful compaction",
      turnId,
      compactions: events,
    })
  );
  const completed = events[completedIndex]!;
  // Eve emits both phases with the same turn-step sequence. Arrival order,
  // not numerical sequence growth, proves that the matching request came first.
  const requestedIndex = events.findIndex(
    (event) =>
      event.type === "compaction.requested" &&
      event.turnId === completed.turnId &&
      event.sequence === completed.sequence
  );
  assert.ok(
    requestedIndex >= 0 && requestedIndex < completedIndex,
    JSON.stringify({
      reason: "missing prior matching request",
      requestedIndex,
      completedIndex,
      compactions: events,
    })
  );
}

test("successful compaction pairs the same turn-step sequence in actual arrival order", () => {
  const requested: CompactionEvent = {
    type: "compaction.requested",
    turnId: "turn_2",
    sequence: 7,
  };
  const completed: CompactionEvent = {
    ...requested,
    type: "compaction.completed",
  };
  assertSuccessfulCompactionOrder([requested, completed], "turn_2");
  for (const events of [
    [completed, requested],
    [completed],
    [requested],
    [{ ...requested, sequence: 6 }, completed],
    [{ ...requested, turnId: "turn_1" }, completed],
  ]) {
    assert.throws(() => assertSuccessfulCompactionOrder(events, "turn_2"));
  }
});

test(
  "four original orientation turns retain actual draft state through successful compaction and replace only the subject",
  {
    skip: !process.env.EVRY_COMPACTION_FIXTURE_ENTRY,
    timeout: 240_000,
  },
  async () => {
    const scenario = regressions.find(
      (question) => question.id === "regression-context-retention"
    );
    assert.ok(scenario);
    assert.deepEqual(scenario.turns, [
      "Orientation September 27, 2026, 10am for two hours at Church. Invite core team.",
      "Use the orientation template.",
      "Change its subject to Meet your core team.",
      "Yes, prepare it for review.",
    ]);
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalResendKey = process.env.RESEND_API_KEY;
    const originalNeonEndpoint = neonConfig.fetchEndpoint;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_fixture_never_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      let outboundAttempts = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outboundAttempts++;
          throw new Error(
            "Orientation proof only permits its disposable SQL proxy"
          );
        }
        return originalFetch(input, init);
      };
      const manifest = createFixtureManifest(scenario.id, 0);
      const store = createFixtureStore(stack.container);
      store.seed(manifest);
      const template = orientationTemplateExpectations(manifest, store);
      assert.equal(typeof template.templateSubject, "string");
      assert.equal(typeof template.templateBody, "string");
      const savedTemplate = z
        .object({ subject: z.string(), body: z.string() })
        .parse(
          store.query(
            `select subject,body from message_templates where id='${manifest.ids["orientation-template"]}' and church_id='${manifest.ids.plant}'`
          )[0]
        );
      // Independent expected audience comes from the fixture SQL, not tool arguments.
      const recipientIds = store
        .query(
          `select id from persons where church_id='${manifest.ids.plant}' and deleted_at is null and status in ('core_group','launch_team','leader') order by id`
        )
        .map((row) => z.object({ id: z.uuid() }).parse(row).id);
      assert.deepEqual(
        recipientIds,
        [manifest.ids["core-alex"], manifest.ids["core-jordan"]].sort()
      );
      const facts = {
        meetingType: "orientation",
        title: "Core team orientation",
        date: "2026-09-27",
        time: "10:00",
        durationMinutes: "120",
        audience: "core_team",
        locationId: manifest.ids["church-location"],
        timezone: "America/New_York",
        subject: savedTemplate.subject,
        body: savedTemplate.body,
      };
      const revised = { ...facts, subject: "Meet your core team" };
      type ScriptedResponse = Extract<
        CompiledFixtureRequest["model"],
        { mode: "scripted" }
      >["responses"][number];
      const calls = (
        toolCalls: NonNullable<ScriptedResponse["toolCalls"]>
      ) => ({ toolCalls });
      const getDraft = (id: string) =>
        calls([{ id, name: "draft_get", input: {} }]);
      const prepareFromDraft = (
        callId: string,
        draftCallId: string,
        expectedRevision: number,
        expectedFacts: Record<string, string>
      ) => ({
        taskPreparation: {
          callId,
          draftCallId,
          expectedRevision,
          expectedFacts,
        },
      });
      const model: Extract<
        CompiledFixtureRequest["model"],
        { mode: "scripted" }
      > = {
        mode: "scripted",
        // Intentionally contains no date/time/venue/audience/template. The next
        // preparation must get those values from the actual persisted draft_get.
        compactionSummary:
          "A meeting invitation is being reviewed. Read the saved task notes before continuing. No changes have been executed.",
        responses: [
          calls([
            {
              id: "load-orientation",
              name: "load_skill",
              input: { skill: "meeting-invite" },
            },
          ]),
          calls([
            { id: "saved-venue", name: "locations_query", input: {} },
            {
              id: "saved-audience",
              name: "people_query",
              input: {
                cohort: { all: { audience: "core_team" } },
                result: { mode: "list", limit: 50 },
              },
            },
            {
              id: "saved-template",
              name: "templates_for_meeting",
              input: { meetingType: "orientation" },
            },
          ]),
          calls([
            {
              id: "save-original-draft",
              name: "draft_update",
              input: {
                expectedRevision: 0,
                goal: "Prepare core team orientation and invitations for review",
                facts: Object.entries(facts).map(([key, value]) => ({
                  key,
                  value,
                  source: [
                    "locationId",
                    "subject",
                    "body",
                    "timezone",
                  ].includes(key)
                    ? "record"
                    : "user",
                })),
              },
            },
          ]),
          getDraft("draft-before-first-review"),
          prepareFromDraft("review-a", "draft-before-first-review", 1, facts),
          {
            text: "The orientation invitation is ready for review.\n\n[[evry-result:review-a]]",
          },
          // Turn 2 updates just template choices, exercising merge semantics.
          calls([
            {
              id: "retain-saved-template",
              name: "draft_update",
              input: {
                expectedRevision: 1,
                facts: [
                  { key: "subject", value: facts.subject, source: "record" },
                  { key: "body", value: facts.body, source: "record" },
                ],
              },
            },
          ]),
          {
            // Explicit fixture-only history pressure. It is not a model-quality sample.
            text: "The saved template remains selected. ".repeat(650),
            usage: { inputTokens: 14_000, outputTokens: 6_000 },
          },
          // Turn 3: check retained state before changing anything.
          getDraft("draft-after-compaction"),
          {
            ...calls([
              {
                id: "edit-subject-only",
                name: "draft_update",
                input: {
                  expectedRevision: 2,
                  facts: [
                    { key: "subject", value: revised.subject, source: "user" },
                  ],
                },
              },
            ]),
            assertTaskState: {
              draftCallId: "draft-after-compaction",
              expectedRevision: 2,
              expectedFacts: facts,
            },
          },
          getDraft("draft-after-subject-edit"),
          prepareFromDraft("review-b", "draft-after-subject-edit", 3, revised),
          {
            text: "The subject is updated in the new review.\n\n[[evry-result:review-b]]",
          },
          // Turn 4 is not an execution confirmation or another preparation.
          {
            text: "The updated invitation is ready in the review. Nothing has been sent.",
          },
        ],
      };
      const before = store.auditStart();
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: process.env.EVRY_COMPACTION_FIXTURE_ENTRY!,
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: manifest.sessionToken,
          actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
          turns: scenario.turns,
          now: manifest.now,
          maxCostUsd: 100,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 1_000_000,
            maxOutputTokens: 8_000,
          },
          verifyReplay: true,
          verifyRestart: true,
          model,
        },
        AbortSignal.timeout(180_000)
      );
      assert.deepEqual(outcome.runtimeProof?.turnInputs, scenario.turns);
      assert.deepEqual(outcome.runtimeProof?.failures, []);
      const compactions = outcome.runtimeProof?.compactions ?? [];
      assertSuccessfulCompactionOrder(compactions, "turn_2");
      const requests = outcome.runtimeProof?.modelRequests ?? [];
      const editedRequest = requests.findIndex(
        (request) =>
          request.observedTask?.draftCallId === "draft-after-subject-edit"
      );
      assert.ok(editedRequest >= 0);
      assert.ok(
        requests.some(
          (request) =>
            request.observedTask?.draftCallId === "draft-after-compaction" &&
            request.observedTask.revision === 2
        )
      );
      assert.ok(
        requests
          .slice(0, editedRequest)
          .some((request) => request.compaction === true)
      );
      assert.deepEqual(requests[editedRequest]!.observedTask, {
        draftCallId: "draft-after-subject-edit",
        revision: 3,
        factKeys: Object.keys(facts).sort(),
      });
      const preparations = outcome.hostCapture.calls.filter(
        (call) => call.name === "actions.prepare"
      );
      assert.equal(preparations.length, 2);
      const identity = z.object({
        activePlan: z.object({
          mode: z.literal("set"),
          plan: z.object({ planId: z.uuid(), fingerprint: z.string() }),
        }),
      });
      const a = identity.parse(preparations[0]!.output).activePlan.plan;
      const b = identity.parse(preparations[1]!.output).activePlan.plan;
      assert.notEqual(a.planId, b.planId);
      assert.notEqual(a.fingerprint, b.fingerprint);
      assert.deepEqual(
        store.query(
          `select p.id,s.status from evry_action_plans p join evry_action_plan_states s on s.plan_id=p.id and s.church_id=p.church_id where p.church_id='${manifest.ids.plant}' order by p.id`
        ),
        [
          { id: a.planId, status: "cancelled" },
          { id: b.planId, status: "awaiting_confirmation" },
        ].sort((left, right) => left.id.localeCompare(right.id))
      );
      const actual = await readPreparedOrientationFacts({
        manifest,
        store,
        calls: outcome.hostCapture.calls,
        presented: new Set(outcome.hostCapture.presented),
      });
      assert.deepEqual(actual, {
        meetingType: "orientation",
        localDate: "2026-09-27",
        localTime: "10:00",
        timezone: "America/New_York",
        durationMinutes: 120,
        recipientIds,
        locationId: manifest.ids["church-location"],
        templateSubject: revised.subject,
        templateBody: template.templateBody,
      });
      const [initial, replacement] = [a, b].map(
        (plan) =>
          z
            .object({
              document: z.object({
                steps: z.array(z.object({ arguments: z.unknown() })),
              }),
            })
            .parse(
              store.query(
                `select document from evry_action_plans where id='${plan.planId}' and church_id='${manifest.ids.plant}' and actor_user_id='${manifest.ids.actor}'`
              )[0]
            ).document
      );
      const send = z.object({
        audience: z.object({
          subject: z.string(),
          body: z.unknown(),
          recipients: z.array(z.object({ personId: z.uuid() })),
        }),
      });
      const originalSend = send.parse(initial.steps[2]!.arguments);
      const editedSend = send.parse(replacement.steps[2]!.arguments);
      const meeting = z.object({
        type: z.string(),
        title: z.string(),
        datetime: z.string(),
        timezone: z.string(),
        durationMinutes: z.number(),
        locationId: z.string(),
      });
      assert.deepEqual(
        meeting.parse(replacement.steps[0]!.arguments),
        meeting.parse(initial.steps[0]!.arguments)
      );
      assert.equal(originalSend.audience.subject, savedTemplate.subject);
      assert.equal(editedSend.audience.subject, revised.subject);
      assert.deepEqual(editedSend.audience.body, originalSend.audience.body);
      assert.deepEqual(
        editedSend.audience.recipients.map((person) => person.personId).sort(),
        originalSend.audience.recipients.map((person) => person.personId).sort()
      );
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const route = await import("@/app/api/evry/eve/plans/[planId]/route");
      const stale = await withAuthenticatedSessionId(manifest.sessionId, () =>
        route.POST(
          new Request(
            `http://eve-fixture.test/api/evry/eve/plans/${a.planId}`,
            {
              method: "POST",
              headers: {
                origin: "http://eve-fixture.test",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                action: "confirm",
                fingerprint: a.fingerprint,
              }),
            }
          ),
          { params: Promise.resolve({ planId: a.planId }) }
        )
      );
      assert.equal(stale.status, 409, await stale.text());
      assert.deepEqual(
        store.query(
          `select (select count(*)::int from evry_plan_confirmations where church_id='${manifest.ids.plant}') confirmations,(select count(*)::int from evry_execution_attempts where church_id='${manifest.ids.plant}') attempts`
        ),
        [{ confirmations: 0, attempts: 0 }]
      );
      assert.equal(store.writesSince(before, manifest).length, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.equal(outboundAttempts, 0);
      // This scripted provider reports deliberate token usage to trigger real
      // compaction/budget logic. Prices therefore produce synthetic accounting,
      // not provider spend. The worker permits paid providers only in live mode.
      const syntheticCost = outcome.hostCapture.modelCalls.reduce(
        (total, call) => {
          assert.notEqual(call.inputTokens, null);
          assert.notEqual(call.outputTokens, null);
          const cost = (call.inputTokens! + 2 * call.outputTokens!) / 1_000_000;
          assert.ok(Math.abs((call.costUsd ?? -1) - cost) < 1e-10);
          return total + cost;
        },
        0
      );
      assert.ok(syntheticCost > 0);
      assert.ok(Math.abs(outcome.costUsd - syntheticCost) < 1e-10);
      assert.equal(outcome.hostCapture.costBasis, "provider_usage");
      assert.equal(
        outcome.runtimeProof?.modelRequests?.length,
        outcome.hostCapture.modelCalls.length
      );
      assert.equal(outcome.judge, null);
      assert.equal(outcome.clarificationCount, 0);
      assert.equal(outcome.replay?.matchingTranscript, true);
      assert.equal(outcome.restart?.matchingTranscript, true);
      assert.equal(outcome.restart?.modelCalls, 0);
      assert.equal(outcome.restart?.capturedCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = originalNeonEndpoint;
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResendKey;
      await stack.cleanup();
    }
  }
);
