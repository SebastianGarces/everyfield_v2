import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TaskForm } from "@/components/tasks";
import { users } from "@/db/schema";
import { db } from "@/db";
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

  return (
    <>
      <HeaderBreadcrumbs
        items={[{ label: "Tasks", href: "/tasks" }, { label: "New Task" }]}
      />
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">
          Create New Task
        </h1>
        <TaskForm
          users={churchUsers}
          followUpAssignees={followUpAssignees}
          prerequisiteCandidates={prerequisiteCandidates}
        />
      </div>
    </>
  );
}
