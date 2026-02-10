import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { OrgChartView } from "@/components/ministry-teams/org-chart-view";
import { verifySession } from "@/lib/auth/session";
import { listTeams } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const teams = await listTeams(user.churchId);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Ministry Teams", href: "/teams" },
          { label: "Org Chart" },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Organization Chart
            </h1>
            <p className="text-foreground/50">
              View the hierarchical structure of your ministry teams
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <OrgChartView teams={teams} />
        </div>
      </div>
    </>
  );
}
