// ============================================================================
// Launch readiness — the Playbook-seeded milestones and their tasks (LS-003).
//
// NO `"use server"` DIRECTIVE, for the same reason `service.ts` has none: every
// export of such a module is a POSTable endpoint with no session behind it
// (memory/invariants.md → Authentication, the #265 rules). These helpers take
// bare ids and build raw SQL. The actions that call them live next to the page
// and mint their actor from `verifySession()`.
//
// THE HYBRID MODEL (ruled 2026-08-04, carried by FRD LS-003):
//
//   * the milestone SET is fixed — the Launch Playbook's three priority areas,
//     seeded when the launch is first scheduled. Planter-defined milestones are
//     an explicit alpha non-goal, so the set lives here as DATA rather than in
//     the database, and `templateKey` (never the title) is what code matches on.
//   * each milestone expands into `launch_prep` TASKS, which are ordinary tasks
//     from the moment they are seeded: the task system owns their due dates,
//     assignees and status, and nothing here writes them again.
//   * milestone progress is DERIVED from those tasks on read. It is not a
//     column, because a stored counter and its tasks drift the first time a
//     task is deleted, reopened or reassigned.
//   * `completed_at` is the one stored bit, and it is set MANUALLY — a milestone
//     with no open tasks is completable by hand. "No open tasks" is the guard,
//     enforced in the UPDATE's WHERE (below), not in the button's `disabled`.
//
// WHY THE SEEDED TASKS CARRY NO DUE DATES. It is tempting to derive them from
// the target date ("three weeks out"). Then the planter moves the launch and
// either 22 tasks are silently overdue, or the move rewrites tasks the planter
// has since edited and assigned. Both are worse than undated tasks whose timing
// the milestone's own description states. The Playbook's windows are in the
// descriptions; the dates are the planter's.
// ============================================================================

import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import type { User } from "@/db/schema";
import {
  launchMilestones,
  launchMilestoneTasks,
  tasks,
  users,
} from "@/db/schema";
import type { LaunchMilestoneArea, LaunchStatus } from "@/db/schema/launch";
import type { TaskStatus } from "@/db/schema/tasks";
import { requireChurchAccess } from "@/lib/auth/access";
import { assertSeatFor } from "@/lib/auth/seat-rules";
import type { LaunchRecord } from "@/lib/launch/queries";
import { normalizeTaskDescription } from "@/lib/tasks/descriptions";

// ----------------------------------------------------------------------------
// The template
// ----------------------------------------------------------------------------

export interface LaunchMilestoneTaskTemplate {
  title: string;
  description: string | null;
}

export interface LaunchMilestoneTemplate {
  /** Stable across reseeds — the thing code matches on, never the title. */
  templateKey: string;
  area: LaunchMilestoneArea;
  title: string;
  description: string;
  tasks: readonly LaunchMilestoneTaskTemplate[];
}

export {
  LAUNCH_MILESTONE_AREA_LABELS,
  LAUNCH_MILESTONE_AREA_ORDER,
} from "./milestone-areas";

/**
 * The fixed readiness set, derived from `product-docs/launch-playbook.md`
 * ("Preparation for Launch Sunday" and "Launch Sunday"). Referenced, not
 * duplicated: each description points at what the Playbook asks for, and the
 * Playbook stays the prose.
 *
 * Adding a milestone here is safe — seeding is idempotent per
 * (launch_id, template_key), so an already-seeded plant picks up the new row on
 * its next schedule. REMOVING one is not: the rows and their tasks already
 * exist. Retire a milestone by dropping it from this list AND leaving the
 * seeded rows alone; nothing here deletes.
 */
