import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TeamsDashboard } from "@/components/ministry-teams/teams-dashboard";
import { verifySession } from "@/lib/auth/session";
import { getStaffingSummary, listTeams } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const [teams, staffingSummary] = await Promise.all([
    listTeams(user.churchId),
    getStaffingSummary(user.churchId),
  ]);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Ministry Teams" }]} />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Ministry Teams
              </h1>
              <p className="text-foreground/50">
                Organize, staff, and track your ministry teams
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <TeamsDashboard teams={teams} staffingSummary={staffingSummary} />
        </div>
      </div>
    </>
  );
}
