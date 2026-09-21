import assert from "node:assert/strict";
import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const peopleHistoryFixtureIds = [
  "people-03",
  "interviews-05",
  "assessments-01",
  "assessments-04",
  "commitments-05",
] as const;
export const peopleHistoryId = (m: FixtureManifest, name: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `people-history:${name}`);

export function seedPeopleHistoryFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  if (!peopleHistoryFixtureIds.some((id) => id === m.caseId)) return;
  const i = m.ids;
  const id = (name: string) => peopleHistoryId(m, name);
  store.sql(
    `update persons set first_name='Alex' where id='${i["core-alex"]}'; update persons set first_name='Jordan' where id='${i["core-jordan"]}';`
  );
  if (m.caseId === "people-03")
    store.sql(`
    insert into skills_inventory(church_id,person_id,skill_category,skill_name) values
      ('${i.plant}','${i["core-alex"]}','worship','Music: piano'),
      ('${i.plant}','${i["core-alex"]}','worship','Music: vocals'),
      ('${i.plant}','${i["core-jordan"]}','worship','Music: guitar'),
      ('${i.plant}','${i["prospect-followed"]}','worship','Music: bass'),
      ('${i.plant}','${i["prospect-new"]}','hospitality','Welcome desk'),
      ('${i["foreign-plant"]}','${i["person-foreign"]}','worship','Music: piano');
    insert into team_memberships(church_id,team_id,role_id,person_id,status,created_by) values
      ('${i.plant}','${i.ministry}','${i["open-role"]}','${i["core-jordan"]}','active','${i.actor}'),
      ('${i.plant}','${i.ministry}','${i["open-role"]}','${i["prospect-followed"]}','inactive','${i.actor}');
  `);
  if (m.caseId === "interviews-05") {
    const rows = [
      [
        "alex-old",
        i.plant,
        i["core-alex"],
        i.actor,
        "2026-08-01",
        "2026-09-20 10:00",
        "not_qualified",
      ],
      [
        "alex-tie",
        i.plant,
        i["core-alex"],
        i.actor,
        "2026-09-18",
        "2026-09-18 10:00",
        "follow_up",
      ],
      [
        "alex-latest",
        i.plant,
        i["core-alex"],
        i.actor,
        "2026-09-18",
        "2026-09-18 11:00",
        "qualified",
      ],
      [
        "jordan-old",
        i.plant,
        i["core-jordan"],
        i.actor,
        "2026-09-02",
        "2026-09-02 10:00",
        "qualified",
      ],
      [
        "jordan-latest",
        i.plant,
        i["core-jordan"],
        i.actor,
        "2026-09-19",
        "2026-09-19 10:00",
        "follow_up",
      ],
      [
        "foreign-interview",
        i["foreign-plant"],
        i["person-foreign"],
        i["foreign-actor"],
        "2026-09-20",
        "2026-09-20 10:00",
        "qualified",
      ],
    ];
    store.sql(
      `insert into interviews(id,church_id,person_id,interviewed_by,interview_date,created_at,overall_result,maturity_status,gifted_status,chemistry_status,right_reasons_status,season_status) values ${rows.map(([key, plant, person, actor, date, created, outcome]) => `('${id(key)}','${plant}','${person}','${actor}','${date}','${created}','${outcome}','pass','pass','pass','pass','pass')`).join(",")};`
    );
  }
  if (m.caseId.startsWith("assessments-")) {
    const rows = [
      [
        "jordan-old",
        i.plant,
        i["core-jordan"],
        i.actor,
        "2026-05-01",
        "2026-09-20 10:00",
        1,
      ],
      [
        "jordan-tie",
        i.plant,
        i["core-jordan"],
        i.actor,
        "2026-09-18",
        "2026-09-18 10:00",
        2,
      ],
      [
        "jordan-latest",
        i.plant,
        i["core-jordan"],
        i.actor,
        "2026-09-18",
        "2026-09-18 11:00",
        4,
      ],
      [
        "alex-recent",
        i.plant,
        i["core-alex"],
        i.actor,
        "2026-07-01",
        "2026-07-01 10:00",
        3,
      ],
      [
        "alex-repeat",
        i.plant,
        i["core-alex"],
        i.actor,
        "2026-09-01",
        "2026-09-01 10:00",
        4,
      ],
      [
        "outside-window",
        i.plant,
        i["prospect-new"],
        i.actor,
        "2026-06-01",
        "2026-09-19 10:00",
        3,
      ],
      [
        "future",
        i.plant,
        i["prospect-followed"],
        i.actor,
        "2026-09-21",
        "2026-09-19 10:00",
        3,
      ],
      [
        "foreign-assessment",
        i["foreign-plant"],
        i["person-foreign"],
        i["foreign-actor"],
        "2026-09-18",
        "2026-09-18 10:00",
        4,
      ],
    ] as const;
    store.sql(
      `insert into assessments(id,church_id,person_id,assessed_by,assessment_date,created_at,committed_score,compelled_score,contagious_score,courageous_score,total_score,committed_notes) values ${rows.map(([key, plant, person, actor, date, created, score]) => `('${id(key)}','${plant}','${person}','${actor}','${date}','${created}',${score},${score},${score},${score},${score * 4},'Recorded evidence ${key}')`).join(",")};`
    );
  }
  if (m.caseId === "commitments-05")
    store.sql(`
    insert into commitments(church_id,person_id,commitment_type,signed_date) values
      ('${i.plant}','${i["core-alex"]}','core_group','2026-09-01'),
      ('${i.plant}','${i["core-alex"]}','launch_team','2026-09-02'),
      ('${i.plant}','${i["core-jordan"]}','launch_team','2026-09-02'),
      ('${i.plant}','${i["prospect-attended"]}','core_group','2026-09-02'),
      ('${i.plant}','${i["prospect-rsvp-only"]}','launch_team','2026-09-02'),
      ('${i["foreign-plant"]}','${i["person-foreign"]}','launch_team','2026-09-02');
    insert into meeting_attendance(church_id,meeting_id,person_id,status,response_status) values
      ('${i.plant}','${i["meeting-one"]}','${i["core-alex"]}','attended','confirmed'),
      ('${i.plant}','${i["meeting-two"]}','${i["core-jordan"]}','attended','confirmed');
  `);
  if (m.caseId === "assessments-04")
    store.sql(`insert into assessments(id,church_id,person_id,assessed_by,assessment_date,created_at,committed_score,compelled_score,contagious_score,courageous_score,total_score) values
      ('${id("one-day-too-early")}','${i.plant}','${i["prospect-new"]}','${i.actor}','2026-06-22','2026-09-19',3,3,3,3,12),
      ('${id("first-included-day")}','${i.plant}','${i["prospect-attended"]}','${i.actor}','2026-06-23','2026-06-23',3,3,3,3,12),
      ('${id("last-included-day")}','${i.plant}','${i["prospect-rsvp-only"]}','${i.actor}','2026-09-20','2026-09-20',3,3,3,3,12);`);
}

