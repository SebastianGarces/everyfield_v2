import { db } from "@/db";
import { tasks, type NewTask, type Task } from "@/db/schema";
import type { TaskCategory, TaskPriority } from "@/db/schema/tasks";
import type { PhaseNumber } from "@/lib/constants";

import { addCalendarDays, toCalendarDate } from "@/lib/datetime";

import { normalizeTaskDescription } from "./descriptions";
import { syncTaskNotificationsFor } from "./notifications";
import {
  UNKNOWN_TEMPLATE_ERROR,
  findTaskTemplate,
  taskTemplateItemPriority,
  type TaskTemplate,
} from "./templates";

// ============================================================================
// T-012 — importing a template as real tasks.
//
// RELATIVE DATES ARE THE WHOLE POINT. A template holds `offsetDays`, never a
// date. The calendar day is worked out here, at import time, from the day the
// planter pressed Import — so the same template imported in March and in
// September produces two different sets of due dates and neither is stale.
// The offsets are the only thing that ships in the code; nothing about "when"
// is ever stored in `templates.ts`.
//
// THE ARITHMETIC IS UTC, VIA `addCalendarDays`. `tasks.due_date` is a `date`
// column — a calendar day, not an instant — and `APP_TIME_ZONE` is UTC
// (`src/lib/datetime.ts`), which is also where the app's day primitives live.
// Reusing them is what stops a second, differently rounded copy of "which day
// is this?" appearing (`memory/invariants.md` → Date & Time Rendering).
//
// IMPORTING TWICE CREATES TWO SETS, ON PURPOSE. There is no dedupe, and the
// silence would be the bug — so the picker states it in words
// (`TEMPLATE_REIMPORT_NOTE`). Deduping would need a durable marker of "this
// church already imported this template", which is a column and a migration;
// and it would be wrong as often as right, because a planter who ran a vision
// meeting in March and another in June wants the follow-up list twice. What a
// planter must never get is a second copy they did not ask for and cannot see
// coming, which is what the note prevents.
//
// THIS MODULE IS SERVER-ONLY, AND NOT BY CONVENTION. Line 1 imports `@/db`,
// whose module scope calls `neon(process.env.DATABASE_URL!)`. Anything a
// `"use client"` file imports from here comes with drizzle, the schema and
// `@neondatabase/serverless` attached, and the chunk throws while it evaluates.
// That is what killed /tasks/templates: the picker imported one *string*.
//
// The two strings the browser needs now live in the db-free `./templates.ts`
// and are re-exported below, so server callers keep importing them from here
// and there is still one definition of each. `import "server-only"` is the
// repo's usual rail (`src/lib/auth/admin.ts:1`) but is not usable on this
// module for the same reason it was rejected on `src/lib/invitations/core.ts`
// (`src/lib/invitations/service.test.ts:849`): the package's default entry is a
// bare `throw` and resolves to the empty file only under the `react-server`
// condition, so `import.test.ts`, `import-live.test.ts` and the two
// phase-prompt suites — bare node processes that import this file directly —
// would all fail at load. The replacement rail is
// `src/components/tasks/template-picker.bundle.test.ts`, which walks the
// picker's transitive imports and fails in `pnpm test` (a required CI step)
// the moment a client module can reach `@/db` again.
// ============================================================================

// Re-exported, not redefined: `./templates.ts` is the db-free module the
// browser is allowed to import, and these are the only two names it owns that
// read as belonging here.
export { TEMPLATE_REIMPORT_NOTE, UNKNOWN_TEMPLATE_ERROR } from "./templates";

// ----------------------------------------------------------------------------
// The pure half: what an import WOULD create
// ----------------------------------------------------------------------------

/** One task an import is about to create. */
export interface PlannedTemplateTask {
  /** The template item this came from, for tests and for future dedupe. */
  itemKey: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  /** `YYYY-MM-DD`, computed from the import date and the item's offset. */
  dueDate: string;
  offsetDays: number;
}

export interface TemplateImportPlan {
  templateKey: string;
  templateName: string;
  phase: PhaseNumber;
  category: TaskCategory;
  /** The calendar day the offsets were measured from. */
  importedOn: string;
  tasks: PlannedTemplateTask[];
}

/**
 * `importedOn` plus `offsetDays`, as a calendar day.
 *
 * Both ends are UTC days, so this is day arithmetic and not instant
 * arithmetic: no hour of the import instant can push a task onto the day
 * before or after.
 */
