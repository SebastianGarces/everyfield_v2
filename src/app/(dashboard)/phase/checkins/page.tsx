import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { isPlantOwner } from "@/lib/auth/tenancy";
import { listCheckinHistory } from "@/lib/phase-engine/planter-checkin-db";
import { PlanterCheckinCard } from "@/components/phase-engine/planter-checkin-card";
import { CHECKIN_DIMENSIONS } from "@/lib/phase-engine/planter-checkin";

export default async function CheckinHistoryPage() {
  const { user } = await verifySession();
  if (!isPlantOwner(user) || !user.churchId) redirect("/dashboard");
  const rows = await listCheckinHistory(user.churchId);
  return (
    <PageCanvas scrollLayout="flow">
      <WorkspacePanel>
        <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
          <Link href="/phase" className="text-primary cursor-pointer underline">
            Back to Plant Intelligence
          </Link>
          <h1 className="text-2xl font-semibold">
            Your personal check-in history
          </h1>
          <p className="text-muted-foreground">
            Only the planter can view or correct these answers. They are never
            shared with coaches, organisations or the assessment. Previous
            answers are preserved; deletion is unavailable.
          </p>
          {rows.length === 0 && <p>No check-ins yet.</p>}
          {rows.map((row) => (
            <section key={row.id} className="space-y-3">
              <PlanterCheckinCard
                historyId={row.id}
                weekLabel={row.weekStart.slice(0, 10)}
                thisWeek={row}
                weeks={[]}
                nudges={[]}
              />
              {row.editHistory.length > 0 && (
                <details className="rounded-md border p-4">
                  <summary className="cursor-pointer">
                    Edit history ({row.editHistory.length})
                  </summary>
                  <ol className="mt-3 space-y-3">
                    {row.editHistory.map((revision, index) => (
                      <li key={index} className="border-t pt-3 text-sm">
                        <p>Previous answer recorded {revision.recordedAt}</p>
                        {CHECKIN_DIMENSIONS.map((d) => (
                          <p key={d.key}>
                            {d.label}: {revision[d.key]}
                          </p>
                        ))}
                        {revision.note && (
                          <p className="whitespace-pre-wrap">{revision.note}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </section>
          ))}
        </div>
      </WorkspacePanel>
    </PageCanvas>
  );
}