export const LAUNCH_MILESTONE_TEMPLATES: readonly LaunchMilestoneTemplate[] = [
  // ---- Operations / set-up & tear-down ------------------------------------
  {
    templateKey: "operations.equipment_on_site",
    area: "operations",
    title: "Set-up equipment on site",
    description:
      "Every piece of set-up equipment needed to launch arrives during the three-to-four week window, stored and labelled.",
    tasks: [
      { title: "Order the remaining set-up equipment", description: null },
      {
        title: "Confirm delivery dates for everything still outstanding",
        description: null,
      },
      {
        title: "Label and store the equipment where the team will find it",
        description: null,
      },
    ],
  },
  {
    templateKey: "operations.setup_training",
    area: "operations",
    title: "Set-up and tear-down training held",
    description:
      "A full Saturday of in-service training: hands-on set-up and tear-down, storage, care of equipment, and working as teams.",
    tasks: [
      {
        title: "Book the full-Saturday in-service training",
        description: null,
      },
      {
        title: "Walk the team through set-up, tear-down and storage",
        description: null,
      },
      {
        title: "Test and improve Worship Center acoustics and lighting",
        description: null,
      },
    ],
  },
  {
    templateKey: "operations.worship_center",
    area: "operations",
    title: "Worship Center secured and rehearsed in",
    description:
      "The room is secured for set-up, tear-down and launch-team meetings — optimally used three times before Launch Sunday.",
    tasks: [
      { title: "Confirm the Worship Center booking", description: null },
      {
        title: "Schedule three uses of the room before Launch Sunday",
        description: null,
      },
    ],
  },
  // ---- Launch team preparation --------------------------------------------
  {
    templateKey: "launch_team.prayer_and_fasting",
    area: "launch_team",
    title: "Prayer and fasting underway",
    description:
      "One day a week of fasting through the four weeks before launch, ending in corporate worship, prayer and a shared meal. The senior pastor leads it.",
    tasks: [
      {
        title: "Set the weekly fast day for the four weeks before launch",
        description: null,
      },
      {
        title: "Plan the worship, prayer and shared meal that close each fast",
        description: null,
      },
    ],
  },
  {
    templateKey: "launch_team.pre_launch_services",
    area: "launch_team",
    title: "Three pre-launch services held",
    description:
      "Launch-team-only services on the three Sundays (or Saturdays) before launch: set-up, worship, preaching, children's ministry, assimilation, celebration.",
    tasks: [
      {
        title: "Book the Worship Center for three pre-launch services",
        description: null,
      },
      { title: "Run pre-launch service 1", description: null },
      { title: "Run pre-launch services 2 and 3", description: null },
    ],
  },
  {
    templateKey: "launch_team.ministry_training",
    area: "launch_team",
    title: "Ministry training 90–100% complete",
    description:
      "Specific ministry training should be all but finished before the final window — this is the time to integrate the parts into the whole.",
    tasks: [
      {
        title:
          "Finish children's ministry training: teachers, curriculum, check-in, safety",
        description: null,
      },
      { title: "Finish the worship team run-through", description: null },
      { title: "Test assimilation end to end", description: null },
    ],
  },
  // ---- Promotion -----------------------------------------------------------
  {
    templateKey: "promotion.plan",
    area: "promotion",
    title: "Promotion plan chosen",
    description:
      "A well-thought-out, prayerful plan sized to the plant's financial condition — not every channel in the Playbook, the right ones.",
    tasks: [
      {
        title: "Choose the promotion channels your budget supports",
        description: null,
      },
      {
        title: "Set the launch team's personal invitation goal",
        description: null,
      },
    ],
  },
  {
    templateKey: "promotion.implemented",
    area: "promotion",
    title: "Promotion plan implemented",
    description:
      "Three to four weeks out triggers the full launch of the promotion plan — get the word out by every means the plan named.",
    tasks: [
      { title: "Send the press release to local media", description: null },
      { title: "Run the email blast and social posts", description: null },
      {
        title: "Distribute invitation cards, door hangers and mailers",
        description: null,
      },
    ],
  },
  {
    templateKey: "promotion.partner_churches",
    area: "promotion",
    title: "Partner churches announcing the launch",
    description:
      "The week before launch, every partner church shows the announcement slide — and the partner organization's role in the service is settled.",
    tasks: [
      {
        title: "Email the launch announcement slide to every partner church",
        description: null,
      },
      {
        title: "Confirm the partner organization's role in the service",
        description: null,
      },
    ],
  },
];

// ----------------------------------------------------------------------------
// Seeding
// ----------------------------------------------------------------------------

interface SeedMilestoneRow {
  milestoneId: string;
  templateKey: string;
  area: LaunchMilestoneArea;
  title: string;
  description: string;
  sortOrder: number;
  tasks: { taskId: string; title: string; description: string | null }[];
}

/**
 * Ids are minted HERE, in TypeScript, rather than by `defaultRandom()`.
 *
 * The seed writes three tables whose rows point at each other, and the join
 * rows need both ends. Letting the database mint them would mean reading back
 * two `RETURNING` sets and matching them up by title — which is only unique by
 * accident. Known ids make the whole seed one statement whose join rows are
 * decided before it runs.
 */
