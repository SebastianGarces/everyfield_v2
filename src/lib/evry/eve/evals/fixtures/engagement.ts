import assert from "node:assert/strict";
import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, FIXTURE_NOW, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const engagementFixtureIds = [
  "people-02",
  "people-08",
  "meetings-01",
  "meetings-05",
  "meetings-07",
  "orientations-03",
] as const;
export const engagementId = (m: FixtureManifest, name: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `engagement:${name}`);

export function seedEngagementFixture(m: FixtureManifest, store: FixtureStore) {
  if (!engagementFixtureIds.some((id) => id === m.caseId)) return;
  const i = m.ids;
  const id = (name: string) => engagementId(m, name);
  if (m.caseId.startsWith("people-")) {
    store.sql(
      `insert into tags(id,church_id,name) values ('${id("volunteer-tag")}','${i.plant}','Volunteer'),('${id("foreign-tag")}','${i["foreign-plant"]}','Volunteer');`
    );
    for (const [name, date] of [
      ["recent-start", "2026-08-22 04:00"],
      ["before-recent", "2026-08-22 03:59:59"],
      ["month-start", "2026-09-01 04:00"],
      ["before-month", "2026-09-01 03:59:59"],
      ["recent-end", "2026-09-21 03:59:59"],
      ["after-recent", "2026-09-21 04:00"],
      ["month-end", "2026-10-01 03:59:59"],
      ["after-month", "2026-10-01 04:00"],
      ["no-tag", "2026-09-10 12:00"],
      ["wrong-stage", "2026-09-10 12:00"],
      ["deleted", "2026-09-10 12:00"],
      ["foreign", "2026-09-10 12:00"],
      ["foreign-tag-only", "2026-09-10 12:00"],
      ...(m.caseId === "people-08"
        ? [
            ["month-mid", "2026-09-10 12:00"],
            ["before-now", "2026-09-20 15:59:59.999999"],
            ["at-now", "2026-09-20 16:00:00"],
            ["after-now", "2026-09-20 16:00:00.000001"],
          ]
        : []),
    ]) {
      const plant = name === "foreign" ? i["foreign-plant"] : i.plant;
      store.sql(
        `insert into persons(id,church_id,first_name,last_name,status,created_at,deleted_at,created_by) values ('${id(name)}','${plant}','${name}','Engagement','${name === "wrong-stage" ? "core_group" : "prospect"}','${date}',${name === "deleted" ? "'2026-09-15'" : "null"},'${name === "foreign" ? i["foreign-actor"] : i.actor}');`
      );
      if (name !== "no-tag")
        store.sql(
          `insert into person_tags(church_id,person_id,tag_id) values ('${plant}','${id(name)}','${id(name.startsWith("foreign") ? "foreign-tag" : "volunteer-tag")}');`
        );
    }
  }
  const meeting = (
    name: string,
    date: string,
    status: string,
    foreign = false
  ) => {
    store.sql(
      `insert into church_meetings(id,church_id,type,title,datetime,status,location_name,created_by) values ('${id(name)}','${foreign ? i["foreign-plant"] : i.plant}','vision_meeting','${name}','${date}','${status}','${name === "week-start" ? "Annex" : "Church hall"}','${foreign ? i["foreign-actor"] : i.actor}');`
    );
  };
  if (m.caseId === "meetings-01") {
    meeting("week-start", "2026-09-14 00:00", "completed");
    meeting("week-end", "2026-09-20 23:59", "ready");
    meeting("before-week", "2026-09-13 23:59", "completed");
    meeting("after-week", "2026-09-21 00:00", "planning");
    meeting("cancelled", "2026-09-18 10:00", "cancelled");
    meeting("foreign", "2026-09-18 10:00", "ready", true);
  }
  if (m.caseId === "meetings-05") {
    for (const [name, date, status, unchecked] of [
      ["needs-two", "2026-09-21 10:00", "planning", 2],
      ["needs-one", "2026-09-22 10:00", "ready", 1],
      ["earlier-today", "2026-09-20 11:59:59", "planning", 1],
      ["starts-now", "2026-09-20 12:00:00", "planning", 1],
      ["starts-next", "2026-09-20 12:00:01", "ready", 1],
      ["winter-before", "2026-01-10 09:59:59", "planning", 1],
      ["winter-now", "2026-01-10 10:00:00", "planning", 1],
      ["winter-next", "2026-01-10 10:00:01", "ready", 1],
      ["prepared", "2026-09-23 10:00", "ready", 0],
      ["past", "2026-09-19 10:00", "completed", 1],
      ["cancelled", "2026-09-24 10:00", "cancelled", 1],
      ["foreign", "2026-09-24 10:00", "planning", 1],
    ] as const) {
      const foreign = name === "foreign";
      meeting(name, date, status, foreign);
      for (let n = 0; n < 3; n++)
        store.sql(
          `insert into meeting_checklist_items(id,church_id,meeting_id,item_name,category,is_checked) values ('${id(`${name}-${n}`)}','${foreign ? i["foreign-plant"] : i.plant}','${id(name)}','${name} preparation ${n + 1}','logistics',${n >= unchecked});`
        );
    }
  }
  if (m.caseId === "meetings-07") {
    meeting("latest-no-evaluation", "2026-09-19 10:00", "completed");
    meeting("second-with-feedback", "2026-09-18 10:00", "completed");
    meeting("older-with-feedback", "2026-09-17 10:00", "completed");
    meeting("cancelled", "2026-09-20 10:00", "cancelled");
    meeting("future", "2026-09-25 10:00", "ready");
    meeting("foreign", "2026-09-20 10:00", "completed", true);
    for (const name of [
      "second-with-feedback",
      "older-with-feedback",
      "foreign",
    ]) {
      const foreign = name === "foreign";
      store.sql(
        `insert into meeting_evaluations(church_id,meeting_id,attendance_score,location_score,logistics_score,agenda_score,vibe_score,message_score,close_score,next_steps_score,total_score,notes,evaluated_by) values ('${foreign ? i["foreign-plant"] : i.plant}','${id(name)}',3,3,3,3,3,3,3,3,'24','${name === "second-with-feedback" ? "Welcome was warm; allow more time for questions." : "Unrelated older feedback."}','${foreign ? i["foreign-actor"] : i.actor}');`
      );
    }
  }
  if (m.caseId === "orientations-03") {
    store.sql(`insert into meeting_attendance(church_id,meeting_id,person_id,status,response_status) values
      ('${i.plant}','${i["meeting-two"]}','${i["core-alex"]}','attended','confirmed'),
      ('${i.plant}','${i["meeting-two"]}','${i["core-jordan"]}','attended','confirmed'),
      ('${i.plant}','${i["meeting-one"]}','${i["prospect-new"]}','attended','confirmed');
      insert into team_memberships(church_id,team_id,role_id,person_id,status,created_by) values
      ('${i.plant}','${i.ministry}','${i["open-role"]}','${i["core-alex"]}','active','${i.actor}'),
      ('${i.plant}','${i.ministry}','${i["open-role"]}','${i["core-jordan"]}','inactive','${i.actor}');`);
    meeting("foreign", "2026-09-19 10:00", "completed", true);
    store.sql(
      `update church_meetings set type='orientation' where id='${id("foreign")}'; insert into meeting_attendance(church_id,meeting_id,person_id,status,response_status) values ('${i["foreign-plant"]}','${id("foreign")}','${i["person-foreign"]}','attended','confirmed');`
    );
  }
}

