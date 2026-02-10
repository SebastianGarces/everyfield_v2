"use client";

import { Activity, Network, UsersRound } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  TeamWithStats,
  StaffingSummary,
} from "@/lib/ministry-teams/service";
import { TeamCard } from "./team-card";
import { CreateTeamDialog } from "./create-team-dialog";
import { InitializeTeamsButton } from "./initialize-teams-button";

interface TeamsDashboardProps {
  teams: TeamWithStats[];
  staffingSummary: StaffingSummary;
}

export function TeamsDashboard({
  teams,
  staffingSummary,
}: TeamsDashboardProps) {
  if (teams.length === 0) {
    return (
      <div className="animate-in fade-in-50 flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
          <UsersRound className="text-muted-foreground h-10 w-10" />
        </div>
        <h3 className="mt-4 text-lg font-medium">No ministry teams yet</h3>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm">
          Set up the 10 core ministry teams to start organizing your launch
          team. You can also create custom teams.
        </p>
        <div className="mt-6 flex gap-3">
          <InitializeTeamsButton />
          <CreateTeamDialog />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Staffing summary banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="px-3 py-1 text-sm">
            {staffingSummary.totalTeams} Teams
          </Badge>
          <span className="text-muted-foreground text-sm">
            {staffingSummary.filledRoles} of {staffingSummary.totalRoles} roles
            filled across all teams ({staffingSummary.staffingPercentage}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild className="cursor-pointer">
            <Link href="/teams/org-chart">
              <Network className="mr-2 h-4 w-4" />
              Org Chart
            </Link>
          </Button>
          <Button variant="outline" asChild className="cursor-pointer">
            <Link href="/teams/health">
              <Activity className="mr-2 h-4 w-4" />
              Health Dashboard
            </Link>
          </Button>
          <CreateTeamDialog />
        </div>
      </div>

      {/* Team cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}
      </div>
    </div>
  );
}