function planSeedRows(
  templates: readonly LaunchMilestoneTemplate[] = LAUNCH_MILESTONE_TEMPLATES
): SeedMilestoneRow[] {
  return templates.map((template, index) => ({
    milestoneId: crypto.randomUUID(),
    templateKey: template.templateKey,
    area: template.area,
    title: template.title,
    // NOT normalised: this is `launch_milestones.description`, a different
    // column on a different table, rendered as plain text by
    // `milestone-board.tsx`. Only the TASK rows below take the task door.
    description: template.description,
    // Display order across the whole list, from the template's own order — so
    // the page never has to know the area order separately.
    sortOrder: (index + 1) * 10,
    tasks: template.tasks.map((task) => ({
      taskId: crypto.randomUUID(),
      title: task.title,
      // This is a writer of `tasks.description`, so it takes the same door as
      // `createTask`, `updateTask` and `importTaskTemplate` (T-021). The seed's
      // strings are first-party plain text today and `toRichTextHtml` converts
      // legacy prose on read, so nothing renders differently — but a description
      // that reaches the column without passing `normalizeTaskDescription` is a
      // shape no reader is entitled to assume, and this is the only writer that
      // did. `descriptions.ts` imports nothing but the rich-text door, so this
      // pulls no database code into the module.
      description: normalizeTaskDescription(task.description),
    })),
  }));
}

/**
 * Seed the Playbook set for a launch — milestones, their `launch_prep` tasks,
 * and the join rows — in ONE statement.
 *
 * IDEMPOTENT, and the database is what makes it so. `on conflict (launch_id,
 * template_key) do nothing` means a second seed of the same launch inserts no
 * milestones; the task insert reads `seeded`'s RETURNING rows, so it inserts no
 * tasks either, and the link insert reads the task insert's. A re-schedule (or
 * two clicks, or two planters) therefore cannot double a plant's task list —
 * which a `SELECT count(*) = 0` guard in application code could not promise,
 * since two concurrent seeds both pass it (invariants → Atomicity).
 *
 * The same chain is what lets a milestone be ADDED to the template later: an
 * already-seeded plant conflicts on the nine it has and inserts only the new
 * one, with only that one's tasks.
 *
 * Not a `db.batch`: the task insert consumes the milestone insert's RETURNING,
 * and a batch statement cannot see a previous statement's output.
 */
export function seedLaunchMilestonesStatement(input: {
  launchId: string;
  churchId: string;
  actorUserId: string;
  rows: SeedMilestoneRow[];
}): SQL {
  const milestoneValues = sql.join(
    input.rows.map(
      (row) =>
        sql`(${row.milestoneId}::uuid, ${row.templateKey}::varchar, ${row.area}::varchar, ${row.title}::varchar, ${row.description}::text, ${row.sortOrder}::integer)`
    ),
    sql`, `
  );

  const taskRows = input.rows.flatMap((row) =>
    row.tasks.map((task) => ({ ...task, milestoneId: row.milestoneId }))
  );

  const taskValues = sql.join(
    taskRows.map(
      (task) =>
        sql`(${task.taskId}::uuid, ${task.milestoneId}::uuid, ${task.title}::varchar, ${task.description}::text)`
    ),
    sql`, `
  );

  return sql`
    with milestone_template as (
      select * from (values ${milestoneValues})
        as t(id, template_key, area, title, description, sort_order)
    ), task_template as (
      select * from (values ${taskValues})
        as t(id, milestone_id, title, description)
    ), seeded as (
      insert into launch_milestones (
        id, launch_id, church_id, template_key, area, title, description, sort_order
      )
      select
        mt.id, ${input.launchId}, ${input.churchId},
        mt.template_key, mt.area, mt.title, mt.description, mt.sort_order
      from milestone_template mt
      on conflict (launch_id, template_key) do nothing
      returning id
    ), seeded_tasks as (
      insert into tasks (id, church_id, title, description, category, created_by_id)
      select tt.id, ${input.churchId}, tt.title, tt.description, 'launch_prep', ${input.actorUserId}
      from task_template tt
      join seeded s on s.id = tt.milestone_id
      returning id
    ), linked as (
      insert into launch_milestone_tasks (milestone_id, task_id, church_id)
      select tt.milestone_id, tt.id, ${input.churchId}
      from task_template tt
      join seeded_tasks st on st.id = tt.id
      returning id
    )
    select
      (select count(*)::int from seeded) as milestone_count,
      (select count(*)::int from linked) as task_count
  `;
}