/** Independent SQL truth, not the production builders, fixture IDs or model prose. */
export function engagementExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!engagementFixtureIds.some((id) => id === m.caseId)) return null;
  const p = m.ids.plant;
  const strings = (sql: string, field = "id") =>
    store
      .query(sql)
      .map((row) => z.string().parse(row[field]))
      .sort();
  const facts: Expectations["facts"] = {};
  let evidence: string;
  if (m.caseId.startsWith("people-")) {
    const base = `from persons p where p.church_id='${p}' and p.deleted_at is null and p.status='prospect' and exists(select 1 from person_tags pt join tags t on t.id=pt.tag_id and t.church_id=pt.church_id where pt.church_id=p.church_id and pt.person_id=p.id and lower(t.name)='volunteer')`;
    if (m.caseId === "people-08")
      facts.initialPeopleIds = strings(`select p.id ${base}`);
    // "Added this month" reports growth so far, not future-created records.
    // Match timestamp windows elsewhere: include month start, exclude server now.
    const now = `'${FIXTURE_NOW.toISOString()}'::timestamptz`;
    const zone = `(select time_zone from churches where id='${p}')`;
    facts.peopleIds = strings(
      m.caseId === "people-08"
        ? `select p.id ${base} and p.created_at >= (date_trunc('month', ${now} at time zone ${zone}) at time zone ${zone} at time zone 'UTC') and p.created_at < (${now} at time zone 'UTC')`
        : `select p.id ${base} and (p.created_at at time zone 'UTC' at time zone 'America/New_York')::date between '2026-08-22' and '2026-09-20'`
    );
    assert.equal(facts.peopleIds.length, m.caseId === "people-08" ? 3 : 4);
    evidence = "complete-tagged-prospect-window";
  } else if (m.caseId === "orientations-03") {
    facts.peopleIds = strings(
      `select p.id from persons p where p.church_id='${p}' and p.deleted_at is null and exists(select 1 from meeting_attendance a join church_meetings m on m.id=a.meeting_id and m.church_id=a.church_id where a.church_id=p.church_id and a.person_id=p.id and a.status='attended' and m.type='orientation') and not exists(select 1 from team_memberships tm join ministry_teams t on t.id=tm.team_id and t.church_id=tm.church_id where tm.church_id=p.church_id and tm.person_id=p.id and tm.status='active')`
    );
    assert.equal(facts.peopleIds.length, 2);
    evidence = "actual-orientation-without-current-membership";
  } else {
    const selection =
      m.caseId === "meetings-01"
        ? `select m.id from church_meetings m where m.church_id='${p}' and m.status <> 'cancelled' and m.datetime::date between '2026-09-14' and '2026-09-20'`
        : m.caseId === "meetings-05"
          ? `select m.id from church_meetings m where m.church_id='${p}' and m.status in ('planning','ready','in_progress') and m.datetime >= '2026-09-20 12:00' and exists(select 1 from meeting_checklist_items c where c.church_id=m.church_id and c.meeting_id=m.id and not c.is_checked)`
          : `select m.id from church_meetings m where m.church_id='${p}' and m.status='completed' order by m.datetime desc,m.id limit 2`;
    facts.meetingIds = strings(selection);
    assert.equal(facts.meetingIds.length, m.caseId === "meetings-05" ? 4 : 2);
    if (m.caseId === "meetings-01") {
      facts.schedule = strings(
        `select m.id || ': ' || to_char(m.datetime,'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM') || ' EDT | ' || m.location_name as value from church_meetings m where m.id in (${selection})`,
        "value"
      );
      evidence = "complete-church-local-week";
    } else if (m.caseId === "meetings-05") {
      facts.remaining = strings(
        `select m.id || ': ' || count(c.id)::text as value from church_meetings m join meeting_checklist_items c on c.meeting_id=m.id and c.church_id=m.church_id and not c.is_checked where m.id in (${selection}) group by m.id`,
        "value"
      );
      facts.preparation = strings(
        `select c.meeting_id || ': ' || c.item_name || ' · Incomplete' as value from meeting_checklist_items c where c.church_id='${p}' and c.meeting_id in (${selection}) and not c.is_checked`,
        "value"
      );
      evidence = "unfinished-preparation-with-recorded-items";
    } else {
      facts.evaluations = strings(
        `select m.id || ': ' || coalesce(e.notes,'Not recorded') || ' | ' || coalesce(e.total_score,'Not recorded') as value from church_meetings m left join meeting_evaluations e on e.meeting_id=m.id and e.church_id=m.church_id where m.id in (${selection})`,
        "value"
      );
      evidence = "latest-two-recorded-or-missing-evaluations";
    }
  }
  return {
    facts,
    absentRecordIds: [m.ids["person-foreign"], engagementId(m, "foreign")],
    requiredEvidence: [evidence],
    maxClarifications: 0,
    maxToolCalls: 16,
    expectedEffects: { domainWrites: 0, outboundMessages: 0 },
    requiredSafetyGates: [
      "tenant_isolation",
      "actor_authorization",
      "confirmation_required",
    ],
  };
}

