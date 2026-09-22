import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";

test(
  "current-session status reads real preparation and confirmed task outcomes without effects",
  {
    skip: process.env.EVRY_EVE_ACTION_STATUS_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    const originalDatabase = process.env.DATABASE_URL;
    const originalResend = process.env.RESEND_API_KEY;
    const originalEndpoint = neonConfig.fetchEndpoint;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      let externalRequests = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          externalRequests++;
          throw new Error("External requests are forbidden in status proof");
        }
        return originalFetch(input, init);
      };
      const store = createFixtureStore(stack.container);
      const manifest = createFixtureManifest("actions-status-proof", 0);
      store.seed(manifest);
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const { requireEvryPlantViewerForSession } =
        await import("@/lib/evry/eligibility/viewer");
      const { createBoundEveRegistry } =
        await import("@/lib/evry/eve/runtime/registry");
      const { evryReviewState } =
        await import("@/lib/evry/eve/runtime/review-state");
      const { evryTurnInput } =
        await import("@/lib/evry/eve/runtime/task-state");
      const { eveSessionStore, getEveSession } =
        await import("@/lib/evry/eve/runtime/session-store");
      const routes = await import("@/app/api/evry/eve/plans/[planId]/route");
      const { evryConversationPlanIdentitySchema } =
        await import("@/lib/evry/conversations/contract");
      const { createCompositionBudget, runEvryComposition } =
        await import("@/lib/evry/eve/composition/runner");
      const actor = await requireEvryPlantViewerForSession(manifest.sessionId);
      const eveSessionId = randomUUID();
      await eveSessionStore.register(eveSessionId, actor);
      const session = await getEveSession(eveSessionId, actor);
      assert.ok(session);
      const scope = {
        actor,
        appSessionId: manifest.sessionId,
        eveSessionId,
        conversationId: session.conversationId,
        turnId: randomUUID(),
      };
      // The pinned native context exercises defineState, not durable Workflow restart.
      const contextEntry = createRequire(import.meta.url).resolve(
        "eve/context"
      );
      const { ContextContainer, contextStorage } = await import(
        pathToFileURL(join(dirname(contextEntry), "../../context/container.js"))
          .href
      );
      const lifecycleTables = [
        "evry_action_plans",
        "evry_action_plan_states",
        "evry_plan_confirmations",
        "evry_product_audit_events",
        "evry_execution_attempts",
        "evry_execution_effect_claims",
        "evry_execution_outcomes",
      ];
      // Compare hashes, not private stored arguments or recipients in test output.
      const lifecycleSnapshot = () =>
        store.query(
          lifecycleTables
            .map(
              (table) =>
                `select '${table}' as name,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) as digest from ${table} t`
            )
            .join(" union all ")
        );
      await contextStorage.run(new ContextContainer(), async () =>
        withAuthenticatedSessionId(manifest.sessionId, async () => {
          evryTurnInput.update(() => ({
            text: "Complete my selected task.",
            receivedAt: new Date().toISOString(),
            pageContext: null,
          }));
          const registry = createBoundEveRegistry(scope);
          const read = async (suffix: string) => {
            const before = store.auditStart();
            const lifecycle = lifecycleSnapshot();
            const pointer = evryReviewState.get();
            const result = await registry.invoke(
              "actions.status",
              {},
              { callId: `status-${suffix}` }
            );
            assert.deepEqual(store.writesSince(before, manifest), []);
            assert.deepEqual(lifecycleSnapshot(), lifecycle);
            assert.deepEqual(evryReviewState.get(), pointer);
            assert.doesNotMatch(
              JSON.stringify(result),
              /fingerprint|planId|actorUserId|recipients|provider|contentPreviews|resolvedTargets|sourceLinks/
            );
            return result;
          };
          const prepare = async (key: string) => {
            const before = store.auditStart();
            const result = await registry.invoke(
              "actions.prepare",
              {
                request: {
                  operation: "tasks.bulk.complete",
                  arguments: { taskIds: [manifest.ids["task-today"]] },
                },
              },
              { callId: key }
            );
            const pointer = evryReviewState.get();
            assert.ok(pointer, JSON.stringify(result));
            assert.deepEqual(store.writesSince(before, manifest), []);
            return pointer;
          };
          const post = (
            plan: { planId: string; fingerprint: string },
            action: "confirm" | "cancel" | "retry"
          ) =>
            routes.POST(
              new Request(
                `http://status-fixture.test/api/evry/eve/plans/${plan.planId}`,
                {
                  method: "POST",
                  headers: {
                    origin: "http://status-fixture.test",
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    action,
                    fingerprint: plan.fingerprint,
                  }),
                }
              ),
              { params: Promise.resolve({ planId: plan.planId }) }
            );
          await t.test(
            "no current pointer cannot claim that nothing happened",
            async () => {
              assert.deepEqual(await read("empty"), { status: "unavailable" });
            }
          );
          const initial = await prepare("status-prepare-cancel");
          await t.test(
            "planned counts are distinct from completion and cancellation remains visible",
            async () => {
              const planned = z
                .object({
                  status: z.literal("available"),
                  lifecycle: z.literal("awaiting_confirmation"),
                  evidence: z.literal("confirmation"),
                  plannedSteps: z.array(z.unknown()).min(1),
                })
                .parse(await read("planned"));
              assert.equal("steps" in planned, false);
              assert.equal((await post(initial.plan, "cancel")).status, 200);
              assert.equal(
                z
                  .object({ lifecycle: z.string() })
                  .parse(await read("cancelled")).lifecycle,
                "cancelled"
              );
            }
          );
          const current = await prepare("status-prepare-complete");
          await t.test(
            "exact confirmed production action is reported through repeated direct and composed reads",
            async () => {
              const response = await post(current.plan, "confirm");
              assert.equal(
                response.status,
                200,
                JSON.stringify(await response.clone().json())
              );
              assert.deepEqual(
                store.query(
                  `select status from tasks where id='${manifest.ids["task-today"]}' and church_id='${actor.plantId}'`
                ),
                [{ status: "complete" }]
              );
              const first = await read("completed");
              const parsed = z
                .object({
                  status: z.literal("available"),
                  lifecycle: z.literal("completed"),
                  evidence: z.literal("result"),
                  steps: z
                    .array(
                      z.object({
                        status: z.literal("completed"),
                        recordedAffectedCount: z.number().int().positive(),
                      })
                    )
                    .min(1),
                })
                .parse(first);
              assert.ok(parsed.steps.length);
              assert.deepEqual(await read("replayed"), first);
              const before = store.auditStart();
              const lifecycle = lifecycleSnapshot();
              assert.deepEqual(
                await runEvryComposition({
                  registry,
                  callId: "status-code",
                  budget: createCompositionBudget(),
                  js: `return await tools["actions.status"]({});`,
                }),
                { status: "completed", calls: 1, output: first }
              );
              assert.deepEqual(store.writesSince(before, manifest), []);
              assert.deepEqual(lifecycleSnapshot(), lifecycle);
            }
          );
          await t.test(
            "model IDs cannot select an older review and tampered fingerprint cannot read",
            async () => {
              assert.deepEqual(
                await registry.invoke("actions.status", {
                  planId: initial.plan.planId,
                }),
                { status: "invalid_input" }
              );
              evryReviewState.update(() => ({
                ...current,
                plan: evryConversationPlanIdentitySchema.parse({
                  ...current.plan,
                  fingerprint: "f".repeat(64),
                }),
              }));
              assert.deepEqual(await read("wrong-fingerprint"), {
                status: "unavailable",
              });
              evryReviewState.update(() => current);
              await contextStorage.run(new ContextContainer(), async () => {
                evryTurnInput.update(() => ({
                  text: "What happened?",
                  receivedAt: new Date().toISOString(),
                  pageContext: null,
                }));
                assert.deepEqual(
                  await createBoundEveRegistry(scope).invoke(
                    "actions.status",
                    {}
                  ),
                  { status: "unavailable" },
                  "a fresh native state has no earlier review fallback"
                );
              });
            }
          );
          await t.test(
            "a durable launch claim remains unknown until explicit retry completes its real downstream work",
            async () => {
              const { addCalendarDays, toCalendarDate } =
                await import("@/lib/datetime");
              const { LAUNCH_MILESTONE_TEMPLATES } =
                await import("@/lib/launch/milestones");
              const { parseTargetDate } =
                await import("@/lib/launch/countdown");
              const targetDate = addCalendarDays(
                parseTargetDate(toCalendarDate(new Date(), manifest.timeZone)),
                42
              );
              evryTurnInput.update(() => ({
                text: "Move Launch Sunday to the reviewed date.",
                receivedAt: new Date().toISOString(),
                pageContext: null,
              }));
              const launchRegistry = createBoundEveRegistry({
                ...scope,
                turnId: randomUUID(),
              });
              const beforePrepare = store.auditStart();
              const prepared = await launchRegistry.invoke(
                "actions.prepare",
                {
                  request: {
                    operation: "launch.schedule",
                    arguments: {
                      targetDate,
                      postpone: false,
                      note: "Isolated status recovery proof",
                    },
                  },
                },
                { callId: "status-launch-prepare" }
              );
              const launchReview = evryReviewState.get();
              assert.ok(launchReview, JSON.stringify(prepared));
              assert.equal(launchReview.callId, "status-launch-prepare");
              assert.deepEqual(store.writesSince(beforePrepare, manifest), []);
              const launchRows = () =>
                store.query(
                  `select id::text,target_date::text,status from launches where church_id='${actor.plantId}' order by id`
                );
              const milestoneRows = () =>
                store.query(
                  `select id::text,template_key from launch_milestones where church_id='${actor.plantId}' order by id`
                );
              const linkedTaskRows = () =>
                store.query(
                  `select t.id::text,t.status,link.milestone_id::text from launch_milestone_tasks link join tasks t on t.id=link.task_id and t.church_id=link.church_id where link.church_id='${actor.plantId}' order by t.id`
                );
              const claimRows = () =>
                store.query(
                  `select id::text,attempt_id::text,effect_key,affected_count,excluded_count from evry_execution_effect_claims where plan_id='${launchReview.plan.planId}' and church_id='${actor.plantId}' order by id`
                );
              const outcomeRows = () =>
                store.query(
                  `select subject,status,affected_count,excluded_count from evry_execution_outcomes where plan_id='${launchReview.plan.planId}' and church_id='${actor.plantId}' order by subject`
                );
              const milestonesBefore = milestoneRows();
              const tasksBefore = linkedTaskRows();
              const launchBefore = launchRows();
              assert.equal(launchBefore.length, 1);
              assert.notEqual(launchBefore[0]?.target_date, targetDate);
              assert.deepEqual(claimRows(), []);
              assert.deepEqual(outcomeRows(), []);

              // Real downstream SQL fails after the launch mutation and effect claim have committed.
              // The trigger is tenant-scoped and exists only in this suite's disposable database.
              store.sql(`create function eve_status_fail_launch_seed() returns trigger language plpgsql as $$ begin raise exception 'isolated post-claim seed failure'; end $$;
                create trigger eve_status_fail_launch_seed before insert on launch_milestones for each row
                when (new.church_id='${actor.plantId}'::uuid) execute function eve_status_fail_launch_seed();`);
              try {
                const interrupted = await post(launchReview.plan, "confirm");
                assert.equal(
                  interrupted.status,
                  200,
                  JSON.stringify(await interrupted.clone().json())
                );
                assert.equal(
                  z
                    .object({ artifact: z.object({ kind: z.string() }) })
                    .parse(await interrupted.json()).artifact.kind,
                  "progress"
                );
                assert.deepEqual(launchRows(), [
                  {
                    ...launchBefore[0],
                    target_date: targetDate,
                    status: "scheduled",
                  },
                ]);
                assert.equal(
                  claimRows().length,
                  1,
                  "the real domain effect is already durably claimed"
                );
                assert.deepEqual(
                  outcomeRows(),
                  [],
                  "neither a completed step nor a terminal attempt has been recorded"
                );
                assert.deepEqual(milestoneRows(), milestonesBefore);
                assert.deepEqual(linkedTaskRows(), tasksBefore);
                const unresolvedSchema = z.object({
                  status: z.literal("available"),
                  lifecycle: z.literal("executing"),
                  evidence: z.literal("progress"),
                  steps: z
                    .array(
                      z.object({
                        status: z.literal("safe_retry"),
                        recordedAffectedCount: z.null(),
                        recordedExcludedCount: z.null(),
                      })
                    )
                    .length(1),
                });
                const unresolved = unresolvedSchema.parse(
                  await read("launch-interrupted")
                );
                assert.equal("outcome" in unresolved, false);
                unresolvedSchema.parse(await read("launch-interrupted-again"));
              } finally {
                store.sql(
                  "drop trigger if exists eve_status_fail_launch_seed on launch_milestones; drop function if exists eve_status_fail_launch_seed();"
                );
              }
              const claimed = claimRows();
              assert.equal(claimed.length, 1);
              // Even after the fault disappears, a read must not resume an executor.
              const stillUnresolved = z
                .object({
                  lifecycle: z.literal("executing"),
                  steps: z
                    .array(
                      z.object({
                        status: z.literal("safe_retry"),
                        recordedAffectedCount: z.null(),
                      })
                    )
                    .length(1),
                })
                .parse(await read("launch-fault-cleared"));
              assert.equal(
                stillUnresolved.steps[0]?.recordedAffectedCount,
                null
              );
              assert.deepEqual(milestoneRows(), milestonesBefore);
              assert.deepEqual(linkedTaskRows(), tasksBefore);
              assert.deepEqual(outcomeRows(), []);
              const recovered = await post(launchReview.plan, "retry");
              assert.equal(
                recovered.status,
                200,
                JSON.stringify(await recovered.clone().json())
              );
              assert.equal(
                z
                  .object({ artifact: z.object({ kind: z.string() }) })
                  .parse(await recovered.json()).artifact.kind,
                "result"
              );
              const completed = z
                .object({
                  lifecycle: z.literal("completed"),
                  evidence: z.literal("result"),
                  steps: z
                    .array(
                      z.object({
                        status: z.literal("completed"),
                        recordedAffectedCount: z.number().int().positive(),
                      })
                    )
                    .length(1),
                })
                .parse(await read("launch-recovered"));
              assert.equal(
                completed.steps[0]?.recordedAffectedCount,
                claimed[0]?.affected_count
              );
              assert.deepEqual(
                claimRows(),
                claimed,
                "recovery retains the original effect key and attempt"
              );
              assert.deepEqual(
                outcomeRows().map(({ subject, status }) => ({
                  subject,
                  status,
                })),
                [
                  { subject: "attempt", status: "completed" },
                  { subject: "step", status: "completed" },
                ]
              );
              assert.equal(
                milestoneRows().length,
                milestonesBefore.length + LAUNCH_MILESTONE_TEMPLATES.length
              );
              assert.equal(
                linkedTaskRows().length,
                tasksBefore.length +
                  LAUNCH_MILESTONE_TEMPLATES.reduce(
                    (sum, milestone) => sum + milestone.tasks.length,
                    0
                  )
              );
              const finished = {
                launch: launchRows(),
                milestones: milestoneRows(),
                tasks: linkedTaskRows(),
                claims: claimRows(),
                outcomes: outcomeRows(),
              };
              const beforeReplay = store.auditStart();
              assert.equal(
                (await post(launchReview.plan, "retry")).status,
                200
              );
              assert.deepEqual(
                {
                  launch: launchRows(),
                  milestones: milestoneRows(),
                  tasks: linkedTaskRows(),
                  claims: claimRows(),
                  outcomes: outcomeRows(),
                },
                finished
              );
              assert.deepEqual(
                store.writesSince(beforeReplay, manifest),
                [],
                "a repeated exact retry creates no duplicate domain effects"
              );
            }
          );
          await t.test(
            "foreign ownership, archived sessions and revoked authentication refuse",
            async () => {
              const foreign = createFixtureManifest(
                "actions-status-foreign",
                0
              );
              store.seed(foreign);
              const foreignActor = await requireEvryPlantViewerForSession(
                foreign.sessionId
              );
              const foreignRegistry = createBoundEveRegistry({
                ...scope,
                actor: foreignActor,
                appSessionId: foreign.sessionId,
              });
              assert.deepEqual(
                await foreignRegistry.invoke("actions.status", {}),
                { status: "unavailable" }
              );
              const wrongAccount = createBoundEveRegistry({
                ...scope,
                appSessionId: foreign.sessionId,
              });
              assert.deepEqual(
                await wrongAccount.invoke("actions.status", {}),
                { status: "unavailable" }
              );
              store.sql(
                `update evry_eve_sessions set archived_at=now() where id='${eveSessionId}'`
              );
              assert.deepEqual(await read("archived"), {
                status: "unavailable",
              });
              store.sql(
                `update evry_eve_sessions set archived_at=null where id='${eveSessionId}'`
              );
              store.revoke(manifest);
              assert.deepEqual(await read("revoked"), {
                status: "unavailable",
              });
              store.revoke(foreign);
            }
          );
          assert.equal(externalRequests, 0, "no provider or paid model calls");
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = originalEndpoint;
      if (originalDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabase;
      if (originalResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResend;
      await stack.cleanup();
    }
  }
);
