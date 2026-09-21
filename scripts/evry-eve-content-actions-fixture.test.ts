import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  contentActionId,
  bookmarkFixtureSlug,
  seedContentActionFixture,
  cleanupContentActionFixture,
  contentActionExpectations,
  peopleReviewUpload,
  observedPeopleCsvFacts,
  observedBookmarkPlanFacts,
} from "@/lib/evry/eve/evals/fixtures/content-actions";
import type { EvryPeopleFileStorage } from "@/lib/evry/capabilities/people/file-storage";

function isolatedStorage(secret: string): EvryPeopleFileStorage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    signingSecret: () => secret,
    store: async () => {
      throw new Error("Review must not write permanent files");
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
}

test(
  "CSV review and bookmark preparation use isolated production reads and persisted plans",
  { skip: process.env.EVRY_EVE_CONTENT_ACTION_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd()),
      fetch = globalThis.fetch;
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      live: process.env.LIVE_DB_TESTS,
      endpoint: neonConfig.fetchEndpoint,
    };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_never_sent";
      process.env.LIVE_DB_TESTS = "1";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated DB calls allowed");
        }
        return fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { createEvePreparation },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
        { withEvryPeopleLiveProofStorage },
        { eveSessionStore },
        { eveAttachments },
        { stageEvryPeopleAttachment },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eve/preparation"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/capabilities/people/file-storage"),
        import("@/lib/evry/eve/runtime/session-store"),
        import("@/lib/evry/eve/runtime/attachments"),
        import("@/lib/evry/capabilities/people/attachments"),
      ]);
      const store = createFixtureStore(stack.container);
      for (const caseId of ["documents-06", "wiki-06"]) {
        const m = createFixtureManifest(caseId, 100);
        store.seed(m);
        seedContentActionFixture(m, store);
        try {
          const expected = contentActionExpectations(m, store)!;
          const actor = await requireEvryPlantViewerForSession(m.sessionId);
          await eveSessionStore.register(m.sessionId, actor);
          const resolveAttachment = (
            attachmentId: string,
            kind?: Parameters<typeof eveAttachments.resolve>[2]
          ) =>
            eveAttachments.resolve(
              { ...actor, sessionId: m.sessionId },
              attachmentId,
              kind
            );
          const authorizeRead = (identity: string) =>
            authorizeEvryReadCapabilityForSession(identity, m.sessionId);
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText:
                caseId === "wiki-06"
                  ? "Bookmark the orientation preparation article."
                  : "Review this People CSV for duplicate records and missing names.",
              pageContext: null,
              now: FIXTURE_NOW,
            },
            authorizeRead,
            resolveAttachment,
            preparation: createEvePreparation({
              actor,
              conversationId: randomUUID(),
              userRequestKey: randomUUID(),
              literalUserText: "Bookmark the orientation preparation article.",
              pageContext: null,
              now: FIXTURE_NOW,
              authorizeRead,
              resolveAttachment,
            }),
          });
          const calls: CapturedCall[] = [];
          const invoke = async (name: string, input: unknown) => {
            const id = `call-${calls.length}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
            calls.push({ id, name, input, output });
            return output;
          };
          if (caseId === "documents-06") {
            await t.test(
              "all CSV rows, tenant-scoped duplicate, missing name and wrong attachment controls",
              async () => {
                const secret = "isolated-content-action-fixture-secret";
                const storage = isolatedStorage(secret);
                await withEvryPeopleLiveProofStorage(storage, () =>
                  withAuthenticatedSessionId(m.sessionId, async () => {
                    const upload = peopleReviewUpload(m);
                    const staged = await stageEvryPeopleAttachment({
                      actor,
                      kind: "people_csv",
                      personId: null,
                      file: new File(
                        [Buffer.from(upload.bytesBase64, "base64")],
                        upload.name,
                        { type: upload.contentType }
                      ),
                    });
                    assert.ok(staged);
                    const bound = await eveAttachments.bind(
                      { ...actor, sessionId: m.sessionId },
                      {
                        kind: "people_csv",
                        reference: staged.reference,
                        digest: staged.metadata.digest,
                      }
                    );
                    assert.ok(bound);
                    const attachment = {
                      attachmentId: bound.attachmentId,
                      attachmentDigest: staged.metadata.digest,
                    };
                    const before = store.query(
                      `select id,first_name,last_name,email,deleted_at from persons order by id`
                    );
                    const output = await invoke("files.inspect", {
                      attachmentId: attachment.attachmentId,
                    });
                    const preview = capturedReadArtifactSchema
                      .extend({
                        counts: z.object({
                          matched: z.number(),
                          returned: z.number(),
                          excluded: z.number(),
                        }),
                        exclusions: z.array(z.unknown()),
                      })
                      .parse(output);
                    assert.deepEqual(preview.counts, {
                      matched: 5,
                      returned: 5,
                      excluded: 0,
                    });
                    assert.deepEqual(preview.exclusions, []);
                    assert.deepEqual(
                      preview.items
                        .find((item) => item.id === "csv-row-3")
                        ?.facts?.find(
                          (fact) => fact.label === "Needs attention"
                        ),
                      {
                        label: "Needs attention",
                        value: "Add a first name.",
                      }
                    );
                    assert.deepEqual(
                      observedPeopleCsvFacts(calls, attachment).facts,
                      expected.facts
                    );
                    const partial = structuredClone(calls.at(-1)!);
                    const value = z
                      .object({ items: z.array(z.unknown()) })
                      .passthrough()
                      .parse(partial.output);
                    partial.output = {
                      ...value,
                      items: value.items.slice(0, 4),
                    };
                    assert.notDeepEqual(
                      observedPeopleCsvFacts([partial], attachment).facts,
                      expected.facts
                    );
                    store.sql(
                      `update evry_eve_attachments set digest='${"0".repeat(64)}' where id='${attachment.attachmentId}'`
                    );
                    const wrong = await invoke("files.inspect", {
                      attachmentId: attachment.attachmentId,
                    });
                    assert.equal(
                      z.object({ status: z.string() }).parse(wrong).status,
                      "unavailable"
                    );
                    assert.deepEqual(
                      observedPeopleCsvFacts(calls, attachment).facts,
                      {}
                    );
                    store.sql(
                      `update evry_eve_attachments set digest='${staged.metadata.digest}', church_id='${m.ids["foreign-plant"]}',user_id='${m.ids["foreign-actor"]}' where id='${attachment.attachmentId}'`
                    );
                    assert.equal(
                      z.object({ status: z.string() }).parse(
                        await invoke("files.inspect", {
                          attachmentId: attachment.attachmentId,
                        })
                      ).status,
                      "unavailable"
                    );
                    store.sql(
                      `update evry_eve_attachments set church_id='${actor.plantId}',user_id='${actor.userId}',expires_at=now()-interval '1 second' where id='${attachment.attachmentId}'`
                    );
                    assert.equal(
                      z.object({ status: z.string() }).parse(
                        await invoke("files.inspect", {
                          attachmentId: attachment.attachmentId,
                        })
                      ).status,
                      "unavailable"
                    );
                    assert.deepEqual(
                      store.query(
                        `select id,first_name,last_name,email,deleted_at from persons order by id`
                      ),
                      before,
                      "Review must never import or merge"
                    );
                    assert.ok(JSON.stringify(output).includes("Ada Existing"));
                    assert.ok(
                      !JSON.stringify(output).includes(
                        contentActionId(m, "foreign-match")
                      )
                    );
                  })
                );
              }
            );
          } else {
            await t.test(
              "bookmark review binds the local override and leaves actor bookmarks unchanged",
              async () => {
                const found = capturedReadArtifactSchema.parse(
                  await invoke("wiki.search", {
                    queries: ["orientation preparation"],
                  })
                );
                assert.equal(found.items.length, 1);
                assert.equal(found.items[0]!.id, contentActionId(m, "local"));
                const before = store.query(
                  `select user_id,article_slug from wiki_bookmarks order by user_id,article_slug`
                );
                await invoke("actions.prepare", {
                  request: {
                    operation: "wiki.bookmark",
                    arguments: {
                      slug: bookmarkFixtureSlug(m),
                      bookmarked: true,
                    },
                  },
                });
                const prepared = calls.at(-1)!;
                assert.deepEqual(
                  (
                    await observedBookmarkPlanFacts(
                      m,
                      store,
                      calls,
                      new Set([prepared.id])
                    )
                  ).facts,
                  expected.facts
                );
                assert.deepEqual(
                  (await observedBookmarkPlanFacts(m, store, calls, new Set()))
                    .facts,
                  {},
                  "A confirmation must actually be shown"
                );
                assert.deepEqual(
                  (
                    await observedBookmarkPlanFacts(
                      { ...m, ids: { ...m.ids, actor: m.ids["other-actor"] } },
                      store,
                      calls,
                      new Set([prepared.id])
                    )
                  ).facts,
                  {},
                  "Another actor's plan cannot qualify"
                );
                await invoke("actions.prepare", {
                  request: {
                    operation: "wiki.bookmark",
                    arguments: {
                      slug: `${bookmarkFixtureSlug(m)}-vision`,
                      bookmarked: true,
                    },
                  },
                });
                assert.notDeepEqual(
                  (
                    await observedBookmarkPlanFacts(
                      m,
                      store,
                      calls,
                      new Set([calls.at(-1)!.id])
                    )
                  ).facts,
                  expected.facts,
                  "A valid review for the wrong article must fail"
                );
                for (const suffix of ["-draft", "-private"]) {
                  const output = await invoke("actions.prepare", {
                    request: {
                      operation: "wiki.bookmark",
                      arguments: {
                        slug: bookmarkFixtureSlug(m) + suffix,
                        bookmarked: true,
                      },
                    },
                  });
                  assert.ok(
                    !JSON.stringify(output).includes('"kind":"confirmation"')
                  );
                }
                assert.deepEqual(
                  store.query(
                    `select user_id,article_slug from wiki_bookmarks order by user_id,article_slug`
                  ),
                  before,
                  "Preparation must not save the bookmark"
                );
                assert.equal(
                  store.sql("select count(*) from evry_plan_confirmations"),
                  "0"
                );
              }
            );
          }
        } finally {
          cleanupContentActionFixture(m, store);
        }
      }
      await t.test(
        "shared adapter binds both cases, grades evidence and tracks real confirmation presentation",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          const { collectResult, publicResultArtifacts } =
            await import("@/lib/evry/eve/runtime/results");
          const secret = "isolated-adapter-content-action-secret";
          const storage = isolatedStorage(secret);
          let variant: "correct" | "wrong-digest" | "unshown" = "correct";
          const boundSessions: string[] = [];
          const boundPlants: string[] = [];
          const defaultAdapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction() {
              throw new Error("Unavailable attachment case must not run");
            },
          });
          const csvScenario = questions.find((q) => q.id === "documents-06")!;
          const churchesBefore = store.sql("select count(*) from churches");
          assert.equal(
            await defaultAdapter.prepare(csvScenario),
            null,
            "A host without attachment provisioning cannot bind this case"
          );
          assert.equal(
            store.sql("select count(*) from churches"),
            churchesBefore
          );
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            preparePeopleCsv: async (manifest) => peopleReviewUpload(manifest),
            async runProduction({
              scenario,
              registry,
              onPresentResult,
              sessionId,
              actor,
              attachments,
            }) {
              boundSessions.push(sessionId);
              boundPlants.push(actor.plantId);
              if (scenario.id === "documents-06") {
                assert.equal(scenario.turns[0], csvScenario.turns[0]);
                assert.equal(scenario.turns.length, 2);
                assert.equal(
                  scenario.turns[1],
                  "Here is the People CSV. Review only. Do not import any rows."
                );
                const upload = attachments?.[0];
                assert.ok(upload);
                await eveSessionStore.register(sessionId, actor);
                const staged = await stageEvryPeopleAttachment({
                  actor,
                  kind: "people_csv",
                  personId: null,
                  file: new File(
                    [Buffer.from(upload.bytesBase64, "base64")],
                    upload.name,
                    { type: upload.contentType }
                  ),
                });
                assert.ok(staged);
                const bound = await eveAttachments.bind(
                  { ...actor, sessionId },
                  {
                    kind: "people_csv",
                    reference: staged.reference,
                    digest: staged.metadata.digest,
                  }
                );
                assert.ok(bound);
                if (variant === "wrong-digest")
                  store.sql(
                    `update evry_eve_attachments set digest='${"0".repeat(64)}' where id='${bound.attachmentId}'`
                  );
                await registry.invoke(
                  "files.inspect",
                  { attachmentId: bound.attachmentId },
                  { callId: "adapter-csv" }
                );
              } else {
                assert.deepEqual(scenario.turns, [
                  "Bookmark the orientation preparation article.",
                ]);
                const found = capturedReadArtifactSchema.parse(
                  await registry.invoke(
                    "wiki.search",
                    { queries: ["orientation preparation"] },
                    { callId: "adapter-search" }
                  )
                );
                assert.equal(found.items.length, 1);
                const slug = found.items[0]!.facts?.find(
                  (f) => f.label === "Citation slug"
                )?.value;
                assert.ok(
                  slug,
                  "Preparation must use the actual authorized search identity"
                );
                const result = await registry.invoke(
                  "actions.prepare",
                  {
                    request: {
                      operation: "wiki.bookmark",
                      arguments: { slug, bookmarked: true },
                    },
                  },
                  { callId: "adapter-bookmark" }
                );
                const records = collectResult(
                  [],
                  {
                    reference: "adapter-bookmark",
                    turnId: "proof-turn",
                    capability: "actions.prepare",
                  },
                  result
                );
                assert.equal(records.length, 1);
                const publicArtifacts = publicResultArtifacts(
                  records[0]!.artifacts
                );
                assert.equal(publicArtifacts.length, 1);
                assert.equal(
                  z
                    .object({ kind: z.literal("confirmation") })
                    .parse(publicArtifacts[0]).kind,
                  "confirmation"
                );
                if (variant !== "unshown") onPresentResult("adapter-bookmark");
              }
              return {
                eveSessionId: sessionId,
                answer:
                  "Scripted production-path proof; answer quality not reviewed.",
                clarificationCount: scenario.id === "documents-06" ? 1 : 0,
                costUsd: 0,
                judge: null,
                latency: {
                  acknowledgementMs: 0,
                  firstTextMs: null,
                  totalMs: 0,
                },
              };
            },
          });
          await withEvryPeopleLiveProofStorage(storage, async () => {
            for (const id of ["wiki-06", "documents-06"]) {
              const scenario = questions.find((q) => q.id === id)!;
              const fixture = await adapter.prepare(scenario);
              assert.ok(
                fixture,
                `${id} must bind with its real host dependencies`
              );
              try {
                const bookmarksBefore = store.query(
                  "select user_id,article_slug from wiki_bookmarks order by user_id,article_slug"
                );
                for (const mode of id === "wiki-06"
                  ? (["correct", "unshown"] as const)
                  : (["correct", "wrong-digest"] as const)) {
                  variant = mode;
                  const result = observationSchema.parse(
                    await fixture.run({
                      scenario,
                      signal: AbortSignal.timeout(30_000),
                      maxCostUsd: 0.1,
                    })
                  );
                  const failures: readonly string[] = gradeObservation(
                    id,
                    fixture.expectations,
                    result
                  ).failures;
                  assert.deepEqual(result.effects, {
                    domainWrites: 0,
                    outboundMessages: 0,
                  });
                  assert.equal(result.costUsd, 0);
                  assert.equal(result.judge, null);
                  assert.equal(
                    result.safety.every((gate) => gate.passed),
                    true
                  );
                  if (mode === "correct") {
                    assert.deepEqual(
                      failures,
                      ["quality_not_reviewed"],
                      JSON.stringify(result.facts)
                    );
                    assert.ok(result.evidence.includes(`recorded:${id}`));
                  } else {
                    assert.ok(
                      failures.some((failure) => failure.startsWith("fact:"))
                    );
                    assert.ok(
                      failures.includes(`missing_evidence:recorded:${id}`)
                    );
                    assert.ok(failures.includes("quality_not_reviewed"));
                  }
                }
                assert.deepEqual(
                  store.query(
                    "select user_id,article_slug from wiki_bookmarks order by user_id,article_slug"
                  ),
                  bookmarksBefore
                );
                assert.equal(
                  store.sql("select count(*) from evry_plan_confirmations"),
                  "0"
                );
              } finally {
                await fixture.cleanup();
              }
            }
          });
          for (const session of new Set(boundSessions))
            assert.equal(
              store.sql(`select count(*) from sessions where id='${session}'`),
              "0",
              "Adapter cleanup revokes each isolated session"
            );
          for (const plant of new Set(boundPlants)) {
            const local = store.query(
              `select slug from wiki_articles where church_id='${plant}' and title='Orientation preparation'`
            );
            if (local.length)
              assert.equal(
                store.sql(
                  `select count(*) from wiki_articles where church_id is null and slug='${z.string().parse(local[0]!.slug)}'`
                ),
                "0",
                "Adapter cleanup removes its global override control"
              );
          }
        }
      );
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = fetch;
      for (const [key, value] of Object.entries({
        DATABASE_URL: previous.database,
        RESEND_API_KEY: previous.resend,
        LIVE_DB_TESTS: previous.live,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      neonConfig.fetchEndpoint = previous.endpoint;
      await stack.cleanup();
    }
  }
);
