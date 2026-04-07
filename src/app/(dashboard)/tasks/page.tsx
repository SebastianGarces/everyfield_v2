import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TaskFilters, TaskList, TaskQuickAdd } from "@/components/tasks";
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
              <p className="text-foreground/50">
                Manage your tasks and follow-ups
              </p>
            </div>
            <div className="flex items-center gap-2">
              <TaskQuickAdd />
              <Button asChild className="cursor-pointer">
                <Link href="/tasks/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Task
                </Link>
              </Button>
            </div>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-2">
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

          {/* Filters */}
          <TaskFilters
            currentView={view as "all" | "my_tasks"}
            showCompleted={showCompleted}
          />
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-auto p-6">
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
