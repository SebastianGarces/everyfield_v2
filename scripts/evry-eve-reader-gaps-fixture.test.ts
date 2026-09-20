import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../src/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "../src/lib/evry/eve/evals/fixtures/manifest";

test(
  "extended Eve readers use real scoped data and retain private check-in authority",
  { skip: process.env.EVRY_EVE_READER_PROOF !== "1", timeout: 180_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { createEveToolRegistry } =
        await import("../src/lib/evry/eve/capabilities/registry");
      const { requireEvryPlantViewerForSession } =
        await import("../src/lib/evry/eligibility/viewer");
      const { authorizeEvryReadCapabilityForSession } =
        await import("../src/lib/evry/eligibility/capabilities");
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("reader-gaps", 0);
      store.seed(m);
      const memberSession = createHash("sha256")
        .update("reader-gaps-member")
        .digest("hex");
      store.sql(`insert into sessions(id,user_id,expires_at) values ('${memberSession}','${m.ids["other-actor"]}',now()+interval '1 day');
      insert into planter_checkins(church_id,week_start,spiritually,marriage_family,financially,pace,note,answered_by_id) values
      ('${m.ids.plant}',date_trunc('week',now()),'steady','strained','steady','steady','OWN PRIVATE CHECKIN','${m.ids.actor}'),
      ('${m.ids["foreign-plant"]}',date_trunc('week',now()),'steady','steady','steady','steady','FOREIGN PRIVATE CHECKIN','${m.ids["foreign-actor"]}');`);
      store.sql(`insert into tags(id,church_id,name) values ('${m.ids["wiki-vision"]}','${m.ids.plant}','Welcome'), ('${m.ids["wiki-foreign"]}','${m.ids["foreign-plant"]}','Welcome');
        insert into person_tags(church_id,person_id,tag_id) values ('${m.ids.plant}','${m.ids["core-alex"]}','${m.ids["wiki-vision"]}'), ('${m.ids["foreign-plant"]}','${m.ids["person-foreign"]}','${m.ids["wiki-foreign"]}');
        insert into skills_inventory(church_id,person_id,skill_category,skill_name,proficiency,notes) values
        ('${m.ids.plant}','${m.ids["core-alex"]}','hospitality','Welcoming','experienced','Own skill note'),
        ('${m.ids["foreign-plant"]}','${m.ids["person-foreign"]}','hospitality','FOREIGN SKILL','experienced','Foreign skill note');`);
      const audit = store.auditStart();
      const registryFor = async (sessionId: string) => {
        const actor = await requireEvryPlantViewerForSession(sessionId);
        assert.ok(actor);
        return createEveToolRegistry({
          context: {
            actor,
            literalUserText: "Show my information",
            pageContext: null,
            now: new Date(),
          },
          authorizeRead: (identity) =>
            authorizeEvryReadCapabilityForSession(identity, sessionId),
        });
      };
      const owner = await registryFor(m.sessionId);
      const mergeContext = await owner.invoke("communication.query", {
        query: { resource: "merge_context" },
      });
      assert.match(JSON.stringify(mergeContext), /Eve fixture/);
      assert.match(JSON.stringify(mergeContext), /Fixture Owner/);
      assert.match(JSON.stringify(mergeContext), /Oct.*11.*2026/);
      assert.doesNotMatch(
        JSON.stringify(mergeContext),
        /Foreign Owner|Foreign fixture/
      );
      const people = await owner.invoke("people.query", {
        cohort: { all: { tags: { names: ["WELCOME"] } } },
        result: { mode: "list" },
      });
      assert.deepEqual(
        z
          .object({ items: z.array(z.object({ id: z.string() })) })
          .parse(people)
          .items.map((item) => item.id),
        [m.ids["core-alex"]]
      );
      const details = await owner.invoke("people.get_many", {
        resource: "person",
        ids: [
          m.ids["core-alex"],
          m.ids["core-jordan"],
          m.ids["person-foreign"],
        ],
        fields: ["tags", "skills"],
      });
      const detailItems = z
        .object({
          items: z.array(z.object({ id: z.string(), label: z.string() })),
        })
        .parse(details).items;
      assert.equal(
        detailItems.filter((item) => item.label !== "Record unavailable")
          .length,
        2
      );
      assert.equal(
        detailItems.find((item) => item.id === m.ids["person-foreign"])?.label,
        "Record unavailable"
      );
      assert.match(JSON.stringify(details), /Welcome/);
      assert.match(JSON.stringify(details), /Welcoming/);
      assert.match(JSON.stringify(details), /Own skill note/);
      assert.doesNotMatch(
        JSON.stringify(details),
        /FOREIGN SKILL|Foreign skill note/
      );
      const checkins = await owner.invoke("intelligence.query", {
        query: { resource: "checkins" },
      });
      assert.match(JSON.stringify(checkins), /OWN PRIVATE CHECKIN/);
      assert.doesNotMatch(JSON.stringify(checkins), /FOREIGN PRIVATE CHECKIN/);
      const member = await registryFor(memberSession);
      assert.deepEqual(
        await member.invoke("intelligence.query", {
          query: { resource: "checkins" },
        }),
        { status: "unavailable", reason: "not_authorized" }
      );
      for (const resource of ["feedback", "signals"]) {
        const result = await owner.invoke("intelligence.query", {
          query: { resource },
        });
        assert.equal(
          typeof result === "object" &&
            result !== null &&
            !Array.isArray(result) &&
            result.kind,
          "read",
          JSON.stringify(result)
        );
      }
      const templates = await owner.invoke("tasks.query", {
        resource: "templates",
      });
      assert.match(JSON.stringify(templates), /vision-meeting-preparation/);
      assert.doesNotMatch(
        JSON.stringify(templates),
        /not_authorized|unavailable/
      );
      const phase = await owner.invoke("tasks.query", {
        resource: "phase_prompt",
      });
      assert.equal(
        typeof phase === "object" &&
          phase !== null &&
          !Array.isArray(phase) &&
          phase.kind,
        "read",
        JSON.stringify(phase)
      );
      assert.deepEqual(store.writesSince(audit, m), []);
      store.revoke(m);
      await assert.rejects(
        owner.invoke("tasks.query", { resource: "templates" }),
        { digest: "EF_SESSION_EXPIRED" }
      );
    } finally {
      await stack.cleanup();
    }
  }
);
