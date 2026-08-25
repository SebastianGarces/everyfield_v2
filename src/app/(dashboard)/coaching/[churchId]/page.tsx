import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifySession } from "@/lib/auth";
import { readCoachedPlant } from "@/lib/coaching/read";
import { formatDate } from "@/lib/datetime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Coaching" };

// Every row here is a live record of somebody else's plant; nothing may be
// cached across requests.
export const dynamic = "force-dynamic";

/**
 * AN ASSIGNED PLANT, AS ITS COACH SEES IT (AS-008 / AS-011, #496).
 *
 * THE ONLY DASHBOARD ROUTE THAT NAMES A CHURCH IN ITS PATH, and it has to be:
 * every other page under `(dashboard)` resolves its plant from
 * `user.church_id`, which is exactly what a coach does not have. The id in the
 * URL is not authority — `readCoachedPlant` answers `null` for any plant this
 * account does not actively coach, and this page renders `notFound()` for that
 * null, so a coach walking church ids learns nothing a stranger would not.
 *
 * READ ONLY, AND THERE IS NOTHING TO DISABLE. This page renders no control that
 * writes: no "Add person", no status menu, no assign. That is not restraint at
 * the view layer, it is the only thing the view layer CAN do — a coach holds no
 * `church_id`, so every write verb in `@/lib/auth/seat-rules` refuses them for
 * want of a plant tenancy. The absence of buttons is the honest rendering of a
 * refusal that already exists rather than a second copy of the rule.
 *
 * NOT AN OVERSIGHT SCREEN. `/oversight/plants/[id]` shows the same plant as
 * counts, gated by `share_*`. This shows its people by name, gated by the
 * assignment. An account holding both reaches sees both, each in its own scope.
 */
export default async function CoachedPlantPage({
  params,
}: {
  params: Promise<{ churchId: string }>;
}) {
  const { churchId } = await params;
  const { user } = await verifySession();

  const plant = await readCoachedPlant(user, churchId);
  if (!plant) notFound();

  return (
    <>
      <HeaderBreadcrumbs
        items={[{ label: "Coaching" }, { label: plant.churchName }]}
      />

      <PageCanvas>
        <WorkspacePanel className="mx-auto min-h-full max-w-6xl space-y-6 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {plant.churchName}
            </h1>
            <Badge variant="secondary">Phase {plant.currentPhase}</Badge>
            <Badge variant="outline">You coach this plant</Badge>
          </div>

          <p className="text-muted-foreground max-w-prose text-sm">
            You are reading {plant.churchName}&apos;s own records. Coaching is
            read-only — nothing here can be changed from your account.
          </p>

          <Card>
            <CardHeader>
              <CardTitle>People</CardTitle>
              <CardDescription>
                {plant.peopleTotal === 0
                  ? "This plant has not added anyone yet."
                  : `${plant.peopleTotal} in the directory. Showing the most recent ${plant.people.length}.`}
              </CardDescription>
            </CardHeader>
            {plant.people.length > 0 && (
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plant.people.map((person) => (
                      <tr key={person.id} className="border-border/60 border-t">
                        <td className="py-2">
                          {person.firstName} {person.lastName}
                        </td>
                        <td className="text-muted-foreground py-2">
                          {person.status}
                        </td>
                        <td className="text-muted-foreground py-2">
                          {formatDate(person.createdAt, "short")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
              <CardDescription>
                {plant.tasks.length === 0
                  ? "This plant has no tasks yet."
                  : `The plant's ${plant.tasks.length} nearest tasks by due date.`}
              </CardDescription>
            </CardHeader>
            {plant.tasks.length > 0 && (
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="pb-2 font-medium">Task</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plant.tasks.map((task) => (
                      <tr key={task.id} className="border-border/60 border-t">
                        <td className="py-2">{task.title}</td>
                        <td className="text-muted-foreground py-2">
                          {task.status}
                        </td>
                        <td className="text-muted-foreground py-2">
                          {task.dueDate
                            ? formatDate(new Date(task.dueDate), "short")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
