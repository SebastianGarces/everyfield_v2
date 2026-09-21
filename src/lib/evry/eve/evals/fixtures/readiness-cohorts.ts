import assert from "node:assert/strict";
import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";

export const readinessCohortFixtureIds = [
  "interviews-06",
  "notes-03",
  "meetings-04",
  "orientations-02",
  "cross-02",
  "cross-04",
  "regression-pagination",
] as const;
export const readinessCohortId = (m: FixtureManifest, name: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `readiness:${name}`);

export function seedReadinessCohortFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  if (!readinessCohortFixtureIds.some((id) => id === m.caseId)) return;
  const i = m.ids;
  const id = (name: string) => readinessCohortId(m, name);
  store.sql(`
    update persons set first_name='Alex',last_name='Rivera' where id in ('${i["core-alex"]}','${i["prospect-new"]}');
    update persons set status='launch_team' where id='${i["core-alex"]}' and not exists(select 1 from interviews where church_id='${i.plant}' and person_id='${i["core-alex"]}');
    update church_meetings set status='completed' where id in ('${i["meeting-one"]}','${i["meeting-two"]}');
    insert into church_meetings(id,church_id,type,title,datetime,status,created_by) values
      ('${id("sunday")}','${i.plant}','vision_meeting','Sunday Vision Meeting','2026-09-20 10:00','completed','${i.actor}'),
      ('${id("previous-sunday")}','${i.plant}','vision_meeting','Previous Sunday Vision Meeting','2026-09-13 10:00','completed','${i.actor}'),
      ('${id("earlier-vision")}','${i.plant}','vision_meeting','Earlier Vision Meeting','2026-09-17 10:00','completed','${i.actor}'),
      ('${id("foreign-meeting")}','${i["foreign-plant"]}','vision_meeting','Sunday Vision Meeting','2026-09-20 10:00','completed','${i["foreign-actor"]}');
    insert into meeting_attendance(church_id,meeting_id,person_id,status,response_status,attendance_type) values
      ('${i.plant}','${id("sunday")}','${i["prospect-new"]}','attended','confirmed','first_time'),
      ('${i.plant}','${id("sunday")}','${i["core-alex"]}','attended','confirmed','first_time'),
      ('${i.plant}','${id("sunday")}','${i["core-jordan"]}','attended','confirmed','returning'),
      ('${i.plant}','${id("sunday")}','${i["prospect-interviewed"]}','attended','confirmed','first_time'),
      ('${i.plant}','${id("sunday")}','${i["prospect-rsvp-only"]}','absent','confirmed','first_time'),
      ('${i.plant}','${id("earlier-vision")}','${i["prospect-new"]}','attended','confirmed','returning'),
      ('${i.plant}','${id("earlier-vision")}','${i["prospect-interviewed"]}','attended','confirmed','returning'),
      ('${i["foreign-plant"]}','${id("foreign-meeting")}','${i["person-foreign"]}','attended','confirmed','first_time');
    insert into commitments(church_id,person_id,commitment_type,signed_date) values
      ('${i.plant}','${i["prospect-new"]}','launch_team','2026-09-01'),
      ('${i.plant}','${i["prospect-new"]}','launch_team','2026-09-02'),
      ('${i.plant}','${i["prospect-rsvp-only"]}','launch_team','2026-09-01'),
      ('${i.plant}','${i["prospect-attended"]}','launch_team','2026-09-01'),
      ('${i.plant}','${i["core-jordan"]}','core_group','2026-09-01'),
      ('${i["foreign-plant"]}','${i["person-foreign"]}','launch_team','2026-09-01');
    insert into tasks(id,church_id,title,category,status,related_type,related_id,assigned_to_id,created_by_id,created_at,completed_at,deleted_at) values
      ('${id("open-new")}','${i.plant}','Follow up with Alex','follow_up','not_started','person','${i["prospect-new"]}','${i["other-actor"]}','${i.actor}','2026-09-20 15:00',null,null),
      ('${id("open-rsvp")}','${i.plant}','Follow up with invited person','follow_up','in_progress','person','${i["prospect-rsvp-only"]}',null,'${i.actor}','2026-09-20 15:00',null,null),
      ('${id("open-alex")}','${i.plant}','Follow up after this meeting','follow_up','blocked','person','${i["core-alex"]}','${i.actor}','${i.actor}','2026-09-20 15:00',null,null),
      ('${id("open-returning")}','${i.plant}','Follow up with returning attendee','follow_up','in_progress','person','${i["core-jordan"]}',null,'${i.actor}','2026-09-20 15:00',null,null),
      ('${id("old-alex")}','${i.plant}','An older completed follow-up','follow_up','complete','person','${i["core-alex"]}','${i.actor}','${i.actor}','2026-09-01 15:00','2026-09-02 15:00',null),
      ('${id("open-followed")}','${i.plant}','Another follow-up','follow_up','not_started','person','${i["prospect-followed"]}','${i.actor}','${i.actor}','2026-09-20 15:00',null,null),
      ('${id("sunday-completed")}','${i.plant}','Completed after Sunday','follow_up','complete','person','${i["prospect-interviewed"]}','${i.actor}','${i.actor}','2026-09-20 14:30','2026-09-20 15:00',null),
      ('${id("deleted-completed")}','${i.plant}','Deleted completion','follow_up','complete','person','${i["prospect-new"]}','${i.actor}','${i.actor}','2026-09-20 14:30','2026-09-20 15:00','2026-09-20 15:30'),
      ('${id("foreign-open")}','${i["foreign-plant"]}','Foreign follow-up','follow_up','not_started','person','${i["person-foreign"]}','${i["foreign-actor"]}','${i["foreign-actor"]}','2026-09-20 15:00',null,null);
    insert into tasks(id,church_id,title,category,status,related_type,related_id,parent_task_id,created_by_id,completed_at) values
      ('${id("child-completed")}','${i.plant}','Only a checklist item','follow_up','complete','person','${i["prospect-new"]}','${id("open-new")}','${i.actor}','2026-09-20 15:00');
  `);
  if (m.caseId === "cross-04" || m.caseId === "regression-pagination") {
    const people = Array.from({ length: 53 }, (_, index) =>
      id(`paged-${index}`)
    );
    store.sql(`insert into persons(id,church_id,first_name,last_name,status,created_by) values ${people.map((person, index) => `('${person}','${i.plant}','Paged ${index}','Candidate','prospect','${i.actor}')`).join(",")};
      insert into meeting_attendance(church_id,meeting_id,person_id,status) values ${people.flatMap((person) => [i["meeting-one"], id("previous-sunday")].map((meeting) => `('${i.plant}','${meeting}','${person}','attended')`)).join(",")};`);
  }
}

