import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { neon, neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import type { EvryCommunicationMailer } from "@/lib/communication/evry-send";

test(
  "failed recipient retries use actual confirmation, executor, SQL claims and frozen provider payloads",
  {
    skip: process.env.EVRY_EVE_FAILED_RETRY_PROOF !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
    };
    let externalCalls = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          externalCalls++;
          throw new Error("External requests prohibited");
        }
        return previous.fetch(input, init);
      };
      const [
        messages,
        { withAuthenticatedSessionId },
        { requireEvryPlantViewerForSession },
        { confirmEvryActionPlan, mintEvryPlanRequestKey },
        { executeEvryActionPlan, createEvryExecutionCapabilityRegistry },
        { resolveFailedCommunicationSource },
      ] = await Promise.all([
        import("@/lib/evry/capabilities/communication/messages"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/plans"),
        import("@/lib/evry/executor"),
        import("@/lib/communication/failed-retry"),
      ]);
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("communication-06", 100);
      store.seed(m);
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const scoped = <T>(run: () => Promise<T>) =>
        withAuthenticatedSessionId(m.sessionId, run);
      const cohort = (
        specs: readonly {
          status?: string;
          origin?: boolean;
          delivered?: boolean;
          suppressed?: boolean;
          deleted?: boolean;
          foreign?: boolean;
          external?: boolean;
        }[] = [{}],
        parentStatus = "sent"
      ) => {
        const id = randomUUID();
        store.sql(`insert into communications(id,church_id,subject,body,channel,meeting_id,status,created_by_id)
        values('${id}','${m.ids.plant}','Invitation to {{meeting_title}}','Hi {{first_name}}, please join {{meeting_title}}.
{{confirm_link}}
{{decline_link}}','email','${m.ids["meeting-upcoming"]}','${parentStatus}','${m.ids.actor}')`);
        const recipients = specs.map((spec) => {
          const personId = randomUUID(),
            recipientId = randomUUID(),
            email = `${personId}@example.test`;
          const church = spec.foreign ? m.ids["foreign-plant"] : m.ids.plant;
          store.sql(`insert into persons(id,church_id,first_name,last_name,email,status,created_by,deleted_at)
          values('${personId}','${church}','Retry','Guest','${email}','core_group','${spec.foreign ? m.ids["foreign-actor"] : m.ids.actor}',${spec.deleted ? "now()" : "null"});
          insert into communication_recipients(id,church_id,communication_id,person_id,email,channel,status,external_id,failure_origin,delivered_at)
          values('${recipientId}','${church}','${id}','${personId}','${email}','email','${spec.status ?? "failed"}',${spec.external === false ? "null" : `'provider-${recipientId}'`},${spec.origin === false ? "null" : "'provider_delivery_failed'"},${spec.delivered ? "now()" : "null"});
          ${spec.suppressed ? `insert into email_suppressions(email,reason) values('${email}','hard_bounce');` : ""}`);
          return { id: recipientId, personId, email };
        });
        return { id, recipients };
      };
      const prepare = (id: string, recipientIds?: readonly string[]) =>
        scoped(() =>
          messages.proposeCommunicationEvryMessageEffect({
            actor,
            pageContext: null,
            selection: {
              kind: "retry_failed",
              communicationId: id,
              recipientIds,
            },
            requestKey: mintEvryPlanRequestKey(),
            now: new Date(),
          })
        );
      type Prepared = Extract<
        Awaited<ReturnType<typeof prepare>>,
        { kind: "plan" }
      >;
      const planFor = async (
        id: string,
        recipientIds?: readonly string[]
      ): Promise<Prepared> => {
        const p = await prepare(id, recipientIds);
        assert.equal(p.kind, "plan");
        return p;
      };
      const confirm = (p: Prepared, fingerprint: string = p.plan.fingerprint) =>
        scoped(() =>
          confirmEvryActionPlan({
            actor,
            planId: p.plan.planId,
            fingerprint,
            decidedAt: new Date(),
            registry: messages.COMMUNICATION_MESSAGE_PLAN_REGISTRY,
          })
        );
      const execute = (p: Prepared, mailer: EvryCommunicationMailer) =>
        scoped(() =>
          executeEvryActionPlan({
            actor,
            ...p.plan,
            registry: createEvryExecutionCapabilityRegistry(
              messages.createCommunicationEvryMessageExecutions({ mailer })
                .registrations
            ),
          })
        );
      const calls: Parameters<EvryCommunicationMailer["send"]>[0][] = [];
      const mailer: EvryCommunicationMailer = {
        async send(input) {
          calls.push(input);
          return { status: "accepted", providerId: `accepted-${randomUUID()}` };
        },
      };
      const sentBefore = () =>
        Number(store.sql("select count(*) from communication_failed_retries"));

      await t.test(
        "only a verified provider failure creates retry provenance; late failure never erases delivery evidence",
        async () => {
          const { POST } = await import("@/app/api/webhooks/resend/route");
          const { NextRequest } = await import("next/server");
          const secret = Buffer.from(
            "isolated-failed-retry-webhook-secret"
          ).toString("base64");
          const old = process.env.RESEND_WEBHOOK_SECRET;
          process.env.RESEND_WEBHOOK_SECRET = `whsec_${secret}`;
          try {
            const c = cohort([
              { status: "sent", origin: false },
              { status: "delivered", origin: false, delivered: true },
            ]);
            const event = async (
              recipient: (typeof c.recipients)[number],
              valid: boolean
            ) => {
              const body = JSON.stringify({
                type: "email.failed",
                created_at: new Date().toISOString(),
                data: {
                  email_id: `provider-${recipient.id}`,
                  from: "church@example.test",
                  to: [recipient.email],
                  subject: "Invitation",
                },
              });
              const id = randomUUID(),
                timestamp = String(Math.floor(Date.now() / 1000));
              const signature = createHmac(
                "sha256",
                Buffer.from(secret, "base64")
              )
                .update(`${id}.${timestamp}.${body}`)
                .digest("base64");
              return POST(
                new NextRequest("http://fixture.invalid/api/webhooks/resend", {
                  method: "POST",
                  body,
                  headers: {
                    "svix-id": id,
                    "svix-timestamp": timestamp,
                    "svix-signature": `v1,${valid ? signature : "invalid"}`,
                  },
                })
              );
            };
            assert.equal((await event(c.recipients[0]!, false)).status, 400);
            assert.equal(
              await resolveFailedCommunicationSource({
                churchId: m.ids.plant,
                communicationId: c.id,
              }),
              null
            );
            assert.equal((await event(c.recipients[0]!, true)).status, 200);
            assert.equal((await event(c.recipients[1]!, true)).status, 200);
            const source = await resolveFailedCommunicationSource({
              churchId: m.ids.plant,
              communicationId: c.id,
            });
            assert.deepEqual(
              source?.source.recipients.map((r) => r.id),
              [c.recipients[0]!.id]
            );
            assert.equal(
              store.sql(
                `select count(*) from communication_recipients where id='${c.recipients[1]!.id}' and delivered_at is not null`
              ),
              "1"
            );
          } finally {
            if (old === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
            else process.env.RESEND_WEBHOOK_SECRET = old;
          }
        }
      );

      await t.test(
        "decline, stale fingerprint, expired review and foreign actor never send",
        async () => {
          const { cancelExactEvryActionPlan } =
            await import("@/lib/evry/plans/repository");
          const c = cohort(),
            p = await planFor(c.id),
            before = sentBefore();
          assert.equal(
            await cancelExactEvryActionPlan({
              actorUserId: actor.userId,
              plantId: actor.plantId,
              ...p.plan,
              cancelledAt: new Date(),
            }),
            true
          );
          assert.equal((await execute(p, mailer)).status, "unavailable");
          assert.equal(calls.length, 0);
          assert.equal(sentBefore(), before);
          const expired = await planFor(c.id);
          assert.equal(
            (
              await confirmEvryActionPlan({
                actor,
                ...expired.plan,
                decidedAt: new Date(Date.now() + 24 * 60 * 60_000),
                registry: messages.COMMUNICATION_MESSAGE_PLAN_REGISTRY,
              })
            ).status,
            "expired"
          );
          const exact = await planFor(c.id),
            sessionId = randomUUID().replaceAll("-", "").repeat(2);
          store.sql(
            `insert into sessions(id,user_id,expires_at) values('${sessionId}','${m.ids["foreign-actor"]}',now()+interval '1 hour')`
          );
          const foreign = await requireEvryPlantViewerForSession(sessionId);
          assert.equal(
            (
              await confirmEvryActionPlan({
                actor: foreign,
                ...exact.plan,
                decidedAt: new Date(),
                registry: messages.COMMUNICATION_MESSAGE_PLAN_REGISTRY,
              })
            ).status,
            "unavailable"
          );
          store.sql(`delete from sessions where id='${sessionId}'`);
          assert.equal(calls.length, 0);
          assert.equal(sentBefore(), before);
          assert.equal((await prepare(c.id, [randomUUID()])).kind, "refusal");
        }
      );

      await t.test(
        "mixed cohort, exact source review, no work before confirmation, wrong confirmation",
        async () => {
          const c = cohort(
            [
              {},
              { status: "delivered", delivered: true },
              { status: "opened" },
              { status: "bounced" },
              { status: "pending", origin: false },
              { origin: false },
              { suppressed: true },
              { deleted: true },
              { foreign: true },
              { delivered: true },
              { external: false },
            ],
            "failed"
          );
          const source = await resolveFailedCommunicationSource({
            churchId: m.ids.plant,
            communicationId: c.id,
          });
          assert.deepEqual(
            source?.source.recipients.map((r) => r.id),
            [c.recipients[0]!.id]
          );
          assert.equal(
            source?.excludedCount,
            9,
            "foreign rows do not contribute to local exclusions"
          );
          const before = sentBefore(),
            p = await planFor(c.id);
          assert.match(JSON.stringify(p.confirmation), /Retry 1 failed email/);
          assert.match(
            JSON.stringify(p.confirmation),
            new RegExp(c.recipients[0]!.email)
          );
          assert.match(
            JSON.stringify(p.confirmation),
            new RegExp(`/communication/${c.id}`)
          );
          assert.equal(sentBefore(), before);
          assert.equal(calls.length, 0);
          assert.equal((await execute(p, mailer)).status, "unavailable");
          assert.equal(
            (await confirm(p, "0".repeat(64))).status,
            "unavailable"
          );
          assert.equal(calls.length, 0);
          assert.equal((await confirm(p)).status, "approved");
          assert.equal((await execute(p, mailer)).status, "completed");
          assert.equal(calls.length, 1);
          assert.equal(calls[0]!.to, c.recipients[0]!.email);
          assert.match(calls[0]!.subject, /Next orientation/);
          assert.match(calls[0]!.html, /Retry/);
          assert.match(calls[0]!.html, /\/rsvp\/[A-Za-z0-9_-]+/);
          assert.match(calls[0]!.text, /\/rsvp\/[A-Za-z0-9_-]+/);
          const firstPayload = JSON.stringify(calls[0]);
          assert.equal((await execute(p, mailer)).status, "completed");
          assert.equal(calls.length, 1);
          assert.equal(JSON.stringify(calls[0]), firstPayload);
          assert.equal(
            store.sql(
              `select status from communication_recipients where id='${c.recipients[0]!.id}'`
            ),
            "failed"
          );
          assert.equal((await prepare(c.id)).kind, "refusal");
          assert.equal(
            await resolveFailedCommunicationSource({
              churchId: m.ids["foreign-plant"],
              communicationId: c.id,
            }),
            null
          );
          assert.equal(
            (await prepare(cohort([{}], "logged").id)).kind,
            "refusal"
          );
        }
      );

      await t.test(
        "stale reviewed source, email and suppression refuse before child rows or send",
        async () => {
          for (const change of [
            "body",
            "email",
            "suppression",
            "delivered",
            "deleted",
          ]) {
            const c = cohort(),
              p = await planFor(c.id),
              before = sentBefore(),
              count = calls.length;
            await confirm(p);
            if (change === "body")
              store.sql(
                `update communications set body='Changed' where id='${c.id}'`
              );
            if (change === "email")
              store.sql(
                `update persons set email='changed@example.test' where id='${c.recipients[0]!.personId}'`
              );
            if (change === "suppression")
              store.sql(
                `insert into email_suppressions(email,reason) values('${c.recipients[0]!.email}','hard_bounce')`
              );
            if (change === "delivered")
              store.sql(
                `update communication_recipients set delivered_at=now() where id='${c.recipients[0]!.id}'`
              );
            if (change === "deleted")
              store.sql(
                `update persons set deleted_at=now() where id='${c.recipients[0]!.personId}'`
              );
            assert.equal((await execute(p, mailer)).status, "refused", change);
            assert.equal(sentBefore(), before, change);
            assert.equal(calls.length, count, change);
          }
        }
      );

      await t.test(
        "old failure provenance cannot turn local or uncertain attempt markers into a new retry",
        async () => {
          const c = cohort([{}, {}, {}, {}, {}]);
          for (const [index, prefix] of [
            "attempted",
            "transient",
            "permanent",
            "local",
          ].entries()) {
            store.sql(
              `update communication_recipients set error_message='evry-${prefix}:recorded outcome' where id='${c.recipients[index + 1]!.id}'`
            );
          }
          const resolved = await resolveFailedCommunicationSource({
            churchId: m.ids.plant,
            communicationId: c.id,
          });
          assert.deepEqual(
            resolved?.source.recipients.map((r) => r.id),
            [c.recipients[0]!.id]
          );
        }
      );

      await t.test(
        "two separately approved retries cannot split or duplicate one source cohort",
        async () => {
          const c = cohort([{}, {}]),
            a = await planFor(c.id),
            b = await planFor(c.id),
            before = calls.length;
          await confirm(a);
          await confirm(b);
          const results = await Promise.all([
            execute(a, mailer),
            execute(b, mailer),
          ]);
          assert.equal(
            results.filter((r) => r.status === "completed").length,
            1
          );
          assert.equal(calls.length - before, 2);
          const claims = store.query(
            `select distinct plan_id from communication_failed_retries where source_recipient_id in ('${c.recipients[0]!.id}','${c.recipients[1]!.id}')`
          );
          assert.equal(claims.length, 1);
          assert.equal(
            store.sql(
              `select count(distinct communication_id) from communication_recipients where id in (select retry_recipient_id from communication_failed_retries where source_recipient_id in ('${c.recipients[0]!.id}','${c.recipients[1]!.id}'))`
            ),
            "1"
          );
        }
      );

      await t.test(
        "a blocked native source writer is observed by the fresh post-lock eligibility statement",
        async () => {
          const c = cohort(),
            p = await planFor(c.id);
          await confirm(p);
          const before = sentBefore(),
            callCount = calls.length;
          const native = spawn(
            "docker",
            [
              "exec",
              "-i",
              stack.container,
              "psql",
              "-U",
              "postgres",
              "-d",
              "eve_fixture",
              "-v",
              "ON_ERROR_STOP=1",
              "-Atq",
            ],
            { stdio: ["pipe", "pipe", "pipe"] }
          );
          let stdout = "",
            stderr = "";
          native.stdout.on("data", (chunk) => {
            stdout += String(chunk);
          });
          native.stderr.on("data", (chunk) => {
            stderr += String(chunk);
          });
          const ended = new Promise<number | null>((resolve, reject) => {
            native.on("error", reject);
            native.on("exit", resolve);
          });
          let execution: ReturnType<typeof execute> | undefined;
          try {
            native.stdin.write(
              `begin; select pg_backend_pid(); select id from communication_recipients where id='${c.recipients[0]!.id}' for update; select 'NATIVE_LOCKED';\n`
            );
            for (let n = 0; n < 100 && !stdout.includes("NATIVE_LOCKED"); n++)
              await setTimeout(25);
            assert.match(stdout, /NATIVE_LOCKED/, stderr);
            const pid = /^(\d+)$/m.exec(stdout)?.[1];
            assert.ok(pid);
            execution = execute(p, mailer);
            let blocked = false;
            for (let n = 0; n < 100 && !blocked; n++) {
              blocked =
                Number(
                  store.sql(
                    `select count(*) from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))`
                  )
                ) > 0;
              if (!blocked) await setTimeout(25);
            }
            assert.equal(
              blocked,
              true,
              "execution must actually wait behind the native writer"
            );
            native.stdin.end(
              `update communication_recipients set status='delivered',delivered_at=now() where id='${c.recipients[0]!.id}'; commit;\n`
            );
            assert.equal(await ended, 0, stderr);
            assert.equal((await execution).status, "refused");
            assert.equal(calls.length, callCount);
            assert.equal(sentBefore(), before);
          } finally {
            if (native.exitCode === null && !native.stdin.destroyed)
              native.stdin.end("rollback;\n");
            await ended;
            await execution;
          }
        }
      );

      await t.test(
        "legacy plant placeholders stay empty while saved original literals survive retry",
        async () => {
          const c = cohort();
          store.sql(
            `update communications set subject='Legacy {{pastor_name}} invitation',body='Previously recorded Pastor Morgan. {{pastor_name}} {{launch_date}}',body_html=null where id='${c.id}'`
          );
          const p = await planFor(c.id),
            before = calls.length;
          await confirm(p);
          assert.equal((await execute(p, mailer)).status, "completed");
          const sent = calls[before]!;
          assert.match(sent.text, /Previously recorded Pastor Morgan/);
          assert.doesNotMatch(
            sent.subject + sent.text,
            /Fixture Owner|\{\{pastor_name\}\}|\{\{launch_date\}\}/
          );
          const argumentsJson = store.sql(
            `select document::text from evry_action_plans where id='${p.plan.planId}'`
          );
          assert.match(argumentsJson, /Previously recorded Pastor Morgan/);
        }
      );

      await t.test(
        "signed delivery failure after accepted-row persistence and interrupted finalization settles without another send",
        async () => {
          const c = cohort(),
            p = await planFor(c.id);
          await confirm(p);
          const guardedFetch = globalThis.fetch;
          let interrupt = true,
            sends = 0;
          const acceptedId = `accepted-before-interruption-${randomUUID()}`;
          const acceptedMailer: EvryCommunicationMailer = {
            async send() {
              sends++;
              return { status: "accepted", providerId: acceptedId };
            },
          };
          try {
            globalThis.fetch = async (input, init) => {
              if (
                interrupt &&
                typeof init?.body === "string" &&
                /update communications c[\s\S]*set status = 'sent'/.test(
                  init.body
                )
              ) {
                interrupt = false;
                throw new Error(
                  "Isolated transport interruption before final effect claim"
                );
              }
              return guardedFetch(input, init);
            };
            assert.equal(
              (await execute(p, acceptedMailer)).status,
              "retryable"
            );
            assert.equal(
              interrupt,
              false,
              "must interrupt the actual final claim, not simulate another failure"
            );
          } finally {
            globalThis.fetch = guardedFetch;
          }
          const child = store.query(
            `select r.id,r.email,r.status,r.communication_id from communication_failed_retries f join communication_recipients r on r.id=f.retry_recipient_id where f.plan_id='${p.plan.planId}'`
          )[0]!;
          assert.equal(child.status, "sent");
          assert.equal(
            store.sql(
              `select status from communications where id='${child.communication_id}'`
            ),
            "sending"
          );
          const { POST } = await import("@/app/api/webhooks/resend/route");
          const { NextRequest } = await import("next/server");
          const oldSecret = process.env.RESEND_WEBHOOK_SECRET,
            secret = Buffer.from(
              "isolated-retry-finalization-webhook"
            ).toString("base64");
          try {
            process.env.RESEND_WEBHOOK_SECRET = `whsec_${secret}`;
            const body = JSON.stringify({
              type: "email.failed",
              created_at: new Date().toISOString(),
              data: {
                email_id: acceptedId,
                from: "church@example.test",
                to: [child.email],
                subject: "Invitation",
              },
            });
            const eventId = randomUUID(),
              timestamp = String(Math.floor(Date.now() / 1000));
            const signature = createHmac(
              "sha256",
              Buffer.from(secret, "base64")
            )
              .update(`${eventId}.${timestamp}.${body}`)
              .digest("base64");
            assert.equal(
              (
                await POST(
                  new NextRequest(
                    "http://fixture.invalid/api/webhooks/resend",
                    {
                      method: "POST",
                      body,
                      headers: {
                        "svix-id": eventId,
                        "svix-timestamp": timestamp,
                        "svix-signature": `v1,${signature}`,
                      },
                    }
                  )
                )
              ).status,
              200
            );
          } finally {
            if (oldSecret === undefined)
              delete process.env.RESEND_WEBHOOK_SECRET;
            else process.env.RESEND_WEBHOOK_SECRET = oldSecret;
          }
          assert.equal((await execute(p, acceptedMailer)).status, "failed");
          assert.equal(
            sends,
            1,
            "confirmed provider failure is not an uncertain attempt to submit again"
          );
          assert.equal(
            store.sql(
              `select status from communications where id='${child.communication_id}'`
            ),
            "failed"
          );
          const next = await planFor(String(child.communication_id));
          await confirm(next);
          assert.equal((await execute(next, mailer)).status, "completed");
        }
      );

      await t.test(
        "source eligibility is fresh for each provider attempt, not a cached audience set",
        async () => {
          const c = cohort([{}, {}]),
            p = await planFor(c.id);
          await confirm(p);
          let sends = 0;
          const outcome = await execute(p, {
            async send(input) {
              sends++;
              const other = c.recipients.find((r) => r.email !== input.to)!;
              store.sql(
                `update communication_recipients set status='delivered', delivered_at=now() where id='${other.id}'`
              );
              return {
                status: "accepted",
                providerId: `accepted-${randomUUID()}`,
              };
            },
          });
          assert.equal(sends, 1);
          assert.equal(outcome.status, "completed");
          assert.equal(outcome.steps[0]?.excludedCount, 1);
        }
      );

      await t.test(
        "lost acceptance reuses exact payload/key; a later failure may retry the child, not its parent",
        async () => {
          const c = cohort(),
            p = await planFor(c.id);
          await confirm(p);
          const observed: Parameters<EvryCommunicationMailer["send"]>[0][] = [];
          const accepted = new Map<string, string>();
          const uncertain: EvryCommunicationMailer = {
            async send(input) {
              observed.push(input);
              const existing = accepted.get(input.idempotencyKey);
              if (existing) {
                assert.equal(
                  existing,
                  JSON.stringify(input),
                  "provider rejects a changed payload under the same key"
                );
                return {
                  status: "accepted",
                  providerId: "recovered-provider-id",
                };
              }
              accepted.set(input.idempotencyKey, JSON.stringify(input));
              return {
                status: "retryable",
                reason: "Connection lost after provider acceptance",
              };
            },
          };
          assert.equal((await execute(p, uncertain)).status, "retryable");
          store.sql(`update churches set name='Changed after first attempt' where id='${m.ids.plant}';
        update meeting_confirmation_tokens set expires_at=now()-interval '1 hour' where church_id='${m.ids.plant}'`);
          assert.equal((await execute(p, uncertain)).status, "completed");
          assert.deepEqual(observed[1], observed[0]);
          assert.equal(
            accepted.size,
            1,
            "one provider acceptance despite two requests"
          );
          assert.equal((await prepare(c.id)).kind, "refusal");
          const child = store.query(
            `select r.id,r.communication_id from communication_failed_retries f join communication_recipients r on r.id=f.retry_recipient_id where f.source_recipient_id='${c.recipients[0]!.id}'`
          )[0]!;
          store.sql(
            `update communication_recipients set status='failed', failure_origin='provider_delivery_failed' where id='${child.id}'`
          );
          const next = await planFor(String(child.communication_id));
          await confirm(next);
          assert.equal((await execute(next, mailer)).status, "completed");
          assert.equal(
            store.sql(
              `select count(*) from communication_failed_retries where source_recipient_id in ('${c.recipients[0]!.id}','${child.id}')`
            ),
            "2"
          );
        }
      );

      await t.test(
        "uncertainty beyond provider retention remains unresolved without another send",
        async () => {
          const c = cohort(),
            p = await planFor(c.id);
          await confirm(p);
          let sends = 0;
          const uncertain: EvryCommunicationMailer = {
            async send() {
              sends++;
              return { status: "retryable", reason: "Lost response" };
            },
          };
          assert.equal((await execute(p, uncertain)).status, "retryable");
          store.sql(
            `update communication_failed_retries set first_attempt_at=now()-interval '24 hours' where plan_id='${p.plan.planId}'`
          );
          assert.equal((await execute(p, uncertain)).status, "retryable");
          assert.equal(sends, 1);
          assert.equal((await prepare(c.id)).kind, "refusal");
        }
      );

      await t.test(
        "changed source after a lost provider response remains uncertain, never a fabricated local exclusion",
        async () => {
          const c = cohort(),
            p = await planFor(c.id);
          await confirm(p);
          let sends = 0;
          const uncertain: EvryCommunicationMailer = {
            async send() {
              sends++;
              return { status: "retryable", reason: "Lost provider response" };
            },
          };
          assert.equal((await execute(p, uncertain)).status, "retryable");
          store.sql(
            `update communication_recipients set delivered_at=now() where id='${c.recipients[0]!.id}'`
          );
          assert.equal((await execute(p, uncertain)).status, "retryable");
          assert.equal(sends, 1);
          assert.equal(
            store.sql(
              `select count(*) from communication_failed_retries f join communication_recipients r on r.id=f.retry_recipient_id where f.plan_id='${p.plan.planId}' and r.error_message like 'evry-attempted:%' and f.first_attempt_at is not null`
            ),
            "1"
          );
        }
      );

      await t.test(
        "revoked current send authority is refused, even after review and approval",
        async () => {
          const c = cohort(),
            p = await planFor(c.id);
          await confirm(p);
          const before = calls.length;
          store.sql(`update users set seat='member' where id='${m.ids.actor}'`);
          const outcome = await execute(p, mailer);
          assert.ok(["refused", "unavailable"].includes(outcome.status));
          assert.equal(calls.length, before);
          store.sql(`update users set seat='owner' where id='${m.ids.actor}'`);
        }
      );
      await t.test(
        "fixed QA reset refuses live retries, removes completed operational claims atomically, and preserves audit and foreign claims",
        async () => {
          const {
            EVRY_TEST_CHURCH_ID,
            EVRY_TEST_CHURCH_NAME,
            EVRY_TEST_ACCOUNTS,
          } = await import("./evry-test-fixtures");
          const {
            EVRY_TEST_EXECUTION_RESET_GUARD,
            evryTestOperationalResetStatements,
          } = await import("./evry-test-reset");
          const qa = createFixtureManifest("communication-retry-qa-reset", 100);
          // This isolated tenant deliberately uses the seeder's fixed identities.
          // It is not a model-evaluation manifest or a shared QA database.
          qa.ids.plant = EVRY_TEST_CHURCH_ID;
          qa.ids.actor = EVRY_TEST_ACCOUNTS[0].id;
          qa.ids["other-actor"] = EVRY_TEST_ACCOUNTS[2].id;
          store.seed(qa);
          store.sql(`update churches set name='${EVRY_TEST_CHURCH_NAME}',onboarding_completed_at=now() where id='${qa.ids.plant}';
          update users set email='${EVRY_TEST_ACCOUNTS[0].email}' where id='${qa.ids.actor}';
          update users set email='${EVRY_TEST_ACCOUNTS[2].email}' where id='${qa.ids["other-actor"]}';`);
          const qaActor = await requireEvryPlantViewerForSession(qa.sessionId);
          const qaScoped = <T>(run: () => Promise<T>) =>
            withAuthenticatedSessionId(qa.sessionId, run);
          const sourceId = randomUUID(),
            recipientId = randomUUID();
          store.sql(`insert into communications(id,church_id,subject,body,channel,status,created_by_id)
          values('${sourceId}','${qa.ids.plant}','QA original','Original saved body','email','sent','${qa.ids.actor}');
          insert into communication_recipients(id,church_id,communication_id,person_id,email,channel,status,external_id,failure_origin)
          select '${recipientId}','${qa.ids.plant}','${sourceId}',id,email,'email','failed','qa-original-provider-id','provider_delivery_failed' from persons where id='${qa.ids["core-alex"]}';`);
          const p = await qaScoped(() =>
            messages.proposeCommunicationEvryMessageEffect({
              actor: qaActor,
              pageContext: null,
              selection: { kind: "retry_failed", communicationId: sourceId },
              requestKey: mintEvryPlanRequestKey(),
              now: new Date(),
            })
          );
          assert.equal(p.kind, "plan");
          const client = neon(stack.databaseUrl);
          const reset = (rollback = false) =>
            client.transaction([
              client.query(
                `DO $$ BEGIN ${EVRY_TEST_EXECUTION_RESET_GUARD} END $$`
              ),
              ...evryTestOperationalResetStatements().map(({ sql, params }) =>
                client.query(sql, params)
              ),
              client.query(
                "DELETE FROM communication_recipients WHERE church_id=$1",
                [qa.ids.plant]
              ),
              client.query("DELETE FROM communications WHERE church_id=$1", [
                qa.ids.plant,
              ]),
              ...(rollback ? [client.query("SELECT 1/0")] : []),
            ]);
          await assert.rejects(reset(), /plan is still actionable/);
          await qaScoped(() =>
            confirmEvryActionPlan({
              actor: qaActor,
              planId: p.plan.planId,
              fingerprint: p.plan.fingerprint,
              decidedAt: new Date(),
              registry: messages.COMMUNICATION_MESSAGE_PLAN_REGISTRY,
            })
          );
          await assert.rejects(reset(), /plan is still actionable/);
          const qaExecute = (provider: EvryCommunicationMailer) =>
            qaScoped(() =>
              executeEvryActionPlan({
                actor: qaActor,
                ...p.plan,
                registry: createEvryExecutionCapabilityRegistry(
                  messages.createCommunicationEvryMessageExecutions({
                    mailer: provider,
                  }).registrations
                ),
              })
            );
          assert.equal(
            (
              await qaExecute({
                async send() {
                  return { status: "retryable", reason: "Lost response" };
                },
              })
            ).status,
            "retryable"
          );
          await assert.rejects(reset(), /plan is still actionable/);
          assert.equal(
            store.sql(
              `select count(*) from communication_failed_retries where church_id='${qa.ids.plant}'`
            ),
            "1"
          );
          assert.equal((await qaExecute(mailer)).status, "completed");
          const digest = (table: string, where: string) =>
            store.sql(
              `select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'null')) from ${table} t where ${where}`
            );
          const foreignBefore = digest(
            "communication_failed_retries",
            `church_id<>'${qa.ids.plant}'`
          );
          const audit = () =>
            [
              "evry_action_plans",
              "evry_plan_confirmations",
              "evry_product_audit_events",
              "evry_execution_attempts",
              "evry_execution_outcomes",
              "evry_execution_effect_claims",
            ].map((table) => digest(table, `church_id='${qa.ids.plant}'`));
          const auditBefore = audit();
          const ownClaims = () =>
            digest(
              "communication_failed_retries",
              `church_id='${qa.ids.plant}'`
            );
          const claimsBefore = ownClaims();
          await assert.rejects(reset(true), /division by zero/);
          assert.equal(
            ownClaims(),
            claimsBefore,
            "a later failure restores deleted claims"
          );
          await reset();
          await reset();
          assert.equal(
            store.sql(
              `select count(*) from communication_failed_retries where church_id='${qa.ids.plant}'`
            ),
            "0"
          );
          assert.equal(
            store.sql(
              `select count(*) from communication_recipients where church_id='${qa.ids.plant}'`
            ),
            "0"
          );
          assert.deepEqual(
            audit(),
            auditBefore,
            "immutable evidence outlives operational reset"
          );
          assert.equal(
            digest(
              "communication_failed_retries",
              `church_id<>'${qa.ids.plant}'`
            ),
            foreignBefore
          );
          store.revoke(qa);
        }
      );
      assert.equal(
        externalCalls,
        0,
        "all provider calls were injected; no emails or paid APIs used"
      );
      store.revoke(m);
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