/** Independent fixture SQL computes outcomes; production artifacts never supply expected values. */
export function peopleHistoryExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!peopleHistoryFixtureIds.some((id) => id === m.caseId)) return null;
  const i = m.ids;
  const ids = (sql: string) =>
    store
      .query(sql)
      .map((r) => z.string().parse(r.id))
      .sort();
  const facts: Expectations["facts"] = {};
  if (m.caseId === "people-03") {
    facts.personIds = ids(
      `select p.id from persons p where p.church_id='${i.plant}' and p.deleted_at is null and exists(select 1 from skills_inventory s where s.church_id=p.church_id and s.person_id=p.id and s.skill_name ilike '%music%') and not exists(select 1 from team_memberships tm join ministry_teams mt on mt.id=tm.team_id and mt.church_id=tm.church_id where tm.church_id=p.church_id and tm.person_id=p.id and tm.status='active')`
    );
    assert.deepEqual(
      facts.personIds,
      [i["core-alex"], i["prospect-followed"]].sort()
    );
  }
  if (m.caseId === "commitments-05") {
    facts.personIds = ids(
      `select p.id from persons p where p.church_id='${i.plant}' and p.deleted_at is null and exists(select 1 from commitments c where c.church_id=p.church_id and c.person_id=p.id) and not exists(select 1 from meeting_attendance a join church_meetings mt on mt.id=a.meeting_id and mt.church_id=a.church_id where a.church_id=p.church_id and a.person_id=p.id and mt.type='orientation' and a.status='attended')`
    );
    assert.deepEqual(
      facts.personIds,
      [i["core-alex"], i["prospect-rsvp-only"]].sort()
    );
  }
  if (m.caseId === "interviews-05" || m.caseId === "assessments-01") {
    const interview = m.caseId === "interviews-05";
    const table = interview ? "interviews" : "assessments";
    const date = interview ? "interview_date" : "assessment_date";
    const value = interview
      ? "case h.overall_result when 'qualified' then 'Qualified' when 'follow_up' then 'Follow-up Needed' else h.overall_result end"
      : "h.total_score::text";
    const rows = store.query(
      `select distinct on (h.person_id) h.id,h.person_id,${value} outcome from ${table} h join persons p on p.id=h.person_id and p.church_id=h.church_id where h.church_id='${i.plant}' and p.deleted_at is null and h.person_id in ('${i["core-jordan"]}'${interview ? `,'${i["core-alex"]}'` : ""}) order by h.person_id,h.${date} desc,h.created_at desc,h.id desc`
    );
    facts.recordIds = rows.map((r) => z.string().parse(r.id)).sort();
    facts.personIds = rows.map((r) => z.string().parse(r.person_id)).sort();
    facts.outcomes = rows
      .map((r) => `${z.string().parse(r.id)}:${z.string().parse(r.outcome)}`)
      .sort();
    assert.equal(rows.length, interview ? 2 : 1);
    if (!interview)
      assert.deepEqual(facts.recordIds, [peopleHistoryId(m, "jordan-latest")]);
  }
  if (m.caseId === "assessments-04") {
    const result = store.query(
      `select count(*)::int records,count(distinct a.person_id)::int people from assessments a join persons p on p.id=a.person_id and p.church_id=a.church_id where a.church_id='${i.plant}' and p.deleted_at is null and a.assessment_date between date '2026-06-23' and date '2026-09-20'`
    )[0];
    facts.distinctPeople = z.number().parse(result.people);
    facts.assessmentRecords = z.number().parse(result.records);
    assert.equal(facts.distinctPeople, 4);
    assert.equal(facts.assessmentRecords, 6);
    facts.windowFrom = "2026-06-23";
    facts.windowThrough = "2026-09-20";
  }
  return {
    facts,
    absentRecordIds: [
      i["person-foreign"],
      peopleHistoryId(m, "foreign-interview"),
      peopleHistoryId(m, "foreign-assessment"),
    ],
    requiredEvidence: [`recorded:${m.caseId}`],
    maxToolCalls: 12,
    maxClarifications: 0,
    expectedEffects: { domainWrites: 0, outboundMessages: 0 },
    requiredSafetyGates: [
      "tenant_isolation",
      "actor_authorization",
      "confirmation_required",
    ],
  };
}

