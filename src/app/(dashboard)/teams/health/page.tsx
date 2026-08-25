import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TeamHealthDashboard } from "@/components/ministry-teams/team-health-dashboard";
import { verifySession } from "@/lib/auth/session";
import {
  getAllTeamsHealth,
  getStaffingSummary,
} from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

const BREADCRUMBS = [
  { label: "Ministry Teams", href: "/teams" },
  { label: "Health Dashboard" },
];

export default async function TeamHealthPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const [healthMetrics, staffingSummary] = await Promise.all([
    getAllTeamsHealth(user.churchId),
    getStaffingSummary(user.churchId),
  ]);

  return (
    <>
      <HeaderBreadcrumbs items={BREADCRUMBS} />
      <PageCanvas
        className="overflow-hidden"
        contextAttachment="attached"
        contextItems={BREADCRUMBS}
        scrollLayout="fixed"
      >
        <WorkspacePanel className="flex h-full flex-col overflow-hidden">
          <div className="space-y-6 border-b p-4 sm:p-6 sm:pb-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Team Health Dashboard
              </h1>
              <p className="text-muted-foreground">
                Monitor staffing, training, and engagement across all ministry
                teams
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <TeamHealthDashboard
              healthMetrics={healthMetrics}
              staffingSummary={staffingSummary}
            />
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
