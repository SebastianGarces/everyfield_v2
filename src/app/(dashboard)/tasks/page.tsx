import { AlertCircle, ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TaskFilters, TaskList, TaskQuickAdd } from "@/components/tasks";
import { FollowUpAssignments } from "@/components/tasks/follow-up-assignments";
import { PhaseTemplatePrompt } from "@/components/tasks/phase-template-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth/session";
import { parseTaskListSearchParams } from "@/lib/tasks/list-params";
import { readTaskListPage } from "@/lib/tasks/list-page";
import { getTaskCounts } from "@/lib/tasks/service";
import { TEMPLATES_LINK_LABEL, TEMPLATES_ROUTE } from "@/lib/tasks/templates";
import { FOLLOW_UP_STALE_THRESHOLD_DAYS } from "@/lib/phase-engine/signals/build-fact-snapshot";
import {
  groupByOwner,
  listFollowUpAssignees,
  listFollowUpContacts,
  listOpenFollowUpTasks,
  selectUnownedContacts,
} from "@/lib/tasks/follow-up-ownership";

export const dynamic = "force-dynamic";

interface TasksPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // Parsed, never cast: a `?status=` a browser typed reaches `inArray` and then
  // the CHECK constraint on the column, and this route has no error boundary
  // (`src/lib/tasks/list-params.ts`).
  const params = await searchParams;
  const { view, showCompleted } = parseTaskListSearchParams(params);

  // ONE clock read for the page. Every relative due date under it — the group
  // headings and each card's "2 days overdue" — is measured against this
  // instant, so nothing recomputes it at hydration and disagrees with the
  // markup it is replacing (`memory/invariants.md` → Date & Time Rendering).
  const now = new Date();

  // Fetch tasks and counts in parallel. The page read is the SAME one "Load
  // more" performs (`src/lib/tasks/list-page.ts`), so the appended rows are
  // the continuation of this query and not a second reading of the URL.
  // The ownership reads run on EVERY view, not only the assignments one: the
  // banner is the thing that makes an unowned follow-up findable, and a banner
  // that appears only where the planter already went is not a banner (#470
  // AC-4). Three church-scoped indexed reads.
  const [result, counts, openFollowUps, followUpContacts, assignees] =
    await Promise.all([
      readTaskListPage(user.churchId, user.id, params),
      getTaskCounts(user.churchId, view === "my_tasks" ? user.id : undefined),
      listOpenFollowUpTasks(user.churchId),
      listFollowUpContacts(user.churchId),
      listFollowUpAssignees(user.churchId),
    ]);

  const ownerGroups = groupByOwner(openFollowUps);
  const uncovered = selectUnownedContacts(followUpContacts, openFollowUps).map(
    (contact) => {
      const idleDays = Math.floor(
        (now.getTime() - contact.lastTouchedAt.getTime()) / 86_400_000
      );
      return {
        personId: contact.personId,
        name: contact.name,
        status: contact.status,
        idleDays,
        isStale: idleDays >= FOLLOW_UP_STALE_THRESHOLD_DAYS,
      };
    }
  );
  // What the banner counts is what "Needs owner" holds: a follow-up whose task
  // nobody live owns, plus a contact with no task at all.
  const needsOwnerCount = ownerGroups[0].tasks.length + uncovered.length;

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
                <Link href={TEMPLATES_ROUTE}>
                  <ListChecks className="mr-2 h-4 w-4" />
                  {TEMPLATES_LINK_LABEL}
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

          {/*
            AC-4. Renders only when something is actually uncovered, and says
            only what is measured: how many follow-ups have no owner. It does
            NOT say who is carrying the rest — that claim is what #470 exists to
            delete (rubric v1, Lens 2).
          */}
          {needsOwnerCount > 0 && view !== "assignments" && (
            <Link
              href="/tasks?view=assignments#needs-owner"
              className="border-destructive/30 bg-destructive/5 hover:bg-destructive/10 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
            >
              <AlertCircle className="text-destructive h-4 w-4 shrink-0" />
              <span>
                <strong>
                  {needsOwnerCount === 1
                    ? "1 follow-up needs an owner"
                    : `${needsOwnerCount} follow-ups need an owner`}
                </strong>{" "}
                — give each one a committed member.
              </span>
            </Link>
          )}

          {/* Filters */}
          <TaskFilters currentView={view} showCompleted={showCompleted} />
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

          {view === "assignments" ? (
            <FollowUpAssignments
              groups={ownerGroups}
              uncovered={uncovered}
              assignees={assignees}
            />
          ) : (
            <TaskList
              tasks={result.tasks}
              total={result.total}
              nextCursor={result.nextCursor}
              personNotes={result.personNotes}
              searchParams={params}
              now={now}
            />
          )}
        </div>
      </div>
    </>
  );
}