export function templateDueDate(
  importedOn: string,
  offsetDays: number
): string {
  return addCalendarDays(new Date(`${importedOn}T00:00:00Z`), offsetDays);
}

/**
 * What importing this template on this day would create — with no database
 * anywhere near it, so the schedule is testable at any clock value.
 */
export function planTemplateImport(
  template: TaskTemplate,
  importedAt: Date
): TemplateImportPlan {
  const importedOn = toCalendarDate(importedAt);

  return {
    templateKey: template.key,
    templateName: template.name,
    phase: template.phase,
    category: template.category,
    importedOn,
    tasks: template.items.map((item) => ({
      itemKey: item.key,
      title: item.title,
      description: item.description ?? null,
      // The category is the TEMPLATE's: a checklist is one kind of work, and a
      // per-item category would let one import scatter tasks across the
      // category filter with no way to find them again as a set.
      category: template.category,
      priority: taskTemplateItemPriority(template, item),
      dueDate: templateDueDate(importedOn, item.offsetDays),
      offsetDays: item.offsetDays,
    })),
  };
}

// ----------------------------------------------------------------------------
// The write
// ----------------------------------------------------------------------------

export interface TemplateImportResult {
  templateKey: string;
  templateName: string;
  importedOn: string;
  created: Task[];
}

export interface ImportTaskTemplateInput {
  churchId: string;
  /** Who pressed Import. Creator, and the default assignee — see below. */
  userId: string;
  templateKey: string;
  /** Injectable clock. Production passes nothing. */
  importedAt?: Date;
}

/**
 * Create one template's tasks for one church.
 *
 * ONE STATEMENT. Every row is known before the write starts, so this is a
 * single multi-row `INSERT` — all of the checklist arrives or none of it does,
 * with no interactive transaction (`memory/invariants.md` → Transactions).
 *
 * ASSIGNED TO THE IMPORTER BY DEFAULT. Unassigned tasks reach no "My tasks"
 * view, which is exactly the hole #370 found under subtasks — twenty tasks
 * created and nobody accountable for any of them. A default, not a lock: every
 * row is reassignable afterwards like any other task.
 *
 * `created_at` is stamped one millisecond apart per row for the same reason
 * `planRecurrenceChildren` does it: one multi-row INSERT gives every default
 * the same transaction timestamp, which leaves any created-order listing to a
 * random-UUID tiebreak.
 */
export async function importTaskTemplate(
  input: ImportTaskTemplateInput
): Promise<TemplateImportResult> {
  const template = findTaskTemplate(input.templateKey);
  if (!template) {
    throw new Error(UNKNOWN_TEMPLATE_ERROR);
  }

  const plan = planTemplateImport(template, input.importedAt ?? new Date());
  const stampedAt = Date.now();

  const values: NewTask[] = plan.tasks.map((planned, index) => ({
    churchId: input.churchId,
    createdById: input.userId,
    assignedToId: input.userId,
    title: planned.title,
    // Through the same write gate as `createTask`/`updateTask` (T-021). The
    // catalog's strings are ours and are plain text today, so this converts
    // rather than sanitises — but "every write path goes through
    // `normalizeTaskDescription`" is the rule, and a description that reached
    // storage un-normalised would be the one row the readers' idempotency
    // argument does not cover.
    description: normalizeTaskDescription(planned.description),
    status: "not_started",
    priority: planned.priority,
    category: planned.category,
    dueDate: planned.dueDate,
    createdAt: new Date(stampedAt + index),
  }));

  const created = await db.insert(tasks).values(values).returning();

  // T-018. Every imported row carries an assignee (the importer) and a computed
  // due date, so every one of them owes a due and an overdue notification —
  // and these are precisely the tasks a planter did not type and is therefore
  // most likely to forget. Best-effort and sequential inside the helper, so it
  // can neither fail the import nor fan a whole checklist's worth of enqueue
  // chains at the database at once. `mustCancel: false`: these rows were
  // INSERTed a statement ago, so a cancel would be one round trip per imported
  // task against a task that cannot yet have a pending notification.
  await syncTaskNotificationsFor(
    input.churchId,
    created.map((task) => task.id),
    { mustCancel: false }
  );

  return {
    templateKey: plan.templateKey,
    templateName: plan.templateName,
    importedOn: plan.importedOn,
    created,
  };
}