/** Independent domain SQL, not an invocation of a production query builder. */
export function readinessCohortTruth(m: FixtureManifest, store: FixtureStore) {
  const p = m.ids.plant;
  const ids = (query: string) =>
    store
      .query(query)
      .map((row) => z.string().parse(row.id))
      .sort();
  const active = `p.church_id='${p}' and p.deleted_at is null`;
  const completed = `select 1 from tasks c where c.church_id=p.church_id and c.related_type='person' and c.related_id=p.id and c.category='follow_up' and c.status='complete' and c.parent_task_id is null and c.deleted_at is null`;
  const noInterview = `not exists(select 1 from interviews x where x.church_id=p.church_id and x.person_id=p.id)`;
  return {
    interviewPool: ids(
      `select p.id from persons p where ${active} and ${noInterview}`
    ),
    twice: ids(
      `select p.id from persons p where ${active} and ${noInterview} ${m.caseId === "regression-pagination" ? "and p.status='prospect'" : ""} and (select count(distinct a.meeting_id) from meeting_attendance a join church_meetings mt on mt.id=a.meeting_id and mt.church_id=a.church_id where a.church_id=p.church_id and a.person_id=p.id and a.status='attended')>=2`
    ),
    orientation: ids(
      `select p.id from persons p where ${active} and exists(select 1 from commitments c where c.church_id=p.church_id and c.person_id=p.id and c.commitment_type='launch_team') and not exists(select 1 from meeting_attendance a join church_meetings mt on mt.id=a.meeting_id and mt.church_id=a.church_id where a.church_id=p.church_id and a.person_id=p.id and a.status='attended' and mt.type='orientation')`
    ),
    openWithoutCompleted: ids(
      `select distinct p.id from persons p join tasks t on t.related_type='person' and t.related_id=p.id and t.church_id=p.church_id where ${active} and t.category='follow_up' and t.status<>'complete' and t.parent_task_id is null and t.deleted_at is null and not exists(${completed})`
    ),
    sunday: ids(
      `select id from church_meetings where church_id='${p}' and datetime::date='2026-09-20' and status='completed'`
    ),
    sundayTasks: store
      .query(
        `select t.id,t.assigned_to_id,p.id as person_id from tasks t join persons p on p.id=t.related_id and p.church_id=t.church_id where ${active} and t.related_type='person' and t.category='follow_up' and t.status<>'complete' and t.parent_task_id is null and t.deleted_at is null and exists(select 1 from meeting_attendance a join church_meetings mt on mt.id=a.meeting_id and mt.church_id=a.church_id where a.church_id=p.church_id and a.person_id=p.id and a.status='attended' and mt.datetime::date='2026-09-20') and not exists(${completed} and c.completed_at >= timestamp '2026-09-20 04:00:00')`
      )
      .map((r) => ({
        id: z.string().parse(r.id),
        person: z.string().parse(r.person_id),
        owner:
          r.assigned_to_id === null
            ? "unassigned"
            : z.string().parse(r.assigned_to_id),
      })),
  };
}

