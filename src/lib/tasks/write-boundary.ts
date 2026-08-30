import { randomUUID } from "node:crypto";

import { inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { tasks, type NewTask, type Task } from "@/db/schema";

import { taskStructureLockStatement } from "./structure-lock";

export interface ExactTenantTaskInsertOptions {
  /** Fresh server-resolved authority for this write, never historical attribution. */
  authorityUserId: string;
  /** Meeting finalization is idempotent through its partial unique indexes. */
  onConflictDoNothing?: boolean;
  /** Test seam: production never supplies this. */
  beforeInsert?: () => Promise<void>;
}

export type ExactTenantTaskInsertResult =
  | { authorized: false; inserted: [] }
  | { authorized: true; inserted: Task[] };

type SerializedTaskInsert = {
  id: string;
  church_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  assigned_to_id: string | null;
  category: string | null;
  related_type: string | null;
  related_id: string | null;
  parent_task_id: string | null;
  is_recurring: boolean;
  recurrence_rule: unknown;
  completion_event: string | null;
  completed_at: string | null;
  completed_by_id: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function optionalInstant(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function defaultInstant(value: Date | undefined, fallback: Date): string {
  return (value ?? fallback).toISOString();
}

function serializeTaskInsert(value: NewTask, now: Date): SerializedTaskInsert {
  return {
    id: value.id ?? randomUUID(),
    church_id: value.churchId,
    title: value.title,
    description: value.description ?? null,
    status: value.status ?? "not_started",
    priority: value.priority ?? "medium",
    due_date: value.dueDate ?? null,
    due_time: value.dueTime ?? null,
    assigned_to_id: value.assignedToId ?? null,
    category: value.category ?? null,
    related_type: value.relatedType ?? null,
    related_id: value.relatedId ?? null,
    parent_task_id: value.parentTaskId ?? null,
    is_recurring: value.isRecurring ?? false,
    recurrence_rule: value.recurrenceRule ?? null,
    completion_event: value.completionEvent ?? null,
    completed_at: optionalInstant(value.completedAt),
    completed_by_id: value.completedById ?? null,
    created_by_id: value.createdById,
    created_at: defaultInstant(value.createdAt, now),
    updated_at: defaultInstant(value.updatedAt, now),
    deleted_at: optionalInstant(value.deletedAt),
  };
}

/**
 * Insert Task rows only while every user identity carried by the rows is an
 * exact plant account at the mutation boundary.
 *
 * Preflight reads still provide useful errors and authorize richer domain
 * rules. They are not concurrency guards. This statement repeats the global
 * one-tenancy invariant for the fresh authority and every creator, assignee,
 * and completer inside the same `INSERT ... SELECT`, and authorizes the entire
 * proposed set as one unit. A checklist/import therefore cannot land a partial
 * set when one user becomes malformed between planning and persistence.
 *
 * Authorization is separate from insertion cardinality. An authorized
 * idempotent insert may land no rows because another writer won the same
 * unique key; an unauthorized insert also lands no rows, but callers must
 * refuse it rather than mistake it for that benign conflict.
 */
export async function insertExactTenantTasks(
  values: readonly NewTask[],
  options: ExactTenantTaskInsertOptions
): Promise<ExactTenantTaskInsertResult> {
  if (values.length === 0) return { authorized: true, inserted: [] };

  const churchId = values[0]!.churchId;
  if (values.some((value) => value.churchId !== churchId)) {
    throw new Error("Task inserts must belong to one plant");
  }

  const now = new Date();
  const proposed = values.map((value) => serializeTaskInsert(value, now));
  await options.beforeInsert?.();

  const conflict = options.onConflictDoNothing
    ? sql`on conflict do nothing`
    : sql``;
  const [, outcome] = await db.batch([
    taskStructureLockStatement(churchId),
    db.execute<{ authorized: boolean; id: string | null }>(sql`
      with proposed as materialized (
        select *
        from jsonb_to_recordset(${JSON.stringify(proposed)}::jsonb) as p(
          id uuid,
          church_id uuid,
          title text,
          description text,
          status varchar(20),
          priority varchar(10),
          due_date date,
          due_time time,
          assigned_to_id uuid,
          category varchar(30),
          related_type varchar(20),
          related_id uuid,
          parent_task_id uuid,
          is_recurring boolean,
          recurrence_rule jsonb,
          completion_event varchar(100),
          completed_at timestamp,
          completed_by_id uuid,
          created_by_id uuid,
          created_at timestamp,
          updated_at timestamp,
          deleted_at timestamp
        )
      ), authorized as materialized (
        select exists (
          select 1
          from users authority
          where authority.id = ${options.authorityUserId}::uuid
            and authority.church_id = ${churchId}::uuid
            and authority.sending_church_id is null
            and authority.sending_network_id is null
        ) and not exists (
          select 1
          from proposed p
          where (
            not exists (
              select 1
              from users creator
              where creator.id = p.created_by_id
                and creator.church_id = p.church_id
                and creator.sending_church_id is null
                and creator.sending_network_id is null
            )
          )
          or (
            p.assigned_to_id is not null
            and not exists (
              select 1
              from users assignee
              where assignee.id = p.assigned_to_id
                and assignee.church_id = p.church_id
                and assignee.sending_church_id is null
                and assignee.sending_network_id is null
            )
          )
          or (
            p.completed_by_id is not null
            and not exists (
              select 1
              from users completer
              where completer.id = p.completed_by_id
                and completer.church_id = p.church_id
                and completer.sending_church_id is null
                and completer.sending_network_id is null
            )
          )
        ) as allowed
      ), landed as (
        insert into tasks (
          id, church_id, title, description, status, priority, due_date,
          due_time, assigned_to_id, category, related_type, related_id,
          parent_task_id, is_recurring, recurrence_rule, completion_event,
          completed_at, completed_by_id, created_by_id, created_at, updated_at,
          deleted_at
        )
        select
          p.id, p.church_id, p.title, p.description, p.status, p.priority,
          p.due_date, p.due_time, p.assigned_to_id, p.category,
          p.related_type, p.related_id, p.parent_task_id, p.is_recurring,
          p.recurrence_rule, p.completion_event, p.completed_at,
          p.completed_by_id, p.created_by_id, p.created_at, p.updated_at,
          p.deleted_at
        from proposed p
        cross join authorized a
        where a.allowed
        ${conflict}
        returning id
      )
      select a.allowed as authorized, landed.id
      from authorized a
      left join landed on true
    `),
  ]);

  const authorized = outcome.rows[0]?.authorized === true;
  if (!authorized) return { authorized: false, inserted: [] };

  const landed = new Set(
    outcome.rows.map(({ id }) => id).filter((id): id is string => id !== null)
  );
  if (landed.size === 0) return { authorized: true, inserted: [] };

  const rows = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.id, [...landed]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const inserted = proposed
    .filter(({ id }) => landed.has(id))
    .map(({ id }) => byId.get(id))
    .filter((row): row is Task => row !== undefined);
  return { authorized: true, inserted };
}
