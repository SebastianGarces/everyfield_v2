import { z } from "zod";
import type { Expectations } from "../contract";
import { regressions } from "../catalog";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";
import { seedLaunchReviewFixture } from "./launch-review";
import { observedLaunchStaffing } from "./launch-staffing";

export const weeklyBriefFixtureIds = ["regression-partial-outage"] as const;
export const weeklyBriefId = (m: FixtureManifest, key: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `weekly-brief:${key}`);
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Missing completed history is not a query failure. All current readers stay healthy. */
export function seedWeeklyBriefFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  if (m.caseId !== weeklyBriefFixtureIds[0]) return;
  seedLaunchReviewFixture(m, store);
  const id = (key: string) => weeklyBriefId(m, key),
    i = m.ids;
  store.sql(`insert into team_roles(id,church_id,team_id,name,status,created_by) values
    ('${id("vacant-role")}','${i.plant}','${i.ministry}','Setup helper','open','${i.actor}'),
    ('${id("occupied-role")}','${i.plant}','${i.ministry}','Host','open','${i.actor}');
    insert into team_memberships(church_id,team_id,role_id,person_id,status,created_by) values ('${i.plant}','${i.ministry}','${id("occupied-role")}','${i["core-alex"]}','active','${i.actor}');
    insert into launches(id,church_id,target_date,status) values ('${id("foreign-launch")}','${i["foreign-plant"]}','2026-12-25','scheduled');
    insert into launch_milestones(id,launch_id,church_id,template_key,area,title) values ('${id("foreign-milestone")}','${id("foreign-launch")}','${i["foreign-plant"]}','operations.foreign_brief','operations','Private milestone');
    insert into ministry_teams(id,church_id,name,created_by) values ('${id("foreign-team")}','${i["foreign-plant"]}','Private team','${i["foreign-actor"]}');
    insert into team_roles(id,church_id,team_id,name,status,created_by) values ('${id("foreign-role")}','${i["foreign-plant"]}','${id("foreign-team")}','Private role','open','${i["foreign-actor"]}');
    insert into plant_assessments(id,church_id,generated_at,phase,rubric_version,fact_snapshot,status) values
    ('${id("failed-history")}','${i.plant}','2026-09-19 12:00',2,'rubric-v1','{"launch":{"attendanceCount":999}}','failed'),
    ('${id("foreign-history")}','${i["foreign-plant"]}','2026-09-18 12:00',3,'rubric-v1','{"launch":{"attendanceCount":800}}','complete');`);
}

/** Separate discriminator, never seeded into the original absent-history scenario. */
export function seedWeeklyBriefRecordedHistory(
  m: FixtureManifest,
  store: FixtureStore
) {
  store.sql(
    `insert into plant_assessments(id,church_id,generated_at,phase,rubric_version,fact_snapshot,status) values ('${weeklyBriefId(m, "recorded-history")}','${m.ids.plant}','2026-09-01 12:00',2,'rubric-v1',${quote(JSON.stringify({ launch: { attendanceCount: 0, decisionsCount: null } }))},'complete');`
  );
}

