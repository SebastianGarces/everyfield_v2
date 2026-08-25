"use client";

import { Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { TEAM_ICONS, staffingPercent } from "@/lib/ministry-teams/team-display";
import type { TeamDetail } from "@/lib/ministry-teams/service";

interface TeamDetailHeaderProps {
  team: TeamDetail;
}

export function TeamDetailHeader({ team }: TeamDetailHeaderProps) {
  const Icon = TEAM_ICONS[team.icon ?? ""] ?? Users;
  const staffing = staffingPercent(team.filledRoles, team.totalRoles);

  return (
    <div className="border-b p-4 sm:p-6">
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            team.type === "custom"
              ? "bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400"
              : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
            <Badge
              variant="secondary"
              className={cn(
                "capitalize",
                team.status === "active" &&
                  "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
                team.status === "forming" &&
                  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
              )}
            >
              {team.status}
            </Badge>
          </div>
          {team.description && (
            <p className="text-muted-foreground mt-1 text-sm">
              {team.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              {team.leaderName ? (
                <>
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">
                      {team.leaderName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">
                    <span className="text-muted-foreground">Leader: </span>
                    <span className="font-medium">{team.leaderName}</span>
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground text-sm">
                  No leader assigned
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm">Staffing:</span>
              <Progress value={staffing} className="h-2 w-24" />
              <span className="text-sm font-medium">
                {team.filledRoles}/{team.totalRoles}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