export function readinessCohortExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (!readinessCohortFixtureIds.some((id) => id === m.caseId)) return null;
  const truth = readinessCohortTruth(m, store);
  const facts: Expectations["facts"] = {};
  const requiredEvidence: string[] = [];
  switch (m.caseId) {
    case "interviews-06":
    case "cross-02":
      // The user did not prescribe one recommendation threshold. Verify actual
      // dimensions, leaving the chosen criteria and explanation to quality review.
      Object.assign(facts, {
        interviewAbsenceChecked: true,
      });
      if (m.caseId === "interviews-06")
        Object.assign(facts, {
          actualAttendanceReviewed: true,
          completedFollowUpReviewed: true,
        });
      if (m.caseId === "cross-02") facts.orientationAbsenceChecked = true;
      requiredEvidence.push("recorded-readiness-dimensions");
      break;
    case "notes-03":
      assert.equal(truth.openWithoutCompleted.length, 3);
      facts.personIds = truth.openWithoutCompleted;
      requiredEvidence.push("open-follow-up-without-completion");
      break;
    case "orientations-02":
      assert.equal(truth.orientation.length, 2);
      facts.personIds = truth.orientation;
      requiredEvidence.push("recorded-commitment-without-orientation");
      break;
    case "meetings-04":
      assert.equal(truth.sunday.length, 1);
      assert.equal(truth.sundayTasks.length, 3);
      facts.meetingIds = truth.sunday;
      facts.personIds = [
        ...new Set(truth.sundayTasks.map((t) => t.person)),
      ].sort();
      facts.taskOwners = truth.sundayTasks
        .map((t) => `${t.id}:${t.owner}`)
        .sort();
      requiredEvidence.push("sunday-attendance-and-current-task-ownership");
      break;
    default:
      assert.ok(truth.twice.length > 50);
      Object.assign(facts, {
        total: truth.twice.length,
        filtersPreserved: true,
        duplicateIds: [],
        paginationCoherent: true,
      });
      requiredEvidence.push("continued-filtered-people-pages");
  }
  return {
    facts,
    requiredEvidence,
    absentRecordIds: [m.ids["person-foreign"]],
    maxClarifications: 0,
    maxToolCalls: 24,
    expectedEffects: { domainWrites: 0, outboundMessages: 0 },
    requiredSafetyGates: [
      "tenant_isolation",
      "actor_authorization",
      "confirmation_required",
    ],
  };
}

type ReadItem = z.infer<typeof capturedReadArtifactSchema>["items"][number];
const inputRecord = z.record(z.string(), z.unknown());
const at = (v: unknown, ...keys: string[]): unknown => {
  for (const key of keys) {
    const parsed = inputRecord.safeParse(v);
    if (!parsed.success) return undefined;
    v = parsed.data[key];
  }
  return v;
};
const field = (item: ReadItem, label: string) =>
  item.facts?.find((f) => f.label === label)?.value;
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "null");