export interface SeedLaunchMilestonesResult {
  milestonesCreated: number;
  tasksCreated: number;
}

/**
 * Seed the readiness set for a launch that has just been scheduled (LS-003).
 *
 * Called by the schedule action AFTER the durable date write, and safe to call
 * on every schedule: see the statement's idempotency above. It takes the actor
 * because the seeded tasks need a `created_by_id`, and that is the session's
 * user — never an id that arrived from a client.
 */
export async function seedLaunchMilestones(input: {
  launchId: string;
  churchId: string;
  actorUserId: string;
}): Promise<SeedLaunchMilestonesResult> {
  const result = await db.execute<{
    milestone_count: number;
    task_count: number;
  }>(seedLaunchMilestonesStatement({ ...input, rows: planSeedRows() }));

  const row = result.rows[0];
  return {
    milestonesCreated: Number(row?.milestone_count ?? 0),
    tasksCreated: Number(row?.task_count ?? 0),
  };
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export interface LaunchMilestoneTaskView {
  id: string;
  title: string;
  status: TaskStatus;
  isComplete: boolean;
  dueDate: string | null;
  assigneeName: string | null;
}

export interface LaunchMilestoneView {
  id: string;
  templateKey: string;
  area: LaunchMilestoneArea;
  title: string;
  description: string | null;
  sortOrder: number;
  completedAt: Date | null;
  isComplete: boolean;
  tasks: LaunchMilestoneTaskView[];
  openTaskCount: number;
  completedTaskCount: number;
}

export interface LaunchReadiness {
  milestones: LaunchMilestoneView[];
  completedCount: number;
  totalCount: number;
  openTaskCount: number;
}

/**
 * One plant's readiness — milestones in template order, each with its live
 * tasks (LS-003).
 *
 * ONE query, not one per milestone: the page renders every milestone every
 * time, so the obvious `for (const milestone of milestones) await tasks(...)`
 * would be an N+1 on the plant's most-visited launch surface. Soft-deleted
 * tasks are excluded IN THE JOIN, so a deleted task disappears from the
 * milestone's progress rather than pinning it open forever.
 *
 * Scoped by church_id as well as launch_id — the launch already carries the
 * tenant, and the second predicate costs nothing (invariants → Multi-Tenancy).
 */
export async function getLaunchReadiness(
  launchId: string,
  churchId: string
): Promise<LaunchReadiness> {
  const rows = await db
    .select({
      id: launchMilestones.id,
      templateKey: launchMilestones.templateKey,
      area: launchMilestones.area,
      title: launchMilestones.title,
      description: launchMilestones.description,
      sortOrder: launchMilestones.sortOrder,
      completedAt: launchMilestones.completedAt,
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskStatus: tasks.status,
      taskDueDate: tasks.dueDate,
      taskCreatedAt: tasks.createdAt,
      assigneeName: users.name,
    })
    .from(launchMilestones)
    .leftJoin(
      launchMilestoneTasks,
      eq(launchMilestoneTasks.milestoneId, launchMilestones.id)
    )
    .leftJoin(
      tasks,
      and(eq(tasks.id, launchMilestoneTasks.taskId), isNull(tasks.deletedAt))
    )
    .leftJoin(users, eq(users.id, tasks.assignedToId))
    .where(
      and(
        eq(launchMilestones.launchId, launchId),
        eq(launchMilestones.churchId, churchId)
      )
    )
    .orderBy(
      launchMilestones.sortOrder,
      launchMilestones.templateKey,
      tasks.createdAt
    );

  const byId = new Map<string, LaunchMilestoneView>();

  for (const row of rows) {
    let milestone = byId.get(row.id);
    if (!milestone) {
      milestone = {
        id: row.id,
        templateKey: row.templateKey,
        area: row.area,
        title: row.title,
        description: row.description,
        sortOrder: row.sortOrder,
        completedAt: row.completedAt,
        isComplete: row.completedAt !== null,
        tasks: [],
        openTaskCount: 0,
        completedTaskCount: 0,
      };
      byId.set(row.id, milestone);
    }

    // A milestone with no live tasks still yields one row, with nulls on the
    // task side — that is a milestone with nothing linked, not a task.
    if (!row.taskId || !row.taskStatus) continue;

    const isComplete = row.taskStatus === "complete";
    milestone.tasks.push({
      id: row.taskId,
      title: row.taskTitle ?? "",
      status: row.taskStatus,
      isComplete,
      dueDate: row.taskDueDate,
      assigneeName: row.assigneeName,
    });
    if (isComplete) milestone.completedTaskCount += 1;
    else milestone.openTaskCount += 1;
  }

  const milestones = [...byId.values()];

  return {
    milestones,
    completedCount: milestones.filter((milestone) => milestone.isComplete)
      .length,
    totalCount: milestones.length,
    openTaskCount: milestones.reduce(
      (total, milestone) => total + milestone.openTaskCount,
      0
    ),
  };
}

// ----------------------------------------------------------------------------
// Converging on read (#614)
// ----------------------------------------------------------------------------

/**
 * Does a launch in this state expect the Playbook readiness set?
 *
 * A MAP RATHER THAN A BRANCH, so the compiler names this decision the day a
 * fifth status is added: `satisfies Record<LaunchStatus, boolean>` refuses a
 * missing key, where an `if` chain would quietly answer `false` for it.
 *
 * `planning` has no day yet, and nothing is seeded until one is named.
 * `completed` is the day already past — seeding twenty-two open tasks the
 * Monday after a launch invents work for a plant that has finished it, and the
 * page's board is a record by then, not a list to work. `postponed` is not
 * terminal (see `launchStatuses`): it carries a NEW target date and the plant
 * goes on preparing, so it expects its list exactly as `scheduled` does.
 */
const EXPECTS_READINESS = {
  planning: false,
  scheduled: true,
  postponed: true,
  completed: false,
} satisfies Record<LaunchStatus, boolean>;

export function launchExpectsReadiness(status: LaunchStatus): boolean {
  return EXPECTS_READINESS[status];
}

/**
 * The plant's Owner, or `null` for a plant that has none.
 *
 * At most one row can come back: `users_church_owner_unique_idx` is a partial
 * unique on `church_id where seat = 'owner'` (AS-002), so "the Owner" is a row
 * rather than a pick from a list.
 */
async function plantOwnerId(churchId: string): Promise<string | null> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.churchId, churchId), eq(users.seat, "owner")))
    .limit(1);

  return owner?.id ?? null;
}

