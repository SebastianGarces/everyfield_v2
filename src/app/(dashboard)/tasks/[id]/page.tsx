import { notFound, redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TaskForm } from "@/components/tasks";
import { SubtaskList } from "@/components/tasks/subtask-list";
import { RichText } from "@/components/shared/rich-text";
import { TaskDetailActions } from "./task-detail-actions";
import { db } from "@/db";
import { users } from "@/db/schema";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import {
  formatDate,
  formatDateTime,
  formatDateWithoutWeekday,
} from "@/lib/datetime";
import { getTask, listSubtasks } from "@/lib/tasks/service";
import { listFollowUpAssignees } from "@/lib/tasks/follow-up-ownership";
import {
  listPrerequisiteCandidates,
  listTaskPrerequisites,
} from "@/lib/tasks/dependencies";
import { eq } from "drizzle-orm";
import {
  Calendar,
  CircleDot,
  Clock,
  ExternalLink,
  Flag,
  User,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ============================================================================
// Config
// ============================================================================

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700" },
  blocked: { label: "Blocked", color: "bg-red-100 text-red-700" },
  complete: { label: "Complete", color: "bg-green-100 text-green-700" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600" },
  medium: { label: "Medium", color: "bg-blue-100 text-blue-600" },
  high: { label: "High", color: "bg-orange-100 text-orange-600" },
  urgent: { label: "Urgent", color: "bg-red-100 text-red-600" },
};

const CATEGORY_LABELS: Record<string, string> = {
  vision_meeting: "Vision Meeting",
  follow_up: "Follow-up",
  training: "Training",
  facilities: "Facilities",
  promotion: "Promotion",
  administrative: "Administrative",
  ministry_team: "Ministry Team",
  launch_prep: "Launch Prep",
  recurring: "Recurring",
  general: "General",
};

function getRelatedUrl(
  relatedType: string | null,
  relatedId: string | null
): string | null {
  if (!relatedType || !relatedId) return null;

  switch (relatedType) {
    case "person":
      return `/people/${relatedId}`;
    case "meeting":
      return `/meetings/${relatedId}/evaluation`;
    case "team":
      return `/teams/${relatedId}`;
    default:
      return null;
  }
}

function getRelatedLabel(relatedType: string | null): string {
  switch (relatedType) {
    case "person":
      return "Related Person";
    case "meeting":
      return "Related Meeting";
    case "team":
      return "Related Team";
    case "facility":
      return "Related Facility";
    default:
      return "Related";
  }
}

// ============================================================================
// Page
// ============================================================================

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const task = await getTask(user.churchId, id);

  if (!task) {
    notFound();
  }

  // Fetch church users for editing, plus this task's checklist (T-016).
  const [
    churchUsers,
    followUpAssignees,
    subtasks,
    prerequisites,
    prerequisiteCandidates,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(eq(users.churchId, user.churchId)),
    // #470 D2 — the Follow-up category may only be owned by a committed
    // member, so the select is fed the eligible set rather than filtering the
    // full one in the browser.
    listFollowUpAssignees(user.churchId),
    listSubtasks(user.churchId, id),
    listTaskPrerequisites(user.churchId, id),
    listPrerequisiteCandidates(user.churchId, id),
  ]);

  // AS-020. Editing a task is `tasks.write`, so the edit form is not OFFERED to
  // a Member — the page itself stays readable, which is what they came for. The
  // controls that are `tasks.own` (complete, reopen, the checklist) ask their
  // own question further down, against the row's assignee.
  const canWrite = holdsSeatFor(user, "tasks.write");

  const statusConfig = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.not_started;
  const priorityConfig =
    PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
  const relatedUrl = getRelatedUrl(task.relatedType, task.relatedId);
  const isBlocked = prerequisites.some(
    (prerequisite) => prerequisite.status !== "complete"
  );
  const candidateById = new Map(
    prerequisiteCandidates.map((candidate) => [candidate.id, candidate])
  );
  for (const prerequisite of prerequisites) {
    candidateById.set(prerequisite.id, prerequisite);
  }

  // Dates, pinned to APP_TIME_ZONE (`memory/invariants.md` → Date & Time
  // Rendering). All three were `toLocaleDateString` with no `timeZone`, which
  // follows the runtime's: the server rendered one day and the browser could
  // hydrate another (React #418), and a due date — a calendar day, parsed here
  // as naive local midnight — rolled a day for any reader east or west of the
  // server. `formatDate`/`formatDateTime` carry the same wording.
  const createdDate = formatDateWithoutWeekday(task.createdAt, "short");

  const dueDateFormatted = task.dueDate
    ? formatDate(new Date(`${task.dueDate}T00:00:00Z`), "short")
    : null;

  const completedDate = task.completedAt
    ? formatDateTime(task.completedAt, "short")
    : null;
  const breadcrumbs = [
    { label: "Tasks", href: "/tasks" },
    { label: task.title },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        contextAttachment="attached"
        contextItems={breadcrumbs}
        frameClassName="mx-auto w-full max-w-4xl"
      >
        <WorkspacePanel className="mb-3 min-h-full p-4 sm:mb-4 sm:p-6">
          {/* The task sections need one parent to share a rounded workspace
              boundary; CSS cannot establish that relationship across the old
              siblings. Reads, actions, forms, and permission gates stay in
              their original owners. */}
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Header with actions */}
            <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-1">
                <h1
                  className={cn(
                    "text-2xl font-bold tracking-tight [overflow-wrap:anywhere] break-words",
                    task.status === "complete" && "line-through opacity-60"
                  )}
                >
                  {task.title}
                </h1>
                <p className="text-muted-foreground text-sm">
                  Created {createdDate}
                </p>
              </div>
              <TaskDetailActions task={task} currentUserId={user.id} />
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("text-xs", statusConfig.color)}>
                {statusConfig.label}
              </Badge>
              <Badge className={cn("text-xs", priorityConfig.color)}>
                <Flag className="mr-1 h-3 w-3" />
                {priorityConfig.label}
              </Badge>
              {task.category && (
                <Badge variant="outline" className="text-xs">
                  <CircleDot className="mr-1 h-3 w-3" />
                  {CATEGORY_LABELS[task.category] ?? task.category}
                </Badge>
              )}
              {isBlocked && (
                <Badge className="bg-red-100 text-xs text-red-700">
                  Blocked
                </Badge>
              )}
            </div>

            {/* Detail cards */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Due date */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Calendar className="h-4 w-4" />
                    Due Date
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dueDateFormatted ? (
                    <p className="text-sm">{dueDateFormatted}</p>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No due date set
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Assignee */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4" />
                    Assigned To
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {task.assigneeName ? (
                    <p className="text-sm">{task.assigneeName}</p>
                  ) : (
                    <p className="text-muted-foreground text-sm">Unassigned</p>
                  )}
                </CardContent>
              </Card>

              {/* Related entity */}
              {task.relatedType && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <ExternalLink className="h-4 w-4" />
                      {getRelatedLabel(task.relatedType)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {relatedUrl ? (
                      <Link
                        href={relatedUrl}
                        className="cursor-pointer text-sm text-blue-600 hover:underline"
                      >
                        View {task.relatedType} →
                      </Link>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        Linked {task.relatedType}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Completion info */}
              {task.status === "complete" && completedDate && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <Clock className="h-4 w-4" />
                      Completed
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{completedDate}</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Description */}
            {task.description && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Description
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/*
                Rendered as rich text, not printed as markup (T-021), by the
                SAME reader the sent-message detail page mounts. This block was
                a hand-rolled second copy of it — its own
                `dangerouslySetInnerHTML` and its own prose classes, already
                drifted from the message page's in spacing and link colour
                before either shipped.
              */}
                  <RichText body={task.description} />
                </CardContent>
              </Card>
            )}

            {/* Subtasks */}
            <Card>
              <CardContent>
                <SubtaskList
                  parentTaskId={task.id}
                  subtasks={subtasks}
                  parentIsSubtask={task.parentTaskId !== null}
                  currentUserId={user.id}
                  parentAssignedToId={task.assignedToId}
                />
              </CardContent>
            </Card>

            {/* Edit form */}
            {canWrite && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">
                    Edit Task
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TaskForm
                    task={task}
                    users={churchUsers}
                    followUpAssignees={followUpAssignees}
                    prerequisiteCandidates={[...candidateById.values()]}
                    prerequisiteIds={prerequisites.map(
                      (prerequisite) => prerequisite.id
                    )}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
