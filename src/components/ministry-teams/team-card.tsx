"use client";

import Link from "next/link";
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

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { TeamWithStats } from "@/lib/ministry-teams/service";

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

interface TeamCardProps {
  team: TeamWithStats;
}

export function TeamCard({ team }: TeamCardProps) {
  const Icon = TEAM_ICONS[team.icon ?? ""] ?? Users;
  const staffingPercent =
    team.totalRoles > 0
      ? Math.round((team.filledRoles / team.totalRoles) * 100)
      : 0;

  const alertLevel =
    staffingPercent < 40
      ? "red"
      : staffingPercent < 60
        ? "yellow"
        : "green";

  return (
    <Link href={`/teams/${team.id}`}>
      <Card className="flex h-full cursor-pointer flex-col gap-0 py-0 shadow-sm transition-all duration-200 hover:shadow-md">
        <CardHeader className="flex flex-row items-center gap-3 p-4 pb-2">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              team.type === "custom"
                ? "bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400"
                : "bg-primary/10 text-primary"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold leading-none tracking-tight">
                {team.name}
              </h3>
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                  alertLevel === "red" && "bg-red-500",
                  alertLevel === "yellow" && "bg-yellow-500",
                  alertLevel === "green" && "bg-green-500"
                )}
                title={`Health: ${alertLevel}`}
              />
            </div>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {team.leaderName
                ? `Leader: ${team.leaderName}`
                : "No leader assigned"}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 px-4 pt-1 pb-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Staffing</span>
              <span className="font-medium">
                {team.filledRoles}/{team.totalRoles}
              </span>
            </div>
            <Progress value={staffingPercent} className="h-2" />
          </div>

          <div className="mt-auto flex items-center justify-between pt-1">
            {team.totalRoles - team.filledRoles > 0 ? (
              <Badge variant="outline" className="text-xs font-normal">
                {team.totalRoles - team.filledRoles} role
                {team.totalRoles - team.filledRoles !== 1 ? "s" : ""} open
              </Badge>
            ) : team.totalRoles > 0 ? (
              <Badge
                variant="secondary"
                className="bg-green-100 text-xs font-normal text-green-700 dark:bg-green-950 dark:text-green-400"
              >
                Fully staffed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-normal">
                No roles defined
              </Badge>
            )}
            <Badge
              variant="secondary"
              className={cn(
                "text-xs font-normal capitalize",
                team.status === "active" &&
                  "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
                team.status === "forming" &&
                  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
              )}
            >
              {team.status}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
