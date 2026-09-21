import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { eveAttachmentDescriptorSchema } from "@/lib/evry/eve/runtime/attachment-contract";
import type { EvryPeopleFileStorage } from "@/lib/evry/capabilities/people/file-storage";

test(
  "real attachment binding route, native staged bytes, scoped reads and exact file preparations",
  {
    skip: process.env.EVRY_EVE_ATTACHMENT_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const original = {
      fetch: globalThis.fetch,
      database: process.env.DATABASE_URL,
      live: process.env.LIVE_DB_TESTS,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
    };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.LIVE_DB_TESTS = "1";
      process.env.RESEND_API_KEY = "re_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated database requests are allowed");
        }
        return original.fetch(input, init);
      };
      const [
        { POST },
        { withAuthenticatedSessionId },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { eveSessionStore, getEveSession },
        {
          eveAttachments,
          createEveAttachmentService,
          eveAttachmentStore,
          authorizeEveAttachment,
        },
        { stageEvryPeopleAttachment },
        { withEvryPeopleLiveProofStorage },
        { createEveToolRegistry },
        { createEvePreparation },
        { bindEveAttachmentContext },
      ] = await Promise.all([
        import("@/app/api/evry/eve/attachments/route"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/evry/eve/runtime/session-store"),
        import("@/lib/evry/eve/runtime/attachments"),
        import("@/lib/evry/capabilities/people/attachments"),
        import("@/lib/evry/capabilities/people/file-storage"),
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eve/preparation"),
        import("@/lib/evry/eve/runtime/transport-policy"),
      ]);
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("attachment-context", 1, new Date());
      store.seed(m);
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const eveSessionId = `attachment-${randomUUID()}`;
      const otherSessionId = `attachment-${randomUUID()}`;
      await eveSessionStore.register(eveSessionId, actor);
      await eveSessionStore.register(otherSessionId, actor);
      const session = await getEveSession(eveSessionId, actor);
      assert.ok(session);
      const scope = { ...actor, sessionId: eveSessionId };
      const objects = new Map<string, { body: Buffer; contentType: string }>();
      const storage: EvryPeopleFileStorage = {
        signingSecret: () => "isolated-native-attachment-proof-secret",
        store: async () => {
          throw new Error("Preparation must not write permanent files");
        },
        create: async (key, body, contentType) => {
          if (objects.has(key)) return "exists";
          objects.set(key, { body, contentType });
          return "created";
        },
        read: async (key) => objects.get(key) ?? null,
        remove: async (key) => {
          objects.delete(key);
        },
        listKeys: async (prefix) =>
          [...objects.keys()].filter((key) => key.startsWith(prefix)),
        listObjects: async (prefix) =>
          [...objects.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => ({ key, lastModified: new Date() })),
      };
      await withEvryPeopleLiveProofStorage(storage, () =>
        withAuthenticatedSessionId(m.sessionId, async () => {
          const request = (body: unknown, origin = "https://preview.example") =>
            new Request("https://preview.example/api/evry/eve/attachments", {
              method: "POST",
              headers: {
                origin,
                cookie: `session=${m.sessionToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            });
          const csv = await stageEvryPeopleAttachment({
            actor,
            kind: "people_csv",
            personId: null,
            file: new File(
              [
                "firstName,lastName,email\nFixture,Import,attachment-only@example.test",
              ],
              "people.csv",
              { type: "text/csv" }
            ),
          });
          assert.ok(csv);
          const bindInput = {
            sessionId: eveSessionId,
            kind: "people_csv",
            reference: csv.reference,
            digest: csv.metadata.digest,
          };
          const response = await POST(request(bindInput));
          assert.equal(response.status, 200);
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store"
          );
          const bound = z
            .object({ attachment: eveAttachmentDescriptorSchema })
            .parse(await response.json()).attachment;
          const second = await POST(request(bindInput));
          assert.deepEqual(await second.json(), { attachment: bound });
          assert.equal(
            store.sql(
              `select count(*) from evry_eve_attachments where session_id='${eveSessionId}'`
            ),
            "1"
          );
          const restarted = createEveAttachmentService({
            store: eveAttachmentStore,
            authorize: authorizeEveAttachment,
          });
          assert.equal(
            (await restarted.resolve(scope, bound.attachmentId))?.reference,
            csv.reference
          );
          assert.equal(
            (await POST(request(bindInput, "https://foreign.example"))).status,
            403
          );
          assert.equal(
            (await POST(request({ ...bindInput, digest: "0".repeat(64) })))
              .status,
            404
          );
          assert.equal(
            (
              await POST(
                request({ ...bindInput, reference: `${csv.reference}x` })
              )
            ).status,
            404
          );
          assert.equal(
            (
              await POST(
                request({ ...bindInput, sessionId: "unknown-session" })
              )
            ).status,
            404
          );
          assert.equal(
            await eveAttachments.resolve(
              { ...scope, sessionId: otherSessionId },
              bound.attachmentId
            ),
            null
          );
          assert.equal(
            await eveAttachments.resolve(
              { ...scope, userId: m.ids["other-actor"] },
              bound.attachmentId
            ),
            null
          );
          assert.equal(
            await eveAttachments.resolve(
              { ...scope, plantId: m.ids["foreign-plant"] },
              bound.attachmentId
            ),
            null
          );
          const context = await bindEveAttachmentContext(
            new Request(
              `https://preview.example/eve/v1/session/${eveSessionId}`,
              {
                method: "POST",
                body: JSON.stringify({
                  message: "Review this CSV",
                  clientContext: {
                    attachment: { attachmentId: bound.attachmentId },
                  },
                }),
              }
            ),
            { ...actor, appSessionId: m.sessionId }
          );
          assert.ok(context);
          const modelContext = await context.text();
          assert.ok(modelContext.includes(bound.attachmentId));
          assert.ok(
            !modelContext.includes(csv.reference) &&
              !modelContext.includes(csv.metadata.digest)
          );
          const resolveAttachment = (
            id: string,
            kind?: Parameters<typeof eveAttachments.resolve>[2]
          ) => eveAttachments.resolve(scope, id, kind);
          const authorizeRead = (identity: string) =>
            authorizeEvryReadCapabilityForSession(identity, m.sessionId);
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: "Review this uploaded file",
              pageContext: null,
              now: new Date(),
            },
            authorizeRead,
            resolveAttachment,
            preparation: createEvePreparation({
              actor,
              conversationId: session.conversationId,
              userRequestKey: randomUUID(),
              literalUserText: "Review this uploaded file",
              pageContext: null,
              now: new Date(),
              authorizeRead,
              resolveAttachment,
            }),
          });
          const before = store.query(
            "select id,photo_url from persons order by id"
          );
          await t.test(
            "CSV inspection resolves exact bytes and preparation freezes them without importing",
            async () => {
              const output = await registry.invoke(
                "files.inspect",
                { attachmentId: bound.attachmentId },
                { callId: "inspect-csv" }
              );
              const inspected = z
                .object({
                  items: z.array(
                    z.object({
                      id: z.string(),
                      facts: z.array(
                        z.object({ label: z.string(), value: z.string() })
                      ),
                    })
                  ),
                })
                .parse(output);
              assert.equal(inspected.items.length, 1);
              assert.equal(inspected.items[0]!.id, "csv-row-2");
              assert.deepEqual(
                inspected.items[0]!.facts.find(
                  (fact) => fact.label === "Status"
                ),
                { label: "Status", value: "Valid" },
                "The fixture must contain an importable row, not merely an error row"
              );
              const prepared = await registry.invoke(
                "actions.prepare",
                {
                  request: {
                    operation: "people.import_file",
                    arguments: { attachmentId: bound.attachmentId },
                  },
                },
                { callId: "prepare-csv" }
              );
              assert.ok(
                JSON.stringify(prepared).includes('"kind":"confirmation"')
              );
              const plans = store.query(
                "select document from evry_action_plans order by created_at"
              );
              assert.ok(JSON.stringify(plans).includes(csv.reference));
              assert.ok(JSON.stringify(plans).includes(csv.metadata.digest));
              const count = store.sql("select count(*) from evry_action_plans");
              assert.deepEqual(
                await registry.invoke(
                  "actions.prepare",
                  {
                    request: {
                      operation: "people.import_file",
                      arguments: { attachmentId: bound.attachmentId },
                    },
                  },
                  { callId: "prepare-csv" }
                ),
                prepared
              );
              assert.equal(
                store.sql("select count(*) from evry_action_plans"),
                count
              );
            }
          );
          for (const kind of ["person_photo", "commitment_document"] as const)
            await t.test(
              `${kind} retains the signed target and exact reviewed file`,
              async () => {
                const personId =
                  kind === "person_photo"
                    ? m.ids["core-alex"]
                    : m.ids["core-jordan"];
                const file =
                  kind === "person_photo"
                    ? new File(["fixture-image"], "photo.png", {
                        type: "image/png",
                      })
                    : new File(
                        ["%PDF-1.4\nfixture commitment"],
                        "commitment.pdf",
                        { type: "application/pdf" }
                      );
                const staged = await stageEvryPeopleAttachment({
                  actor,
                  kind,
                  personId,
                  file,
                });
                assert.ok(staged);
                const descriptor = await eveAttachments.bind(scope, {
                  kind,
                  reference: staged.reference,
                  digest: staged.metadata.digest,
                });
                assert.ok(descriptor);
                assert.equal(descriptor.personId, personId);
                const operation =
                  kind === "person_photo"
                    ? "people.upload_photo"
                    : "people.attach_commitment";
                const args = {
                  attachmentId: descriptor.attachmentId,
                  ...(kind === "commitment_document"
                    ? { commitmentType: "core_group", signedDate: "2026-09-20" }
                    : {}),
                };
                const output = await registry.invoke(
                  "actions.prepare",
                  { request: { operation, arguments: args } },
                  { callId: operation }
                );
                assert.ok(
                  JSON.stringify(output).includes('"kind":"confirmation"')
                );
                const plan = store.query(
                  `select document from evry_action_plans where document::text like '%${staged.metadata.digest}%'`
                );
                assert.equal(plan.length, 1);
                assert.ok(JSON.stringify(plan).includes(staged.reference));
                assert.ok(JSON.stringify(plan).includes(personId));
                const wrongKind = await registry.invoke(
                  "actions.prepare",
                  {
                    request: {
                      operation,
                      arguments: { ...args, attachmentId: bound.attachmentId },
                    },
                  },
                  { callId: `wrong-kind-${kind}` }
                );
                assert.equal(
                  z.object({ status: z.string() }).parse(wrongKind).status,
                  "unavailable"
                );
                const overridden = await registry.invoke(
                  "actions.prepare",
                  {
                    request: {
                      operation,
                      arguments: { ...args, personId: m.ids["person-foreign"] },
                    },
                  },
                  { callId: `wrong-person-${kind}` }
                );
                assert.ok(
                  !JSON.stringify(overridden).includes('"kind":"confirmation"')
                );
              }
            );
          assert.deepEqual(
            store.query("select id,photo_url from persons order by id"),
            before
          );
          assert.equal(
            store.sql("select count(*) from evry_plan_confirmations"),
            "0"
          );
          assert.equal(store.sql("select count(*) from commitments"), "0");
          store.sql(
            `update evry_eve_attachments set expires_at=now()-interval '1 second' where id='${bound.attachmentId}'`
          );
          assert.equal(
            await eveAttachments.resolve(scope, bound.attachmentId),
            null
          );
          store.sql(
            `update evry_eve_sessions set archived_at=now() where id='${eveSessionId}'`
          );
          assert.equal((await POST(request(bindInput))).status, 404);
        })
      );
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = original.fetch;
      if (original.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original.database;
      if (original.live === undefined) delete process.env.LIVE_DB_TESTS;
      else process.env.LIVE_DB_TESTS = original.live;
      if (original.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original.resend;
      neonConfig.fetchEndpoint = original.endpoint;
      await stack.cleanup();
    }
  }
);