export function weeklyBriefExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (m.caseId !== weeklyBriefFixtureIds[0]) return null;
  const original = regressions.find((r) => r.id === m.caseId);
  if (!original) throw new Error("Unknown weekly brief regression");
  const launch = z
    .object({ id: z.string(), target_date: z.string() })
    .parse(
      store.query(
        `select id,target_date::text from launches where church_id='${m.ids.plant}'`
      )[0]
    );
  const milestoneIds = store
    .query(
      `select id from launch_milestones where church_id='${m.ids.plant}' and launch_id='${launch.id}' and completed_at is null`
    )
    .map((r) => z.string().parse(r.id))
    .sort();
  const vacancy = store
    .query(
      `select r.team_id::text team_id,count(*)::int amount from team_roles r join ministry_teams t on t.id=r.team_id and t.church_id=r.church_id where r.church_id='${m.ids.plant}' and not exists(select 1 from team_memberships seat join persons p on p.id=seat.person_id and p.church_id=seat.church_id and p.deleted_at is null where seat.church_id=r.church_id and seat.team_id=r.team_id and seat.role_id=r.id and seat.status='active') group by r.team_id`
    )
    .map((r) => z.number().int().nonnegative().parse(r.amount));
  const history = z
    .array(z.object({ id: z.string(), attendance: z.number().nullable() }))
    .parse(
      store.query(
        `select id,(fact_snapshot->'launch'->>'attendanceCount')::int attendance from plant_assessments where church_id='${m.ids.plant}' and status='complete' order by generated_at desc,id`
      )
    );
  return {
    ...original.expectations,
    facts: {
      ...original.expectations.facts,
      launchDate: launch.target_date,
      incompleteMilestoneCount: milestoneIds.length,
      openRoleCount: vacancy.reduce((sum, count) => sum + count, 0),
      historicalComparisonAvailable: history.length > 0,
      historicalAttendanceCount: history[0]?.attendance ?? null,
    },
    absentRecordIds: [
      "foreign-launch",
      "foreign-milestone",
      "foreign-team",
      "foreign-role",
      "foreign-history",
      "failed-history",
    ].map((k) => weeklyBriefId(m, k)),
  };
}

const envelope = z.object({
  filters: z.array(z.object({ label: z.string(), value: z.string() })),
  counts: z.object({
    matched: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
  }),
  resultMode: z.literal("list"),
});
const dictionary = z.record(z.string(), z.unknown());
const wholeStaffingScope = z.strictObject({
  all: z
    .array(
      z.strictObject({
        vacant: z.literal(true).optional(),
        hasVacancies: z.literal(true).optional(),
      })
    )
    .optional(),
  any: z.array(z.never()).optional(),
  none: z.array(z.never()).optional(),
});
function wholeMilestoneScope(query: Record<string, unknown>) {
  return (
    (!query.completion ||
      query.completion === "any" ||
      query.completion === "open") &&
    !query.area &&
    !query.milestoneIds &&
    !query.taskIds &&
    !query.window &&
    !query.blockedByOverdueTask
  );
}
// Tool display dates and SQL date-only truth represent the same local calendar day.
function calendarDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const match = /^(\w+) (\d{1,2}), (\d{4})$/.exec(text);
  const month = match
    ? months.findIndex((m) => m === match[1] || m.slice(0, 3) === match[1])
    : -1;
  const date =
    match && month >= 0
      ? `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`
      : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}
function exactCount(
  call: CapturedCall,
  operations: boolean
): number | undefined {
  const parsed = z
    .object({
      kind: z.literal("read"),
      resultMode: z.literal("count"),
      counts: z.object({
        matched: z.number().int().nonnegative().safe(),
        returned: z.number().int().nonnegative(),
      }),
      filters: z.array(z.object({ label: z.string(), value: z.string() })),
      items: z.array(
        z.object({
          id: z.string(),
          facts: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional(),
        })
      ),
    })
    .safeParse(call.output);
  if (!parsed.success) return undefined;
  const { counts, items, filters } = parsed.data;
  if (operations) {
    const total = filters.filter((f) => f.label === "Total matches"),
      next = filters.filter((f) => f.label === "Next page cursor");
    if (
      counts.returned !== 0 ||
      items.length !== 0 ||
      total.length !== 1 ||
      total[0]!.value !== String(counts.matched) ||
      next.length !== 1 ||
      next[0]!.value !== "End of results"
    )
      return undefined;
  } else {
    const countFacts = items[0]?.facts?.filter((f) => f.label === "Count");
    if (
      counts.returned !== 1 ||
      items.length !== 1 ||
      items[0]!.id !== "count" ||
      countFacts?.length !== 1 ||
      countFacts[0]!.value !== String(counts.matched) ||
      filters.some((f) => f.label === "Next offset")
    )
      return undefined;
  }
  return counts.matched;
}
function queryOf(call: CapturedCall, operations: boolean) {
  const raw = dictionary.safeParse(call.input);
  if (!raw.success) return null;
  const body = dictionary.safeParse(
    operations ? raw.data.request : raw.data.query
  );
  if (!body.success) return null;
  const query = dictionary.safeParse(operations ? body.data.query : body.data);
  if (!query.success) return null;
  return { body: body.data, query: query.data };
}