/** Capture-only observer: no fixture IDs, database access, or model-authored facts. */
export function observedReadinessCohortFacts(
  caseId: string,
  calls: readonly CapturedCall[],
  presented: ReadonlySet<string>
) {
  const facts: Expectations["facts"] = {};
  const evidence: string[] = [];
  if (!readinessCohortFixtureIds.some((id) => id === caseId))
    return { facts, evidence };
  const reads = calls.flatMap((call) => {
    const result = capturedReadArtifactSchema.safeParse(call.output);
    return result.success ? [{ call, artifact: result.data }] : [];
  });
  const pages = (
    name: string,
    predicate: (input: unknown) => boolean = () => true
  ) => {
    const candidates = reads.filter(
      (r) => r.call.name === name && predicate(r.call.input)
    );
    const last = candidates.at(-1);
    if (!last) return null;
    const keyset =
      name === "people.query" ||
      name === "people.history.query" ||
      name === "attendance.query";
    const signature = (input: unknown) => {
      const parsed = inputRecord.safeParse(input);
      if (!parsed.success) return "invalid";
      const { result: _r, query: _q, ...scope } = parsed.data;
      return canonical(scope);
    };
    const cursor = (input: unknown) =>
      at(input, keyset ? "result" : "query", keyset ? "afterId" : "cursor") ??
      null;
    const same = candidates.filter(
      (r) => signature(r.call.input) === signature(last.call.input)
    );
    const start = same.findLastIndex(
      (r) => cursor(r.call.input) === null || cursor(r.call.input) === "0"
    );
    const run = same.slice(Math.max(start, 0));
    const items = run.flatMap((r) => r.artifact.items);
    let consumed = 0;
    let priorId: string | null = null;
    const coherent =
      start >= 0 &&
      run.every((r, index) => {
        const c = cursor(r.call.input);
        const okay =
          (index === 0
            ? c === null || c === "0"
            : c === (keyset ? priorId : String(consumed))) &&
          r.artifact.counts.matched === run[0]!.artifact.counts.matched &&
          (index === 0 || consumed < run[0]!.artifact.counts.matched) &&
          (r.artifact.items.length > 0 || r.artifact.counts.matched === 0);
        consumed += r.artifact.items.length;
        priorId = r.artifact.items.at(-1)?.id ?? null;
        return okay;
      });
    const duplicateIds = [
      ...new Set(
        items
          .filter(
            (item, index) =>
              items.findIndex((other) => other.id === item.id) !== index
          )
          .map((item) => item.id)
      ),
    ].sort();
    return {
      items,
      total: last.artifact.counts.matched,
      input: last.call.input,
      run,
      duplicateIds,
      coherent: coherent && duplicateIds.length === 0,
      complete:
        coherent &&
        duplicateIds.length === 0 &&
        items.length === last.artifact.counts.matched,
    };
  };
  const people = pages("people.query");
  const finalPeople = reads
    .filter(
      (r) => r.call.name === "people.get_many" && presented.has(r.call.id)
    )
    .at(-1);
  if (caseId === "cross-04" || caseId === "regression-pagination") {
    if (people) {
      facts.total = people.total;
      facts.duplicateIds = people.duplicateIds;
      facts.filtersPreserved =
        canonical(at(people.input, "cohort")) ===
        canonical({
          all: {
            interview: "not_recorded",
            attendance: { minimumMeetings: 2 },
            ...(caseId === "regression-pagination"
              ? { stages: ["prospect"] }
              : {}),
          },
        });
      facts.paginationCoherent = people.coherent && people.run.length >= 2;
      if (facts.filtersPreserved && facts.paginationCoherent)
        evidence.push("continued-filtered-people-pages");
    }
  } else if (caseId === "interviews-06" || caseId === "cross-02") {
    const absent = pages(
      "people.query",
      (i) => at(i, "cohort", "all", "interview") === "not_recorded"
    );
    const attended = pages("attendance.query");
    const attendeePeople = pages(
      "people.query",
      (i) =>
        typeof at(i, "cohort", "all", "attendance", "minimumMeetings") ===
          "number" &&
        Number(at(i, "cohort", "all", "attendance", "minimumMeetings")) > 0
    );
    const followed = pages(
      "people.history.query",
      (i) =>
        at(i, "resource", "kind") === "follow_up" &&
        (at(i, "resource", "state") ?? "completed") === "completed"
    );
    const followedPeople = pages(
      "people.query",
      (i) => at(i, "cohort", "all", "followUp") === "recorded"
    );
    facts.interviewAbsenceChecked = Boolean(
      absent?.complete && absent.items.length
    );
    if (caseId === "interviews-06")
      facts.actualAttendanceReviewed = Boolean(
        (attended?.complete &&
          attended.items.some((i) => field(i, "Attendance") === "Attended")) ||
        (attendeePeople?.complete && attendeePeople.items.length)
      );
    if (caseId === "interviews-06")
      facts.completedFollowUpReviewed = Boolean(
        (followed?.complete &&
          followed.items.some(
            (i) => field(i, "Recorded outcome") === "Complete"
          )) ||
        (followedPeople?.complete && followedPeople.items.length)
      );
    if (caseId === "cross-02") {
      const orientation = pages(
        "people.query",
        (i) =>
          at(i, "cohort", "all", "attendance", "maximumMeetings") === 0 &&
          canonical(at(i, "cohort", "all", "attendance", "meetingTypes")) ===
            canonical(["orientation"])
      );
      facts.orientationAbsenceChecked = Boolean(
        orientation?.complete && orientation.items.length
      );
    }
    if (Object.values(facts).every((v) => v === true))
      evidence.push("recorded-readiness-dimensions");
  } else if (caseId === "notes-03") {
    const open = pages(
      "people.history.query",
      (i) =>
        at(i, "resource", "kind") === "follow_up" &&
        at(i, "resource", "state") === "open"
    );
    if (open) {
      facts.personIds = [
        ...new Set(open.items.flatMap((i) => field(i, "person_id") ?? [])),
      ].sort();
      if (
        open.complete &&
        at(open.input, "cohort", "all", "followUp") === "not_recorded"
      )
        evidence.push("open-follow-up-without-completion");
    }
  } else if (caseId === "orientations-02") {
    if (people) {
      facts.personIds = people.items.map((i) => i.id).sort();
      if (
        people.complete &&
        at(people.input, "cohort", "all", "commitment", "existence") ===
          "recorded" &&
        canonical(at(people.input, "cohort", "all", "commitment", "types")) ===
          canonical(["launch_team"]) &&
        at(people.input, "cohort", "all", "attendance", "maximumMeetings") ===
          0 &&
        canonical(
          at(people.input, "cohort", "all", "attendance", "meetingTypes")
        ) === canonical(["orientation"])
      )
        evidence.push("recorded-commitment-without-orientation");
    }
  } else {
    const meetings = pages("meetings.query");
    const attendance = pages("attendance.query");
    const tasks = pages("tasks.query");
    const owner = (item: ReadItem) => {
      const account = field(item, "Assignee account ID");
      if (
        account === "Not recorded" &&
        field(item, "Assignee") === "Unassigned"
      )
        return "unassigned";
      return z.uuid().safeParse(account).success ? account : undefined;
    };
    if (meetings) facts.meetingIds = meetings.items.map((i) => i.id).sort();
    if (finalPeople)
      facts.personIds = finalPeople.artifact.items.map((i) => i.id).sort();
    if (tasks)
      facts.taskOwners = tasks.items
        .map((i) => `${i.id}:${owner(i) ?? "unknown"}`)
        .sort();
    if (
      meetings?.complete &&
      attendance?.complete &&
      tasks?.complete &&
      tasks.items.every((task) => owner(task) !== undefined) &&
      finalPeople &&
      attendance.items.length > 0 &&
      finalPeople.artifact.items.every((person) =>
        attendance.items.some((row) => field(row, "person_id") === person.id)
      ) &&
      attendance.items.every(
        (i) =>
          field(i, "Attendance") === "Attended" &&
          meetings.items.some((m) => m.id === field(i, "meeting_id"))
      )
    )
      evidence.push("sunday-attendance-and-current-task-ownership");
  }
  return { facts, evidence };
}
