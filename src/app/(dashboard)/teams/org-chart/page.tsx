import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { OrgChartView } from "@/components/ministry-teams/org-chart-view";
import { verifySession } from "@/lib/auth/session";
import { listTeams } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

const BREADCRUMBS = [
  { label: "Ministry Teams", href: "/teams" },
  { label: "Org Chart" },
];

export default async function OrgChartPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const teams = await listTeams(user.churchId);

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
                Organization Chart
              </h1>
              <p className="text-muted-foreground">
                View the hierarchical structure of your ministry teams
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <OrgChartView teams={teams} />
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