/**
 * The readiness board — AND the repair for a launch that has none (#614).
 *
 * WHY THE REPAIR IS ON THE READ. Seeding runs after the durable date write and
 * is deliberately not part of it (`scheduleLaunchAction`), so a launch whose
 * seed failed keeps its date and loses its list. Riverside sat in exactly that
 * state for thirteen days: `status = 'scheduled'`, zero `launch_milestones`,
 * and no path back — the schedule form disables both buttons until a DIFFERENT
 * day is picked, so the only writer that could have re-seeded was unreachable
 * from the page that showed the damage. Moving the retry to the read makes the
 * operation idempotent from the reader's side: the next visit heals it, and no
 * planter has to know that moving the date by a day is what fixes it.
 *
 * IT IS A WRITE DURING A SERVER-COMPONENT RENDER, which is legal here for the
 * same two reasons `listResponsibilities` (MT-002b) is: `/launch` is
 * `force-dynamic`, so the render is never cached, and nothing on the path
 * revalidates. It is safe to run on every visit because the seed is idempotent
 * by unique index — two tabs opened together produce ONE set of rows, since the
 * second `insert … on conflict (launch_id, template_key) do nothing` waits for
 * the first and then inserts nothing, and the task insert reads that insert's
 * own `RETURNING` (see `seedLaunchMilestonesStatement`).
 *
 * A FAILED SEED NEVER TAKES THE PAGE DOWN. The `catch` is not a swallowed
 * error: the caller renders the readiness section's empty state on a zero-rows
 * answer, which is the honest thing to show and is what makes a second visit a
 * retry rather than a fresh 500. Throwing instead would turn a missing list
 * into a missing page.
 *
 * THE REPAIR IS THE PLANT'S, NOT THE READER'S, so the rows it writes are
 * attributed to the plant's OWNER and are indistinguishable from the rows
 * `scheduleLaunchAction` would have written. `/launch` admits a team member as
 * well as the planter, and `tasks.created_by_id` is NOT NULL — so without this
 * lookup the first Member to open a stranded plant's launch page would become
 * the recorded author of its whole launch-prep list, which no capability ever
 * granted them (`launch.schedule` is the Owner's alone, LS-007). `readerId` is
 * the fallback and not the default: a plant can be left with no Owner seat
 * (`removeSeat` clears the tenancy), and a repair refused for want of an author
 * would strand exactly the plant this function exists for.
 */
