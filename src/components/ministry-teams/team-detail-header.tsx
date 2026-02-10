"use client";

import {
  Baby,
  Building,
  Crown,
  Handshake,
  Heart,
  Megaphone,
  Monitor,
  Music,
  Rocket,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TeamDetail } from "@/lib/ministry-teams/service";

const TEAM_ICONS: Record<string, LucideIcon> = {
  crown: Crown,
  rocket: Rocket,
  music: Music,
  baby: Baby,
  building: Building,
  handshake: Handshake,
  users: Users,
  megaphone: Megaphone,
  heart: Heart,
  monitor: Monitor,
};

interface TeamDetailHeaderProps {
  team: TeamDetail;
}

export function TeamDetailHeader({ team }: TeamDetailHeaderProps) {
  const Icon = TEAM_ICONS[team.icon ?? ""] ?? Users;
  const staffingPercent =
    team.totalRoles > 0
      ? Math.round((team.filledRoles / team.totalRoles) * 100)
      : 0;

  return (
    <div className="bg-card border-b p-6">
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
              <Progress value={staffingPercent} className="h-2 w-24" />
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
