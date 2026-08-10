import { ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TaskFilters, TaskList, TaskQuickAdd } from "@/components/tasks";
import { PhaseTemplatePrompt } from "@/components/tasks/phase-template-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TaskCategory, TaskPriority, TaskStatus } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { getLatestPersonNote } from "@/lib/people/service";
import { getTaskCounts, listTasks } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

interface TasksPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  // Parse view mode
  const view = params.view === "all" ? "all" : "my_tasks";
  const showCompleted = params.completed === "true";

  // Parse filters
  const statusParam = params.status;
  const status = statusParam
    ? ([statusParam].flat() as TaskStatus[])
    : undefined;

  const priorityParam = params.priority;
  const priority = priorityParam
    ? ([priorityParam].flat() as TaskPriority[])
    : undefined;

  const categoryParam = params.category;
  const category = categoryParam
    ? ([categoryParam].flat() as TaskCategory[])
    : undefined;

  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;

  // Fetch tasks and counts in parallel
  const [result, counts] = await Promise.all([
    listTasks(user.churchId, {
      cursor,
      status,
      priority,
      category,
      assignedToId: view === "my_tasks" ? user.id : undefined,
      includeCompleted: showCompleted,
      sortBy: "due_date",
      sortDir: "asc",
      limit: 50,
    }),
    getTaskCounts(user.churchId, view === "my_tasks" ? user.id : undefined),
  ]);

  // Pre-fetch person notes for person-related tasks
  const personRelatedTasks = result.tasks.filter(
    (t) => t.relatedType === "person" && t.relatedId
  );
  const uniquePersonIds = [
    ...new Set(personRelatedTasks.map((t) => t.relatedId!)),
  ];

  const personNotes: Record<string, string> = {};
  if (uniquePersonIds.length > 0) {
    const noteResults = await Promise.all(
      uniquePersonIds.map(async (personId) => {
        const note = await getLatestPersonNote(personId);
        return { personId, note: note?.note ?? null };
      })
    );
    for (const { personId, note } of noteResults) {
      if (note) personNotes[personId] = note;
    }
  }

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Tasks" }]} />
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="bg-card space-y-4 p-6 pb-4 shadow-sm">
          {/*
            The title and the two actions sit on one line once there is room
            for them. Below `sm` they stack instead of competing: side by side
            at that width the heading wraps mid-phrase and the buttons crush.
          */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
              <p className="text-muted-foreground text-pretty">
                Manage your tasks and follow-ups
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <TaskQuickAdd />
              {/*
                T-011/T-012. The catalog's standing entrance. The phase prompt
                below offers one stage's checklists at the moment the stage
                changes and is then gone, so without this link a planter who
                declined it — or who wants an earlier stage's list — has no way
                back to the catalog at all.
              */}
              <Button asChild variant="outline" className="cursor-pointer">
                <Link href="/tasks/templates">
                  <ListChecks className="mr-2 h-4 w-4" />
                  Checklist templates
                </Link>
              </Button>
              <Button asChild className="cursor-pointer">
                <Link href="/tasks/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Task
                </Link>
              </Button>
            </div>
          </div>

          {/*
            Summary badges.

            These count TASKS only — `getTaskCounts` excludes subtasks, so the
            badges and the "Showing N of M" footer under the list describe the
            same population. Checklist progress is real work, so it is still
            reported, but on its own quiet line where two adjacent numbers
            cannot be misread as one.
          */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {counts.overdue > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {counts.overdue} overdue
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {counts.notStarted + counts.inProgress + counts.blocked} active
              </Badge>
              {counts.blocked > 0 && (
                <Badge variant="outline" className="text-xs text-red-600">
                  {counts.blocked} blocked
                </Badge>
              )}
              <Badge variant="outline" className="text-xs text-green-600">
                {counts.complete} completed
              </Badge>
            </div>

            {counts.checklistTotal > 0 && (
              <p
                className="text-muted-foreground text-xs"
                data-testid="checklist-summary"
              >
                Checklists: {counts.checklistComplete} of{" "}
                {counts.checklistTotal}{" "}
                {counts.checklistTotal === 1 ? "item" : "items"} done
              </p>
            )}
          </div>

          {/* Filters */}
          <TaskFilters
            currentView={view as "all" | "my_tasks"}
            showCompleted={showCompleted}
          />
        </div>

        {/* Task list */}
        <div className="flex-1 space-y-6 overflow-auto p-6">
          {/*
            T-020. Renders nothing unless the plant has just changed stage and
            the prompt has not been answered, so it costs an unprompted planter
            one query and no pixels. It sits ABOVE the list because accepting
            it changes that list.
          */}
          <PhaseTemplatePrompt />

          <TaskList
            tasks={result.tasks}
            total={result.total}
            nextCursor={result.nextCursor}
            personNotes={personNotes}
          />
        </div>
      </div>
    </>
  );
}