/** The latest resource read starts a coherent page chain; old success cannot fill a fresh gap. */
function completeResource(
  calls: readonly CapturedCall[],
  name: string,
  resource: string,
  operations = false
): CapturedCall | null {
  const selected = calls.filter(
    (c) => c.name === name && queryOf(c, operations)?.body.resource === resource
  );
  if (!selected.length) return null;
  const last = queryOf(selected.at(-1)!, operations)!;
  const scope = (entry: ReturnType<typeof queryOf>) => {
    if (!entry) return "";
    const body = structuredClone(entry.body);
    if (operations) {
      const q = { ...entry.query };
      delete q.cursor;
      body.query = q;
    } else delete body.offset;
    return JSON.stringify(body);
  };
  const offset = (c: CapturedCall) => {
    const q = queryOf(c, operations)?.query;
    return Number(operations ? (q?.cursor ?? 0) : (q?.offset ?? 0));
  };
  let start = selected.length - 1;
  while (
    start > 0 &&
    offset(selected[start]!) !== 0 &&
    scope(queryOf(selected[start - 1]!, operations)) === scope(last)
  )
    start--;
  const pages = selected.slice(start);
  if (offset(pages[0]!) !== 0) return null;
  const items: z.infer<typeof capturedReadArtifactSchema>["items"] = [];
  let total: number | undefined;
  for (const [index, call] of pages.entries()) {
    if (
      scope(queryOf(call, operations)) !== scope(last) ||
      offset(call) !== items.length
    )
      return null;
    const read = capturedReadArtifactSchema.safeParse(call.output),
      meta = envelope.safeParse(call.output);
    if (
      !read.success ||
      !meta.success ||
      meta.data.counts.returned !== read.data.items.length ||
      (total !== undefined && total !== meta.data.counts.matched)
    )
      return null;
    total = meta.data.counts.matched;
    items.push(
      ...z
        .array(capturedReadArtifactSchema.shape.items.element.passthrough())
        .parse(dictionary.parse(call.output).items)
    );
    const next = meta.data.filters.filter(
      (f) => f.label === (operations ? "Next page cursor" : "Next offset")
    );
    const finished = items.length === total;
    if (operations) {
      if (
        next.length !== 1 ||
        next[0]!.value !== (finished ? "End of results" : String(items.length))
      )
        return null;
    } else if (
      finished
        ? next.length !== 0
        : next.length !== 1 || next[0]!.value !== String(items.length)
    )
      return null;
    if (finished && index !== pages.length - 1) return null;
  }
  if (
    total !== items.length ||
    new Set(items.map((i) => i.id)).size !== items.length
  )
    return null;
  const final = pages.at(-1)!;
  const raw = dictionary.parse(final.output);
  return {
    ...final,
    output: {
      ...raw,
      items,
      counts: {
        ...dictionary.parse(raw.counts),
        matched: items.length,
        returned: items.length,
      },
    },
  };
}

