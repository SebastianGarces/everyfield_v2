import { notFound, redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TaskForm } from "@/components/tasks";
import { TaskDetailActions } from "./task-detail-actions";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { getTask } from "@/lib/tasks/service";
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

  // Fetch church users for editing
  const churchUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.churchId, user.churchId));

  const statusConfig = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.not_started;
  const priorityConfig =
    PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
  const relatedUrl = getRelatedUrl(task.relatedType, task.relatedId);

  // Format dates
  const createdDate = new Date(task.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const dueDateFormatted = task.dueDate
    ? new Date(task.dueDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const completedDate = task.completedAt
    ? new Date(task.completedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <HeaderBreadcrumbs
        items={[{ label: "Tasks", href: "/tasks" }, { label: task.title }]}
      />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {/* Header with actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1
              className={cn(
                "text-2xl font-bold tracking-tight",
                task.status === "complete" && "line-through opacity-60"
              )}
            >
              {task.title}
            </h1>
            <p className="text-muted-foreground text-sm">
              Created {createdDate}
            </p>
          </div>
          <TaskDetailActions task={task} />
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
                <p className="text-muted-foreground text-sm">No due date set</p>
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
                    View {task.relatedType} &rarr;
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
              <CardTitle className="text-sm font-medium">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Edit form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Edit Task</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskForm task={task} users={churchUsers} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
