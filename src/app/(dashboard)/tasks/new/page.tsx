import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TaskForm } from "@/components/tasks";
import { users } from "@/db/schema";
import { db } from "@/db";
import { verifySession } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // Fetch church users for the assignee selector
  const churchUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.churchId, user.churchId));

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Tasks", href: "/tasks" },
          { label: "New Task" },
        ]}
      />
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">
          Create New Task
        </h1>
        <TaskForm users={churchUsers} />
      </div>
    </>
  );
}
