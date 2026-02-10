import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { TeamHealthDashboard } from "@/components/ministry-teams/team-health-dashboard";
import { verifySession } from "@/lib/auth/session";
import {
  getAllTeamsHealth,
  getStaffingSummary,
} from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

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
      <HeaderBreadcrumbs
        items={[
          { label: "Ministry Teams", href: "/teams" },
          { label: "Health Dashboard" },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Team Health Dashboard
            </h1>
            <p className="text-foreground/50">
              Monitor staffing, training, and engagement across all ministry
              teams
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <TeamHealthDashboard
            healthMetrics={healthMetrics}
            staffingSummary={staffingSummary}
          />
        </div>
      </div>
    </>
  );
}