const value = (
  item: z.infer<typeof capturedReadArtifactSchema>["items"][number],
  label: string
) => {
  const found = item.facts?.filter((f) => f.label === label);
  return found?.length === 1 ? found[0]!.value : undefined;
};
export function observedWeeklyBriefFacts(
  caseId: string,
  calls: readonly CapturedCall[],
  _presented?: ReadonlySet<string>
) {
  const facts: Expectations["facts"] = {},
    evidence: string[] = [];
  if (caseId !== weeklyBriefFixtureIds[0]) return { facts, evidence };
  const status = completeResource(calls, "launch.query", "status");
  if (status) {
    const read = capturedReadArtifactSchema.parse(status.output);
    if (read.items.length === 1 && value(read.items[0]!, "Launch date")) {
      facts.launchIds = read.items.map((r) => r.id);
      const date = calendarDate(value(read.items[0]!, "Launch date"));
      if (date) {
        facts.launchDate = date;
        evidence.push("launch-date");
      }
    }
  }
  const milestones = completeResource(calls, "launch.query", "milestones");
  if (milestones && wholeMilestoneScope(queryOf(milestones, false)!.query)) {
    const read = capturedReadArtifactSchema.parse(milestones.output);
    if (read.items.every((item) => value(item, "Completed at") !== undefined)) {
      facts.incompleteMilestoneIds = read.items
        .filter((item) => value(item, "Completed at") === "Not recorded")
        .map((r) => r.id)
        .sort();
      facts.incompleteMilestoneCount = facts.incompleteMilestoneIds.length;
      evidence.push("incomplete-milestones");
    }
  }
  const latestMilestones = calls
    .filter(
      (c) =>
        c.name === "launch.query" &&
        queryOf(c, false)?.body.resource === "milestones"
    )
    .at(-1);
  if (latestMilestones) {
    const query = queryOf(latestMilestones, false)!.query;
    const count =
      query.mode === "count" &&
      query.completion === "open" &&
      wholeMilestoneScope(query)
        ? exactCount(latestMilestones, false)
        : undefined;
    if (count !== undefined) {
      facts.incompleteMilestoneCount = count;
      evidence.push("incomplete-milestones");
    }
  }
  const latestStaffing = calls
    .filter(
      (c) =>
        c.name === "teams.query" &&
        ["roles", "teams"].includes(String(queryOf(c, true)?.body.resource))
    )
    .at(-1);
  if (latestStaffing) {
    const complete = completeResource(
      calls,
      "teams.query",
      String(queryOf(latestStaffing, true)?.body.resource),
      true
    );
    const body = queryOf(latestStaffing, true)!.body;
    const scope = wholeStaffingScope.safeParse(body.where ?? {});
    const slots = complete && scope.success && observedLaunchStaffing(complete);
    if (slots) {
      facts.openRoleTeams = slots;
      facts.openRoleCount = slots.reduce(
        (sum, slot) => sum + Number(slot.split(":")[1]),
        0
      );
      evidence.push("open-roles");
    }
    const count =
      body.resource === "roles" &&
      scope.success &&
      scope.data.all?.some((f) => f.vacant === true) &&
      !scope.data.all.some((f) => f.hasVacancies)
        ? exactCount(latestStaffing, true)
        : undefined;
    if (count !== undefined) {
      facts.openRoleCount = count;
      evidence.push("open-roles");
    }
  }
  const history = completeResource(calls, "intelligence.query", "assessments");
  if (history) {
    const q = queryOf(history, false)!.query;
    // An empty filtered window or ID lookup cannot establish no recorded history.
    if (
      !q.assessmentIds &&
      !q.window &&
      !q.category &&
      !q.transitionKind &&
      (q.contentOffset ?? 0) === 0
    ) {
      const read = capturedReadArtifactSchema.parse(history.output);
      if (!read.items.length) {
        facts.historicalComparisonAvailable = false;
        facts.historicalSnapshotIds = [];
        facts.historicalAttendanceCount = null;
      } else if (
        q.includeFactSnapshot === true &&
        read.items.every(
          (r) => value(r, "Next content offset") === "Not recorded"
        )
      ) {
        const snapshots = read.items.map((r) => {
          try {
            return dictionary.safeParse(
              JSON.parse(value(r, "Fact snapshot") ?? "")
            );
          } catch {
            return null;
          }
        });
        if (snapshots.every((s) => s?.success)) {
          facts.historicalComparisonAvailable = true;
          facts.historicalSnapshotIds = read.items.map((r) => r.id).sort();
          const launch = dictionary.safeParse(snapshots[0]!.data!.launch);
          facts.historicalAttendanceCount =
            launch.success && typeof launch.data.attendanceCount === "number"
              ? launch.data.attendanceCount
              : null;
        }
      }
    }
  }
  return { facts, evidence };
}
