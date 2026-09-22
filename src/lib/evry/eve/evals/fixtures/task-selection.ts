import { z } from "zod";
import type { Expectations } from "../contract";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import { capturedReadArtifactSchema, type CapturedCall } from "./host-capture";
import { fixtureMessageSchema } from "../http/transcript";
import {
  projectEveMessage,
  selectedEveResultReferences,
} from "@/components/evry/eve-message-projection";
import { STATUS_CONFIG } from "@/lib/tasks/presentation";
import {
  taskCleanupPlanReference,
  taskCleanupRowSignature,
} from "./task-cleanup";

export const taskSelectionFixtureIds = ["tasks-10"] as const;
export const taskSelectionSetup =
  "Show the five tasks in the Welcome desk cleanup list.";
export const taskSelectionRequest = "Mark these five tasks complete.";
export const taskSelectionId = (m: FixtureManifest, key: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `task-selection:${key}`);
const listDescription = "Welcome desk cleanup list";
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
export function bindTaskSelectionTurns(turns: readonly string[]) {
  if (turns.length !== 1 || turns[0] !== taskSelectionRequest)
    throw new Error("tasks-10 original question changed");
  return [taskSelectionSetup, ...turns];
}
export function seedTaskSelectionFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  if (m.caseId !== "tasks-10") return;
  const id = (key: string) => taskSelectionId(m, key);
  // Member permissions are the baseline; the proof separately verifies Owner parity.
  store.sql(`update users set seat='member' where id='${m.ids.actor}';`);
  const entries = [
    ["one", "Check the signs", m.ids.actor, listDescription, "not_started"],
    [
      "two",
      "Pack the welcome supplies",
      m.ids.actor,
      listDescription,
      "in_progress",
    ],
    [
      "three",
      "Review the volunteer schedule",
      m.ids.actor,
      listDescription,
      "blocked",
    ],
    [
      "four",
      "Confirm the welcome briefing",
      m.ids.actor,
      listDescription,
      "not_started",
    ],
    [
      "five",
      "Arrange the refreshments",
      m.ids["other-actor"],
      listDescription,
      "not_started",
    ],
    [
      "same-title",
      "Check the signs",
      m.ids.actor,
      "Unselected work",
      "not_started",
    ],
    [
      "prerequisite-open",
      "Approve the welcome budget",
      m.ids.actor,
      "Prerequisite only",
      "not_started",
    ],
    [
      "prerequisite-done",
      "Choose the welcome supplies",
      m.ids.actor,
      "Prerequisite only",
      "complete",
    ],
  ];
  store.sql(`insert into tasks(id,church_id,title,description,status,priority,due_date,assigned_to_id,created_by_id) values ${entries.map(([key, title, owner, description, status]) => `('${id(key!)}','${m.ids.plant}',${quote(title!)},${quote(description!)},'${status}','medium','2026-09-21','${owner}','${m.ids.actor}')`).join(",")};
    insert into task_dependencies(id,church_id,task_id,prerequisite_task_id) values
    ('${id("edge-open")}','${m.ids.plant}','${id("three")}','${id("prerequisite-open")}'),
    ('${id("edge-done")}','${m.ids.plant}','${id("three")}','${id("prerequisite-done")}');`);
}
const rowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  assignedToId: z.uuid().nullable(),
});
export function taskSelectionTruth(m: FixtureManifest, store: FixtureStore) {
  const rows = z
    .array(rowSchema)
    .parse(
      store.query(
        `select id,title,description,status,priority,due_date::text as "dueDate",assigned_to_id as "assignedToId" from tasks where church_id='${m.ids.plant}' and deleted_at is null and parent_task_id is null and description=${quote(listDescription)} order by id`
      )
    );
  const seat = z
    .enum(["owner", "admin", "member"])
    .parse(
      store.query(
        `select seat from users where id='${m.ids.actor}' and church_id='${m.ids.plant}'`
      )[0]?.seat
    );
  const actionable = rows.filter(
    (r) => r.assignedToId === m.ids.actor || seat !== "member"
  );
  const dependencies = store
    .query(
      `select d.task_id,d.prerequisite_task_id,p.status from task_dependencies d join tasks t on t.id=d.task_id and t.church_id=d.church_id join tasks p on p.id=d.prerequisite_task_id and p.church_id=d.church_id where d.church_id='${m.ids.plant}' and t.description=${quote(listDescription)} and t.deleted_at is null and p.deleted_at is null order by d.task_id,d.prerequisite_task_id`
    )
    .map((raw) => {
      const r = z
        .object({
          task_id: z.uuid(),
          prerequisite_task_id: z.uuid(),
          status: z.enum(["not_started", "in_progress", "blocked", "complete"]),
        })
        .parse(raw);
      return `${r.task_id}:${r.prerequisite_task_id}:${STATUS_CONFIG[r.status].label}`;
    });
  return {
    rows,
    actionable,
    excluded: rows.filter((r) => !actionable.some((a) => a.id === r.id)),
    dependencies: dependencies.sort(),
  };
}
export function taskSelectionExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations | null {
  if (m.caseId !== "tasks-10") return null;
  const t = taskSelectionTruth(m, store);
  return {
    facts: {
      visibleTaskIds: t.rows.map((r) => r.id).sort(),
      requestedTaskIds: t.rows.map((r) => r.id).sort(),
      actionableTaskIds: t.actionable.map((r) => r.id).sort(),
      excludedTaskIds: t.excluded.map((r) => r.id).sort(),
      namedExclusions: t.excluded
        .map((r) => `${r.id}:${r.title}:That task is assigned to somebody else`)
        .sort(),
      beforeRows: t.actionable.map(taskCleanupRowSignature).sort(),
      afterRows: t.actionable
        .map((r) => taskCleanupRowSignature({ ...r, status: "complete" }))
        .sort(),
      dependencies: t.dependencies,
      dependencyTaskIds: t.rows.map((r) => r.id).sort(),
      otherFieldsUnchanged: true,
      awaitingConfirmation: true,
    },
    requiredEvidence: [
      "visible-five-before-request",
      "complete-prerequisite-evidence",
      "recorded:tasks-10",
    ],
    absentRecordIds: [m.ids["task-foreign"]],
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

/** Actual projected setup cards only, before the unchanged follow-up. Never prompt IDs. */
export function taskSelectionVisibleIds(
  messages: unknown,
  calls: readonly CapturedCall[],
  presented: ReadonlySet<string>
) {
  const parsed = z.array(fixtureMessageSchema).safeParse(messages);
  if (!parsed.success) return [];
  const text = (m: z.infer<typeof fixtureMessageSchema>) =>
    m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");
  const users = parsed.data.filter((m) => m.role === "user");
  if (
    users.length !== 2 ||
    text(users[0]!) !== taskSelectionSetup ||
    text(users[1]!) !== taskSelectionRequest
  )
    return [];
  const end = parsed.data.indexOf(users[1]!);
  const prior = parsed.data
    .slice(parsed.data.indexOf(users[0]!) + 1, end)
    .filter((m) => m.role === "assistant");
  const ids: string[] = [];
  for (const message of prior) {
    if (message.metadata?.status !== "complete") return [];
    const refs = selectedEveResultReferences(message);
    const cards = projectEveMessage(message).filter(
      (p) => p.kind === "artifact" && p.artifact.kind === "read"
    );
    for (const ref of refs) {
      const call = calls.find((c) => c.id === ref);
      if (!call || call.name !== "tasks.query" || !presented.has(ref)) continue;
      const read = capturedReadArtifactSchema.safeParse(call.output);
      if (!read.success) return [];
      if (
        !cards.some(
          (c) =>
            c.kind === "artifact" &&
            c.artifact.kind === "read" &&
            JSON.stringify(c.artifact.items.map((r) => r.id)) ===
              JSON.stringify(read.data.items.map((r) => r.id))
        )
      )
        return [];
      ids.push(...read.data.items.map((r) => r.id));
    }
  }
  return ids.length === 5 && new Set(ids).size === 5 ? ids.sort() : [];
}

/** Related pages retain exact IDs, totals and order. A fresh offset-zero read replaces stale evidence. */
export function taskSelectionDependencies(
  calls: readonly CapturedCall[],
  ids: readonly string[]
) {
  const state = new Map<
    string,
    { next: number; total: number; values: string[]; valid: boolean }
  >();
  for (const call of calls) {
    if (call.name !== "tasks.get_many") continue;
    const input = z
      .object({
        ids: z.array(z.uuid()),
        sections: z.array(z.string()),
        relatedOffset: z.number().optional(),
        relatedLimit: z.number().optional(),
      })
      .safeParse(call.input);
    if (!input.success || !input.data.sections.includes("dependencies"))
      continue;
    const offset = input.data.relatedOffset ?? 0;
    const read = capturedReadArtifactSchema.safeParse(call.output);
    for (const id of input.data.ids.filter((id) => ids.includes(id))) {
      if (offset === 0)
        state.set(id, { next: 0, total: -1, values: [], valid: true });
      const run = state.get(id);
      if (!run) continue;
      const row = read.success
        ? read.data.items.find((r) => r.id === id)
        : undefined;
      const facts = row?.facts ?? [];
      const totals = facts.filter((f) => f.label === "Prerequisite total");
      const values = facts.filter((f) => f.label === "Prerequisite");
      const links = facts.filter((f) => f.label === "Prerequisite linkage");
      const total =
        totals.length === 1 && /^\d+$/.test(totals[0]!.value)
          ? Number(totals[0]!.value)
          : -1;
      if (
        !run.valid ||
        !row ||
        offset !== run.next ||
        total < 0 ||
        (run.total >= 0 && run.total !== total) ||
        values.length !== links.length
      ) {
        run.valid = false;
        continue;
      }
      run.total = total;
      for (const [index, link] of links.entries()) {
        const prerequisite = /\[([0-9a-f-]{36})\]/.exec(link.value)?.[1];
        const status = Object.values(STATUS_CONFIG)
          .map((s) => s.label)
          .find((label) => values[index]!.value.includes(` · ${label} · `));
        if (!prerequisite || !status) {
          run.valid = false;
          break;
        }
        run.values.push(`${id}:${prerequisite}:${status}`);
      }
      run.next += values.length;
      if (
        new Set(run.values.map((v) => v.slice(0, 73))).size !==
          run.values.length ||
        run.next > total
      )
        run.valid = false;
    }
  }
  const complete = ids
    .filter((id) => {
      const s = state.get(id);
      return s?.valid && s.next === s.total;
    })
    .sort();
  return {
    dependencyTaskIds: complete,
    dependencies: complete.flatMap((id) => state.get(id)!.values).sort(),
  };
}

export async function readPreparedTaskSelectionFacts(input: {
  manifest: FixtureManifest;
  store: FixtureStore;
  calls: readonly CapturedCall[];
  presented: ReadonlySet<string>;
  messages?: unknown;
}) {
  const empty = {
    facts: {} as Expectations["facts"],
    evidence: [] as string[],
  };
  const ref = taskCleanupPlanReference(input.calls, input.presented);
  if (!ref) return empty;
  const m = input.manifest;
  const rows = input.store.query(
    `select p.document,p.expires_at::text from evry_action_plans p join evry_action_plan_states s on s.plan_id=p.id and s.church_id=p.church_id where p.id='${ref.planId}' and p.fingerprint='${ref.fingerprint}' and p.actor_user_id='${m.ids.actor}' and p.church_id='${m.ids.plant}' and s.status='awaiting_confirmation' and p.expires_at>'${m.now}'::timestamptz and not exists(select 1 from evry_plan_confirmations c where c.plan_id=p.id)`
  );
  if (rows.length !== 1) return empty;
  const row = z
    .object({ document: z.unknown(), expires_at: z.string() })
    .parse(rows[0]);
  const [
    { parseStoredEvryActionPlan, fingerprintEvryActionPlan },
    { PRODUCTION_EVRY_PLAN_REGISTRY },
    { TASKS_EFFECT_ARGUMENT_SCHEMAS },
  ] = await Promise.all([
    import("@/lib/evry/plans"),
    import("@/lib/evry/capabilities/execution"),
    import("@/lib/evry/capabilities/tasks/effect-contracts"),
  ]);
  const document = parseStoredEvryActionPlan({
    document: row.document,
    registry: PRODUCTION_EVRY_PLAN_REGISTRY,
  });
  if (
    fingerprintEvryActionPlan({
      actorUserId: m.ids.actor,
      plantId: m.ids.plant,
      expiresAt: new Date(row.expires_at),
      document,
    }) !== ref.fingerprint ||
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== "tasks.bulk.complete"
  )
    return empty;
  const args = TASKS_EFFECT_ARGUMENT_SCHEMAS.bulkCompleteTasksAction.parse(
    document.steps[0].arguments
  );
  if (
    args.sourceAssertion.kind !== "bulk_selection" ||
    args.taskWrites.some((w) => w.before === null)
  )
    return empty;
  const preparationIndex = input.calls.findLastIndex(
    (call) => call.name === "actions.prepare"
  );
  const precedingCalls = input.calls.slice(0, preparationIndex);
  const selected = taskSelectionVisibleIds(
    input.messages,
    precedingCalls,
    input.presented
  );
  const deps = taskSelectionDependencies(precedingCalls, selected);
  const stable = (v: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            !["status", "completedAt", "completedById", "updatedAt"].includes(k)
        )
        .sort(([a], [b]) => a.localeCompare(b))
    );
  return {
    facts: {
      visibleTaskIds: selected,
      requestedTaskIds: [...args.sourceAssertion.requestedTaskIds].sort(),
      actionableTaskIds: [...args.sourceAssertion.actionableTaskIds].sort(),
      excludedTaskIds: args.sourceAssertion.excludedTasks
        .map((t) => t.taskId)
        .sort(),
      namedExclusions: args.sourceAssertion.excludedTasks
        .map(
          (t) => `${t.taskId}:${t.expectedTask?.title ?? "unknown"}:${t.reason}`
        )
        .sort(),
      beforeRows: args.taskWrites
        .map((w) => taskCleanupRowSignature(rowSchema.parse(w.before)))
        .sort(),
      afterRows: args.taskWrites
        .map((w) => taskCleanupRowSignature(w.after))
        .sort(),
      ...deps,
      otherFieldsUnchanged: args.taskWrites.every(
        (w) =>
          JSON.stringify(stable(w.before!)) ===
            JSON.stringify(stable(w.after)) &&
          w.after.status === "complete" &&
          w.after.completedAt === m.now &&
          w.after.completedById === m.ids.actor
      ),
      awaitingConfirmation: true,
    },
    evidence: [
      ...(selected.length === 5 ? ["visible-five-before-request"] : []),
      ...(deps.dependencyTaskIds.length === 5
        ? ["complete-prerequisite-evidence"]
        : []),
      "recorded:tasks-10",
    ],
  };
}
