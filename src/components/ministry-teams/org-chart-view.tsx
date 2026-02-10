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
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

interface OrgChartViewProps {
  teams: TeamWithStats[];
}

export function OrgChartView({ teams }: OrgChartViewProps) {
  // Senior Pastor is the root node
  const seniorPastor = teams.find(
    (t) => t.name.toLowerCase().includes("senior pastor")
  );
  const otherTeams = teams.filter(
    (t) => !t.name.toLowerCase().includes("senior pastor")
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Organization Chart</h2>
        <Badge variant="outline" className="text-xs">
          {teams.length} teams
        </Badge>
      </div>

      <div className="flex flex-col items-center gap-6">
        {/* Root: Senior Pastor */}
        {seniorPastor && (
          <>
            <OrgNode team={seniorPastor} isRoot />
            {/* Connector line */}
            <div className="bg-border h-8 w-px" />
            {/* Horizontal connector */}
            <div className="bg-border h-px w-full max-w-4xl" />
          </>
        )}

        {/* Child teams in a grid */}
        <div className="grid w-full max-w-6xl gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {otherTeams.map((team) => (
            <div key={team.id} className="flex flex-col items-center gap-2">
              {seniorPastor && <div className="bg-border h-4 w-px" />}
              <OrgNode team={team} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrgNode({
  team,
  isRoot = false,
}: {
  team: TeamWithStats;
  isRoot?: boolean;
}) {
  const Icon = TEAM_ICONS[team.icon ?? ""] ?? Users;
  const staffingPercent =
    team.totalRoles > 0
      ? Math.round((team.filledRoles / team.totalRoles) * 100)
      : 0;

  return (
    <Link href={`/teams/${team.id}`} className="w-full">
      <Card
        className={cn(
          "cursor-pointer py-0 shadow-sm transition-all duration-200 hover:shadow-md",
          isRoot && "border-primary/30 bg-primary/5"
        )}
      >
        <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              isRoot
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p
              className={cn(
                "text-sm font-semibold",
                isRoot && "text-base"
              )}
            >
              {team.name}
            </p>
            {team.leaderName ? (
              <div className="mt-1 flex items-center justify-center gap-1">
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[8px]">
                    {team.leaderName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <span className="text-muted-foreground text-xs">
                  {team.leaderName}
                </span>
              </div>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs italic">
                No leader
              </p>
            )}
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px]",
              staffingPercent === 100 &&
                "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
              staffingPercent < 60 &&
                "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
              staffingPercent < 40 &&
                "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
            )}
          >
            {team.filledRoles}/{team.totalRoles} roles
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}
