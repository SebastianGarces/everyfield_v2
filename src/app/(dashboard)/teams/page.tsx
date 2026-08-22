import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TeamsDashboard } from "@/components/ministry-teams/teams-dashboard";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { teamsListSubtitle } from "@/lib/ministry-teams/presentation";
import { getStaffingSummary, listTeams } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // AS-020: this page renders no control of its own — `TeamsDashboard` asks
  // `useCan("teams.write")` for those — but the HEADER is a write affordance in
  // sentence form (#668). See @/lib/ministry-teams/presentation.
  const canWrite = holdsSeatFor(user, "teams.write");

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
              <p className="text-muted-foreground">
                {teamsListSubtitle(canWrite)}
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
