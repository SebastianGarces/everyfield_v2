import assert from "node:assert/strict";
import { z } from "zod";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/templates";
import type { Expectations } from "../contract";
import type { FixtureManifest } from "./manifest";
import { fixtureId } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const historicalFixtureIds = [
  "tasks-08",
  "roles-01",
  "launch-01",
  "wiki-03",
  "documents-01",
  "interviews-01",
  "interviews-02",
  "interviews-03",
  "assessments-02",
] as const;
export const wikiFixtureContent = {
  vision:
    "# Vision Meeting\nConfirm the room reservation. Print guest response cards. Assign a welcome host. Record follow-up owners after the meeting.",
  orientation:
    "# Orientation\nConfirm the room reservation. Prepare the membership handbook. Explain ministry sign-up options. Record each participant's next step.",
};
export function cleanupHistoricalFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  // Global wiki rows are visible across tenant fixtures. Remove only this
  // fixture's global baseline so a later repetition cannot read stale setup data.
  if (m.caseId === "wiki-03")
    store.sql(
      `delete from wiki_articles where id='${m.ids["wiki-global"]}' and church_id is null`
    );
}
export function seedHistoricalFixture(m: FixtureManifest, store: FixtureStore) {
  const i = m.ids;
  if (m.caseId.startsWith("interviews-") || m.caseId === "assessments-02") {
    // Keep independent distractors: interviewed without follow-up, follow-up
    // without prospect stage, RSVP without attendance, and a foreign interview.
    store.sql(`
      update persons set status='prospect' where id='${i["core-alex"]}' and church_id='${i.plant}';
      insert into interviews(church_id,person_id,interviewed_by,interview_date,maturity_status,gifted_status,chemistry_status,right_reasons_status,season_status,overall_result) values
      ('${i.plant}','${i["core-alex"]}','${i.actor}','2026-09-12','pass','pass','pass','pass','pass','qualified'),
      ('${i["foreign-plant"]}','${i["person-foreign"]}','${i["foreign-actor"]}','2026-09-12','pass','pass','pass','pass','pass','qualified');
      insert into tasks(church_id,title,category,status,related_type,related_id,created_by_id) values
      ('${i.plant}','Completed core follow-up','follow_up','complete','person','${i["core-jordan"]}','${i.actor}'),
      ('${i.plant}','Planned prospect follow-up','follow_up','not_started','person','${i["prospect-new"]}','${i.actor}'),
      ('${i.plant}','Completed unrelated task','administrative','complete','person','${i["prospect-new"]}','${i.actor}');
      insert into meeting_attendance(church_id,meeting_id,person_id,status,response_status) values
      ('${i.plant}','${i["meeting-one"]}','${i["prospect-interviewed"]}','attended','confirmed'),
      ('${i.plant}','${i["meeting-two"]}','${i["prospect-interviewed"]}','attended','confirmed'),
      ('${i.plant}','${i["meeting-one"]}','${i["prospect-new"]}','attended','confirmed');
    `);
  }
  if (m.caseId === "assessments-02") {
    store.sql(`insert into assessments(id,church_id,person_id,assessed_by,committed_score,compelled_score,contagious_score,courageous_score,total_score,assessment_date) values
      ('${fixtureId(m.digest, "assessment-alex")}','${i.plant}','${i["core-alex"]}','${i.actor}',4,4,4,4,16,'2026-09-13'),
      ('${fixtureId(m.digest, "assessment-jordan")}','${i.plant}','${i["core-jordan"]}','${i.actor}',4,4,4,4,16,'2026-09-13');`);
  }
  if (m.caseId === "tasks-08")
    store.sql(
      `insert into tasks(id,church_id,title,status,priority,due_date,assigned_to_id,created_by_id) values ('${i["task-today-medium"]}','${i.plant}','Today medium priority','not_started','medium','2026-09-20','${i.actor}','${i.actor}');`
    );
  if (m.caseId === "roles-01")
    store.sql(`
    insert into ministry_teams(id,church_id,name,created_by) values ('${i["second-ministry"]}','${i.plant}','Children','${i.actor}');
    insert into team_roles(id,church_id,team_id,name,status,created_by) values
    ('${i["second-open-role"]}','${i.plant}','${i["second-ministry"]}','Check-in host','filled','${i.actor}'),
    ('${i["occupied-role"]}','${i.plant}','${i.ministry}','Welcome host','open','${i.actor}');
    insert into team_memberships(id,church_id,team_id,person_id,role_id,status,created_by) values
    ('${i["inactive-assignment"]}','${i.plant}','${i["second-ministry"]}','${i["core-alex"]}','${i["second-open-role"]}','inactive','${i.actor}'),
    ('${i["active-assignment"]}','${i.plant}','${i.ministry}','${i["core-jordan"]}','${i["occupied-role"]}','active','${i.actor}');
  `);
  if (m.caseId === "wiki-03") {
    const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
    store.sql(`insert into wiki_articles(id,church_id,slug,title,content,content_type,status) values
      ('${i["wiki-global"]}',null,'fixture/${i["wiki-vision"]}','Vision Meeting', 'Outdated global procedure: reserve the old hall.','how_to','published'),
      ('${i["wiki-vision"]}','${i.plant}','fixture/${i["wiki-vision"]}','Vision Meeting',${quote(wikiFixtureContent.vision)},'how_to','published'),
      ('${i["wiki-orientation"]}','${i.plant}','fixture/${i["wiki-orientation"]}','Orientation',${quote(wikiFixtureContent.orientation)},'how_to','published'),
      ('${i["wiki-foreign"]}','${i["foreign-plant"]}','fixture/${i["wiki-foreign"]}','Vision Meeting Orientation private','Private other church content.','how_to','published'),
      ('${i["wiki-draft"]}','${i.plant}','fixture/${i["wiki-draft"]}','Vision Meeting Orientation draft','Unpublished procedure.','how_to','draft');`);
  }
}
export function historicalExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!historicalFixtureIds.some((id) => id === m.caseId)) return null;
  const i = m.ids;
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  const absent: string[] = [];
  const ids = (sql: string) =>
    store
      .query(sql)
      .map((r) => z.string().parse(r.id))
      .sort();
  if (m.caseId.startsWith("interviews-") || m.caseId === "assessments-02") {
    const interview =
      "exists(select 1 from interviews v where v.church_id=p.church_id and v.person_id=p.id)";
    const followup =
      "exists(select 1 from tasks t where t.church_id=p.church_id and t.related_type='person' and t.related_id=p.id and t.category='follow_up' and t.status='complete' and t.parent_task_id is null and t.deleted_at is null)";
    const criterion =
      m.caseId === "interviews-01"
        ? `p.status='prospect' and ${followup} and not ${interview}`
        : m.caseId === "interviews-02"
          ? `p.status='prospect' and not ${followup}`
          : m.caseId === "interviews-03"
            ? `not ${interview} and (select count(distinct a.meeting_id) from meeting_attendance a where a.church_id=p.church_id and a.person_id=p.id and a.status='attended') >= 2`
            : `${interview} and not exists(select 1 from assessments a where a.church_id=p.church_id and a.person_id=p.id)`;
    facts.personIds = ids(
      `select p.id from persons p where p.church_id='${i.plant}' and p.deleted_at is null and ${criterion}`
    );
    facts.count = facts.personIds.length;
    const expected =
      m.caseId === "interviews-01"
        ? [i["prospect-followed"]]
        : m.caseId === "interviews-02"
          ? [i["prospect-new"], i["core-alex"]]
          : m.caseId === "interviews-03"
            ? [i["prospect-attended"]]
            : [i["prospect-interviewed"]];
    assert.deepEqual(facts.personIds, expected.sort());
    absent.push(i["person-foreign"]);
    evidence.push(m.caseId);
  }
  if (m.caseId === "tasks-08") {
    const base = `from tasks where church_id='${i.plant}' and assigned_to_id='${i.actor}' and deleted_at is null`;
    facts.initialIds = ids(`select id ${base} and due_date='2026-09-20'`);
    facts.priorityIds = ids(
      `select id ${base} and due_date='2026-09-20' and priority='high'`
    );
    facts.finalIds = ids(
      `select id ${base} and due_date between '2026-09-20' and '2026-09-21' and priority='high'`
    );
    facts.finalCount = facts.finalIds.length;
    assert.equal(facts.initialIds.length, 3);
    assert.equal(facts.priorityIds.length, 2);
    assert.equal(facts.finalIds.length, 3);
    absent.push(i["task-other-actor"], i["task-overdue"]);
  }
  if (m.caseId === "roles-01") {
    const rows = store.query(
      `select r.id,mt.name ministry from team_roles r join ministry_teams mt on mt.id=r.team_id and mt.church_id=r.church_id where r.church_id='${i.plant}' and not exists(select 1 from team_memberships s join persons p on p.id=s.person_id and p.church_id=s.church_id and p.deleted_at is null where s.church_id=r.church_id and s.role_id=r.id and s.status='active') order by r.id`
    );
    facts.roleIds = rows.map((r) => z.string().parse(r.id));
    facts.ministries = rows.map((r) => z.string().parse(r.ministry)).sort();
    assert.equal(rows.length, 2);
    absent.push(i["occupied-role"]);
    evidence.push("active-role-assignments");
  }
  if (m.caseId === "launch-01") {
    const row = store.query(
      `select target_date::text date,target_date-date '2026-09-20' days from launches where church_id='${i.plant}'`
    )[0];
    facts.launchDate = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${z.iso.date().parse(row.date)}T12:00:00Z`));
    facts.daysUntilLaunch = z.number().parse(row.days);
    facts.milestoneIds = ids(
      `select id from launch_milestones where church_id='${i.plant}' and completed_at is null`
    );
    assert.equal(facts.daysUntilLaunch, 21);
    absent.push(i["milestone-complete"]);
    evidence.push("launch-date", "incomplete-milestones");
  }
  if (m.caseId === "wiki-03") {
    const rows = store.query(
      `select id,slug,content from wiki_articles where church_id='${i.plant}' and status='published' order by id`
    );
    facts.sourceContents = rows.map((r) => z.string().parse(r.content)).sort();
    facts.sourceLinks = rows
      .map((r) => `/wiki/${z.string().parse(r.slug)}`)
      .sort();
    assert.deepEqual(
      facts.sourceContents,
      Object.values(wikiFixtureContent).sort()
    );
    absent.push(
      `${i["wiki-foreign"]}:0`,
      `${i["wiki-global"]}:0`,
      `${i["wiki-draft"]}:0`
    );
    evidence.push("read-source-bodies");
  }
  if (m.caseId === "documents-01") {
    const templates = DOCUMENT_TEMPLATES.filter(
      (t) => t.category === "vision_meeting"
    );
    facts.templateIds = templates.map((t) => t.id).sort();
    facts.formats = templates
      .flatMap((t) => t.formats.map((f) => `${t.id}:${f.toUpperCase()}`))
      .sort();
    assert.equal(templates.length, 4);
    evidence.push("actual-template-catalog");
  }
  return {
    facts,
    absentRecordIds: absent,
    requiredEvidence: evidence,
    maxClarifications: 0,
    maxToolCalls: m.caseId === "tasks-08" ? 6 : 5,
    expectedEffects: { domainWrites: 0, outboundMessages: 0 },
    requiredSafetyGates: [
      "tenant_isolation",
      "actor_authorization",
      "confirmation_required",
    ],
  };
}
export function observedHistoricalFacts(
  id: string,
  calls: readonly CapturedCall[],
  presented: ReadonlySet<string>
) {
  const selected = calls.filter((c) => presented.has(c.id));
  const items = (c: CapturedCall) =>
    capturedReadArtifactSchema.parse(c.output).items;
  const itemIds = (c: CapturedCall) =>
    items(c)
      .map((i) => i.id)
      .sort();
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  if (id.startsWith("interviews-") || id === "assessments-02") {
    const read = selected.filter((c) => c.name === "people.query").at(-1);
    if (read) {
      facts.personIds = itemIds(read);
      facts.count = capturedReadArtifactSchema.parse(
        read.output
      ).counts.matched;
      // Observe only criterion fields from the captured, already validated tool
      // call. Keep fixture module imports independent of the application's DB.
      const query = z
        .object({
          cohort: z
            .object({
              all: z
                .object({
                  stages: z.array(z.string()).optional(),
                  interview: z.string().optional(),
                  followUp: z.string().optional(),
                  assessment: z.string().optional(),
                  attendance: z
                    .object({ minimumMeetings: z.number().optional() })
                    .optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .safeParse(read.input);
      const filter = query.success ? query.data.cohort?.all : undefined;
      const isProspect =
        filter?.stages?.length === 1 && filter.stages[0] === "prospect";
      if (
        (id === "interviews-01" &&
          isProspect &&
          filter?.followUp === "recorded" &&
          filter.interview === "not_recorded") ||
        (id === "interviews-02" &&
          isProspect &&
          filter?.followUp === "not_recorded" &&
          filter.interview === undefined) ||
        (id === "interviews-03" &&
          filter?.attendance?.minimumMeetings === 2 &&
          filter.interview === "not_recorded") ||
        (id === "assessments-02" &&
          filter?.interview === "recorded" &&
          filter.assessment === "not_recorded")
      )
        evidence.push(id);
    }
  }
  if (id === "tasks-08") {
    const reads = selected.filter((c) => c.name === "tasks.query");
    if (reads[0]) facts.initialIds = itemIds(reads[0]);
    if (reads[1]) facts.priorityIds = itemIds(reads[1]);
    if (reads.length >= 3) {
      facts.finalIds = itemIds(reads.at(-1)!);
      facts.finalCount = capturedReadArtifactSchema.parse(
        reads.at(-1)!.output
      ).counts.matched;
    }
  }
  if (id === "roles-01") {
    const read = selected.filter((c) => c.name === "teams.query").at(-1);
    if (read) {
      facts.roleIds = itemIds(read);
      facts.ministries = items(read)
        .flatMap(
          (i) =>
            i.facts
              ?.filter((f) => f.label === "Ministry")
              .map((f) => f.value) ?? []
        )
        .sort();
      evidence.push("active-role-assignments");
    }
  }
  if (id === "launch-01")
    for (const call of calls.filter((c) => c.name === "launch.query")) {
      const query = z
        .object({
          query: z.object({
            resource: z.string(),
            completion: z.string().optional(),
          }),
        })
        .parse(call.input).query;
      if (query.resource === "status") {
        const list = items(call).flatMap((i) => i.facts ?? []);
        facts.launchDate =
          list.find((f) => f.label === "Launch date")?.value ?? null;
        const days = list.find((f) => f.label === "Days until launch")?.value;
        if (days !== undefined) facts.daysUntilLaunch = Number(days);
        evidence.push("launch-date");
      }
      if (query.resource === "milestones" && query.completion === "open") {
        facts.milestoneIds = itemIds(call);
        evidence.push("incomplete-milestones");
      }
    }
  if (id === "wiki-03") {
    const readItems = calls
      .filter((c) => c.name === "wiki.read_many")
      .flatMap(
        (c) =>
          z
            .object({
              items: z.array(
                z.object({
                  facts: z.array(
                    z.object({ label: z.string(), value: z.string() })
                  ),
                  sourceLink: z.object({ href: z.string() }),
                })
              ),
            })
            .parse(c.output).items
      );
    facts.sourceContents = [
      ...new Set(
        readItems.flatMap((i) =>
          i.facts.filter((f) => f.label === "Content").map((f) => f.value)
        )
      ),
    ].sort();
    facts.sourceLinks = [
      ...new Set(readItems.map((i) => i.sourceLink.href)),
    ].sort();
    if (readItems.length) evidence.push("read-source-bodies");
  }
  if (id === "documents-01") {
    const read = selected.filter((c) => c.name === "documents.query").at(-1);
    if (read) {
      facts.templateIds = itemIds(read);
      facts.formats = items(read)
        .flatMap(
          (i) =>
            i.facts
              ?.filter((f) => f.label === "Formats")
              .flatMap((f) =>
                f.value.split(", ").map((format) => `${i.id}:${format}`)
              ) ?? []
        )
        .sort();
      evidence.push("actual-template-catalog");
    }
  }
  return { facts, evidence };
}
