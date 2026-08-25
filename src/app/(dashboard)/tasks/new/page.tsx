import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TaskForm } from "@/components/tasks";
import { users } from "@/db/schema";
import { db } from "@/db";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { listPrerequisiteCandidates } from "@/lib/tasks/dependencies";
import { listFollowUpAssignees } from "@/lib/tasks/follow-up-ownership";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // THE ROUTE EXISTS ONLY TO WRITE (AS-020, recipe rule 3). Hiding the "New
  // Task" button while leaving /tasks/new reachable by URL is a screen a Member
  // walks into, fills in and is refused at submit — so the door is shut where
  // the button was hidden, on the same verb `createTaskAction` refuses with.
  if (!holdsSeatFor(user, "tasks.write")) {
    redirect("/tasks");
  }

  // Fetch church users for the assignee selector, plus the subset of them a
  // FOLLOW-UP may be assigned to — committed members only (#470 D2).
  const [churchUsers, followUpAssignees, prerequisiteCandidates] =
    await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(eq(users.churchId, user.churchId)),
      listFollowUpAssignees(user.churchId),
      listPrerequisiteCandidates(user.churchId),
    ]);
  const breadcrumbs = [
    { label: "Tasks", href: "/tasks" },
    { label: "New Task" },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        contextAttachment="attached"
        contextItems={breadcrumbs}
        frameClassName="mx-auto w-full max-w-2xl"
        scrollLayout="flow"
      >
        <WorkspacePanel className="p-4 sm:p-6">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">
            Create New Task
          </h1>
          <TaskForm
            users={churchUsers}
            followUpAssignees={followUpAssignees}
            prerequisiteCandidates={prerequisiteCandidates}
          />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
