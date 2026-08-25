import { AlertCircle, ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TaskFilters, TaskList, TaskQuickAdd } from "@/components/tasks";
import { FollowUpAssignments } from "@/components/tasks/follow-up-assignments";
import { PhaseTemplatePrompt } from "@/components/tasks/phase-template-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import {
  parseTaskListSearchParams,
  type TaskListView,
} from "@/lib/tasks/list-params";
import { readTaskListPage, taskListScope } from "@/lib/tasks/list-page";
import { taskListSubtitle } from "@/lib/tasks/presentation";
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

/**
 * The one hand-written view link in the app, typed so it cannot drift from the
 * contract the toggle and the parser share (#660).
 */
const ASSIGNMENTS_VIEW: TaskListView = "assignments";

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
  const parsed = parseTaskListSearchParams(params);
  const { view, showCompleted } = parsed;

  // AS-020: creating a task and importing a checklist are `tasks.write`, so a
  // Member is not OFFERED either — the server refuses both anyway. Asked here
  // rather than in the client, because this component already holds the session
  // (`@/components/shared/viewer-capabilities` — two transports, one table).
  const canWrite = holdsSeatFor(user, "tasks.write");

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
      // THE SAME READING OF THE URL THE LIST GETS (#613). The badges describe
      // the rows under them, so they take the list's own filters — anything
      // that narrows the list narrows the numbers with it. Passing less is how
      // `?category=follow_up` came to render "1 active" over "No tasks found".
      getTaskCounts(user.churchId, taskListScope(user.id, parsed)),
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
  const breadcrumbs = [{ label: "Tasks" }];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="flow"
      >
        <WorkspacePanel className="flex min-h-full flex-col overflow-hidden">
          {/* Header */}
          <div className="space-y-4 border-b p-4 sm:p-6 sm:pb-4">
            {/*
            The title and the two actions sit on one line once there is room
            for them. Below `sm` they stack instead of competing: side by side
            at that width the heading wraps mid-phrase and the buttons crush.
          */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
                {/* Capability-matched header (#668). See @/lib/tasks/presentation. */}
                <p className="text-muted-foreground text-pretty">
                  {taskListSubtitle(canWrite)}
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
                {canWrite && (
                  <Button asChild variant="outline" className="cursor-pointer">
                    <Link href={TEMPLATES_ROUTE}>
                      <ListChecks className="mr-2 h-4 w-4" />
                      {TEMPLATES_LINK_LABEL}
                    </Link>
                  </Button>
                )}
                {canWrite && (
                  <Button asChild className="cursor-pointer">
                    <Link href="/tasks/new">
                      <Plus className="mr-2 h-4 w-4" />
                      New Task
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            {/*
            Summary badges.

            These count TASKS only — `getTaskCounts` excludes subtasks, so the
            badges and the "Showing N of M" footer under the list describe the
            same population. They are read under the SAME filters as the list
            (#613), so a badge can never claim a task the filter took off the
            screen. The one number that outlives the current view is "N
            completed": it counts what "Show Completed" would reveal, which is
            the only way that toggle can say whether it has anything to show.
            Checklist progress is real work, so it is still reported, but on its
            own quiet line where two adjacent numbers cannot be misread as one.
          */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {counts.overdue > 0 && (
                  <Badge variant="destructive" className="text-xs tabular-nums">
                    {counts.overdue} overdue
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs tabular-nums">
                  {counts.notStarted + counts.inProgress + counts.blocked}{" "}
                  active
                </Badge>
                {counts.blocked > 0 && (
                  <Badge
                    variant="outline"
                    className="text-destructive text-xs tabular-nums"
                  >
                    {counts.blocked} blocked
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs tabular-nums">
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
                href={`/tasks?view=${ASSIGNMENTS_VIEW}#needs-owner`}
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
          <div className="min-w-0 space-y-6 p-4 sm:p-6">
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
                currentUserId={user.id}
              />
            )}
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