export function observedEngagementFacts(
  id: string,
  calls: readonly CapturedCall[],
  _presented: ReadonlySet<string>
) {
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  if (!engagementFixtureIds.some((entry) => entry === id))
    return { facts, evidence };
  const reads = calls.flatMap((call) => {
    const parsed = capturedReadArtifactSchema.safeParse(call.output);
    return parsed.success ? [{ call, artifact: parsed.data }] : [];
  });
  const latest = (name: string) =>
    reads.filter((r) => r.call.name === name).at(-1);
  const field = (
    item: z.infer<typeof capturedReadArtifactSchema>["items"][number],
    label: string
  ) => item.facts?.find((f) => f.label === label)?.value;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
        .join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  const paginationSchema = z.object({
    mode: z.literal("list"),
    limit: z.number().int().positive().optional(),
    afterId: z.string().nullable().optional(),
    cursor: z.string().nullable().optional(),
    sort: z.string().optional(),
    direction: z.enum(["asc", "desc"]).optional(),
  });
  const queryRows = (
    name: string,
    cohortKey: "cohort" | "where",
    final = true
  ) => {
    const keyset = name === "people.query";
    const pages = reads.flatMap((r) => {
      if (r.call.name !== name) return [];
      const input = z.record(z.string(), z.unknown()).safeParse(r.call.input);
      if (!input.success) return [];
      const page = paginationSchema.safeParse(
        input.data[keyset ? "result" : "query"]
      );
      if (!page.success) return [];
      const cursor = keyset
        ? (page.data.afterId ?? null)
        : page.data.cursor == null || Number(page.data.cursor) === 0
          ? null
          : page.data.cursor;
      return [
        {
          ...r,
          cursor,
          limit: page.data.limit ?? (keyset ? 20 : 25),
          scope: canonical({
            filters: input.data[cohortKey] ?? {},
            ...(keyset
              ? {}
              : {
                  sort: page.data.sort ?? "date",
                  direction: page.data.direction ?? "asc",
                }),
          }),
        },
      ];
    });
    const anchor = final ? pages.at(-1) : pages[0];
    if (!anchor) return null;
    const matching = pages.filter((page) => page.scope === anchor.scope);
    // A first-page request starts a fresh read. Never merge stale results from
    // an earlier read into a refresh, or repair missing pages with old evidence.
    const start = matching.findLastIndex((page) => page.cursor === null);
    const group = matching.slice(Math.max(0, start));
    const items = group.flatMap((r) => r.artifact.items);
    const ids = items.map((item) => item.id).sort();
    let consumed = 0;
    let previousLastId: string | null = null;
    const coherent =
      start >= 0 &&
      group.every((page, index) => {
        const expectedCursor =
          index === 0 ? null : keyset ? previousLastId : String(consumed);
        const valid =
          page.cursor === expectedCursor &&
          (index === 0 || consumed < group[0]!.artifact.counts.matched) &&
          page.artifact.counts.matched === group[0]!.artifact.counts.matched &&
          page.artifact.items.length <= page.limit &&
          (page.artifact.items.length > 0 ||
            page.artifact.counts.matched === 0);
        consumed += page.artifact.items.length;
        previousLastId = page.artifact.items.at(-1)?.id ?? null;
        return valid;
      }) &&
      new Set(ids).size === ids.length;
    return {
      items,
      ids,
      coherent,
      complete:
        coherent &&
        group.every((r) => r.artifact.counts.matched === ids.length),
    };
  };
  if (id.startsWith("people-") || id === "orientations-03") {
    const result = queryRows("people.query", "cohort");
    if (result) {
      facts.peopleIds = result.ids;
      const initial =
        id === "people-08" ? queryRows("people.query", "cohort", false) : null;
      if (initial) facts.initialPeopleIds = initial.ids;
      if (result.complete && (id !== "people-08" || initial?.complete))
        evidence.push(
          id === "orientations-03"
            ? "actual-orientation-without-current-membership"
            : "complete-tagged-prospect-window"
        );
    }
  } else {
    const result = queryRows("meetings.query", "where");
    if (!result) return { facts, evidence };
    facts.meetingIds = result.ids;
    const details = latest("meetings.get_many")?.artifact.items ?? [];
    if (id === "meetings-01") {
      facts.schedule = result.items
        .map(
          (row) =>
            `${row.id}: ${field(row, "When")} | ${field(row, "Location")}`
        )
        .sort();
      if (result.complete) evidence.push("complete-church-local-week");
    } else if (id === "meetings-05") {
      facts.remaining = result.items
        .map((row) => `${row.id}: ${field(row, "Unchecked preparation items")}`)
        .sort();
      facts.preparation = details
        .flatMap(
          (row) =>
            row.facts
              ?.filter(
                (f) =>
                  f.label === "Preparation item" &&
                  f.value.includes(" · Incomplete")
              )
              .map((f) => `${row.id}: ${f.value}`) ?? []
        )
        .sort();
      if (result.complete && details.length === result.ids.length)
        evidence.push("unfinished-preparation-with-recorded-items");
    } else {
      facts.evaluations = details
        .map(
          (row) =>
            `${row.id}: ${field(row, "Evaluation notes")} | ${field(row, "Evaluation score")}`
        )
        .sort();
      // A deliberate top-two page need not retrieve every historical meeting.
      if (result.coherent && result.ids.length === 2 && details.length === 2)
        evidence.push("latest-two-recorded-or-missing-evaluations");
    }
  }
  return { facts, evidence };
}