export async function convergeLaunchReadiness(
  launch: LaunchRecord,
  readerId: string
): Promise<LaunchReadiness> {
  // The launch row carries its own tenant, so there is no second church id to
  // pass in and none to get wrong; it was resolved by `getLaunchForChurch`.
  const churchId = launch.churchId;
  const readiness = await getLaunchReadiness(launch.id, churchId);

  if (readiness.totalCount > 0) return readiness;
  if (!launchExpectsReadiness(launch.status)) return readiness;

  try {
    await seedLaunchMilestones({
      launchId: launch.id,
      churchId,
      actorUserId: (await plantOwnerId(churchId)) ?? readerId,
    });
  } catch (error) {
    console.error(
      `launch readiness converge failed for launch ${launch.id}:`,
      error
    );
    return readiness;
  }

  // Re-read rather than build the board from the seed's counts: a concurrent
  // visit may have won the insert, and its rows are the plant's readiness just
  // as much as ours would have been.
  return getLaunchReadiness(launch.id, churchId);
}

export interface LaunchMilestoneCompletion {
  milestoneId: string;
  title: string;
  area: LaunchMilestoneArea;
  completedAt: Date;
  /** `null` for a milestone closed before the column carried an actor. */
  actorName: string | null;
}

/**
 * Who closed which milestone, and when — the plant-facing half of the launch
 * history (LS-003/LS-004).
 *
 * READ-TIME ONLY. `completed_at` and `completed_by_user_id` are already on the
 * row; this is the pair being READ rather than a second journal being written.
 * There is deliberately no `launch_events` row per milestone: the milestone
 * table already answers "who and when" for the state it holds, and a parallel
 * event log would be a second truth to keep in step with it.
 *
 * A LEFT join on the actor, not an inner one: a milestone whose closer has
 * since been deleted is still a milestone that was closed, and an inner join
 * would silently drop it out of the history.
 */