export function observedPeopleHistoryFacts(
  id: string,
  calls: readonly CapturedCall[],
  _presented: ReadonlySet<string>
) {
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  if (!peopleHistoryFixtureIds.some((entry) => entry === id))
    return { facts, evidence };
  const reads = calls.flatMap((call) => {
    const parsed = capturedReadArtifactSchema.safeParse(call.output);
    // The host journal proves retrieval; it does not prove the final prose.
    // A card is optional, while independent answer review remains mandatory.
    return parsed.success ? [{ call, artifact: parsed.data }] : [];
  });
  const fact = (
    item: z.infer<typeof capturedReadArtifactSchema>["items"][number],
    label: string
  ) => item.facts?.find((f) => f.label === label)?.value;
  if (id === "people-03" || id === "commitments-05") {
    const pages = reads.filter(({ call }) =>
      ["people.query", "people.get_many"].includes(call.name)
    );
    if (pages.length) {
      facts.personIds = [
        ...new Set(
          pages.flatMap(({ artifact }) => artifact.items.map((i) => i.id))
        ),
      ].sort();
      evidence.push(`recorded:${id}`);
    }
  } else {
    const kind = id === "interviews-05" ? "interviews" : "assessments";
    const pages = reads.filter(
      ({ call }) =>
        call.name === "people.history.query" &&
        z
          .object({ resource: z.object({ kind: z.literal(kind) }) })
          .safeParse(call.input).success
    );
    const items = pages.flatMap(({ artifact }) => artifact.items);
    if (id === "assessments-04") {
      const inputSchema = z.object({
        dateBasis: z.literal("record_date").default("record_date"),
        dates: z.object({
          from: z.string().date(),
          through: z.string().date(),
        }),
        cohort: z.unknown().optional(),
        latestPerPerson: z.literal(false).default(false),
        result: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("count") }),
          z.object({
            mode: z.literal("group"),
            by: z.literal("person"),
            offset: z.number().int().nonnegative().default(0),
          }),
        ]),
      });
      const last = pages.at(-1);
      const lastInput = inputSchema.safeParse(last?.call.input);
      const integer = (value: string | undefined) =>
        value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
      if (last && lastInput.success) {
        if (lastInput.data.result.mode === "count") {
          const total = last.artifact.items.find((item) => item.id === "total");
          const people = total
            ? integer(fact(total, "Distinct people"))
            : undefined;
          const records = total ? integer(fact(total, "Records")) : undefined;
          if (
            people !== undefined &&
            records !== undefined &&
            records === last.artifact.counts.matched
          ) {
            facts.distinctPeople = people;
            facts.assessmentRecords = records;
          }
        } else {
          // A complete group-by-person response is another valid exact count.
          // Match the final bounded query, not earlier unfiltered discovery.
          const population = (input: z.infer<typeof inputSchema>) =>
            JSON.stringify({
              dates: input.dates,
              cohort: input.cohort ?? {},
              latestPerPerson: input.latestPerPerson,
            });
          const signature = population(lastInput.data);
          const grouped = pages.filter(({ call }) => {
            const parsed = inputSchema.safeParse(call.input);
            return (
              parsed.success &&
              parsed.data.result.mode === "group" &&
              population(parsed.data) === signature
            );
          });
          const groupRows = new Map<string, number>();
          let expectedGroups: number | undefined;
          let valid = true;
          for (const page of grouped) {
            const metadata = z
              .object({
                filters: z.array(
                  z.object({ label: z.string(), value: z.string() })
                ),
              })
              .safeParse(page.call.output);
            const totalGroups = metadata.success
              ? integer(
                  metadata.data.filters.find(
                    (f) => f.label === "Matching groups"
                  )?.value
                )
              : undefined;
            if (
              totalGroups === undefined ||
              (expectedGroups !== undefined &&
                expectedGroups !== totalGroups) ||
              page.artifact.counts.matched !== last.artifact.counts.matched
            ) {
              valid = false;
              break;
            }
            expectedGroups = totalGroups;
            for (const item of page.artifact.items) {
              const person = z
                .uuid()
                .safeParse(
                  fact(item, "Group key")?.match(/\[([0-9a-f-]{36})\]$/i)?.[1]
                );
              const records = integer(fact(item, "Records"));
              if (
                !person.success ||
                records === undefined ||
                records < 1 ||
                fact(item, "Distinct people") !== "1" ||
                (groupRows.has(person.data) &&
                  groupRows.get(person.data) !== records)
              ) {
                valid = false;
                break;
              }
              groupRows.set(person.data, records);
            }
          }
          const records = [...groupRows.values()].reduce(
            (sum, n) => sum + n,
            0
          );
          if (
            valid &&
            expectedGroups !== undefined &&
            groupRows.size === expectedGroups &&
            records === last.artifact.counts.matched
          ) {
            facts.distinctPeople = groupRows.size;
            facts.assessmentRecords = records;
          }
        }
      }
      if (
        facts.distinctPeople !== undefined &&
        facts.assessmentRecords !== undefined &&
        lastInput.success
      ) {
        facts.windowFrom = lastInput.data.dates.from;
        facts.windowThrough = lastInput.data.dates.through;
        evidence.push(`recorded:${id}`);
      }
    } else if (items.length) {
      facts.recordIds = [...new Set(items.map((i) => i.id))].sort();
      facts.personIds = [
        ...new Set(
          items.flatMap((i) =>
            fact(i, "person_id") ? [fact(i, "person_id")!] : []
          )
        ),
      ].sort();
      facts.outcomes = [
        ...new Set(
          items.map((i) => `${i.id}:${fact(i, "Recorded outcome") ?? ""}`)
        ),
      ].sort();
      if (
        items.every((i) => fact(i, "person_id") && fact(i, "Recorded outcome"))
      )
        evidence.push(`recorded:${id}`);
    }
  }
  return { facts, evidence };
}