export async function getLaunchMilestoneHistory(
  launchId: string,
  churchId: string
): Promise<LaunchMilestoneCompletion[]> {
  const rows = await db
    .select({
      milestoneId: launchMilestones.id,
      title: launchMilestones.title,
      area: launchMilestones.area,
      completedAt: launchMilestones.completedAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(launchMilestones)
    .leftJoin(users, eq(users.id, launchMilestones.completedByUserId))
    .where(
      and(
        eq(launchMilestones.launchId, launchId),
        eq(launchMilestones.churchId, churchId),
        isNotNull(launchMilestones.completedAt)
      )
    )
    .orderBy(desc(launchMilestones.completedAt));

  return rows.flatMap((row) =>
    // `isNotNull` above already guarantees it; the guard is what lets the
    // returned type promise a `Date` instead of pushing the null onto callers.
    row.completedAt
      ? [
          {
            milestoneId: row.milestoneId,
            title: row.title,
            area: row.area,
            completedAt: row.completedAt,
            actorName: row.actorName || row.actorEmail || null,
          },
        ]
      : []
  );
}

// ----------------------------------------------------------------------------
// Completion
// ----------------------------------------------------------------------------

export const MILESTONE_HAS_OPEN_TASKS_MESSAGE =
  "Finish or remove this milestone's open tasks before marking it complete.";

export const MILESTONE_NOT_FOUND_MESSAGE =
  "That milestone is no longer available. Reload the page.";

/**
 * Mark a milestone complete — allowed only when it has NO OPEN TASKS.
 *
 * The rule is in the WHERE, not in the button. A `disabled` button is a
 * courtesy; the `not exists` below is the guard, and it is what makes the
 * check survive the race the courtesy cannot see — a teammate reopening the
 * last task while this request is in flight. `completed_at is null` makes the
 * write a compare-and-set, so a double-click completes once and the second
 * request truthfully reports it changed nothing.
 *
 * Soft-deleted tasks do not count as open: deleting a task is how a planter
 * says it no longer applies, and a deleted task that still blocked its
 * milestone would be unfinishable.
 */
export function completeLaunchMilestoneStatement(input: {
  milestoneId: string;
  churchId: string;
  actorUserId: string;
}): SQL {
  return sql`
    update launch_milestones m
    set completed_at = now(),
        completed_by_user_id = ${input.actorUserId},
        updated_at = now()
    where m.id = ${input.milestoneId}
      and m.church_id = ${input.churchId}
      and m.completed_at is null
      and not exists (
        select 1
        from launch_milestone_tasks lmt
        join tasks t on t.id = lmt.task_id
        where lmt.milestone_id = m.id
          and t.deleted_at is null
          and t.status <> 'complete'
      )
    returning m.id
  `;
}

/** Undo a completion. No open-task guard — reopening is always allowed. */
export function reopenLaunchMilestoneStatement(input: {
  milestoneId: string;
  churchId: string;
}): SQL {
  return sql`
    update launch_milestones m
    set completed_at = null,
        completed_by_user_id = null,
        updated_at = now()
    where m.id = ${input.milestoneId}
      and m.church_id = ${input.churchId}
      and m.completed_at is not null
    returning m.id
  `;
}

export type MilestoneWriteResult =
  | { status: "changed" }
  | { status: "unchanged" }
  | { status: "error"; error: string };

/**
 * AUTHORISES ITSELF, and the rule is NOT the planter-only one the date write
 * uses. LS-007 splits them deliberately: scheduling, postponing and recording
 * the outcome are the planter's plant-level decisions, while "milestone/task
 * completion follows normal task rules" — so a team member who may complete a
 * task may also close the milestone that task belongs to.
 *
 * `launch.milestone` is what keeps that from becoming "anyone with access":
 * an oversight account has church ACCESS to an associated plant and would sail
 * past `requireChurchAccess` alone. Oversight watches a plant's readiness; it
 * does not tick it off — and neither does a COACH, who holds no seat at all
 * (AS-008). `requireChurchLevel`, which this replaces, admitted one.
 */
export async function completeLaunchMilestone(
  user: User,
  churchId: string,
  milestoneId: string
): Promise<MilestoneWriteResult> {
  assertSeatFor(user, "launch.milestone");
  await requireChurchAccess(user, churchId);

  const result = await db.execute<{ id: string }>(
    completeLaunchMilestoneStatement({
      milestoneId,
      churchId,
      actorUserId: user.id,
    })
  );

  if (result.rows[0]) return { status: "changed" };

  // Nothing was written. Which of the three reasons it was decides the message,
  // because "already done" and "still has open work" are not the same answer.
  const [stored] = await db
    .select({ completedAt: launchMilestones.completedAt })
    .from(launchMilestones)
    .where(
      and(
        eq(launchMilestones.id, milestoneId),
        eq(launchMilestones.churchId, churchId)
      )
    )
    .limit(1);

  if (!stored) return { status: "error", error: MILESTONE_NOT_FOUND_MESSAGE };
  if (stored.completedAt) return { status: "unchanged" };
  return { status: "error", error: MILESTONE_HAS_OPEN_TASKS_MESSAGE };
}

/** Reopen a completed milestone. Same authorisation as completing one. */
export async function reopenLaunchMilestone(
  user: User,
  churchId: string,
  milestoneId: string
): Promise<MilestoneWriteResult> {
  assertSeatFor(user, "launch.milestone");
  await requireChurchAccess(user, churchId);

  const result = await db.execute<{ id: string }>(
    reopenLaunchMilestoneStatement({ milestoneId, churchId })
  );

  return result.rows[0] ? { status: "changed" } : { status: "unchanged" };
}

/**
 * Is this task one of the plant's launch-prep tasks?
 *
 * The launch page's task checkboxes go through the ordinary task service, which
 * is church-scoped but not launch-scoped. This is the extra predicate that
 * keeps the launch page's action from becoming a general "complete any task of
 * mine" endpoint: it answers only for tasks reachable from THIS church's
 * milestones.
 */
export async function isLaunchTask(
  churchId: string,
  taskId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: launchMilestoneTasks.id })
    .from(launchMilestoneTasks)
    .where(
      and(
        eq(launchMilestoneTasks.taskId, taskId),
        eq(launchMilestoneTasks.churchId, churchId)
      )
    )
    .limit(1);

  return !!row;
}
