// ============================================================================
// TeamCardView — the ministry-team card's markup, with nothing that has to run.
//
// Every pixel of a team tile lives here: the icon chip, the name row with its
// health dot, the leader line, the staffing bar and the two footer badges.
// What does NOT live here is anything that needs a browser — no "use client",
// no state, no handlers. The card's one interaction (the whole tile is a link
// to the team) is a destination, so it stays as a prop with the app's route as
// its default rather than an injected slot.
//
// Why the split exists: the marketing page wants to show the real product, not
// a re-drawing of it (see app/(marketing)/_components/vignettes/ and the
// archetype at components/phase-engine/csf-scorecard.tsx). `team-card.tsx` is
// a client module, and a client module cannot be rendered from a fixture on a
// public page without shipping its whole subtree to the browser. This file
// can: hand it a `TeamCardViewTeam`-shaped object and it renders on the
// server.
//
// The contract that makes that worth anything: this is the ONLY definition of
// what a team tile looks like. `team-card.tsx` renders this and owns no markup
// of its own. If the app's tile changes, the landing page's tile changes with
// it, because they are the same tile.
// ============================================================================

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
import type { TeamStatus, TeamType } from "@/db/schema";

export const TEAM_ICONS: Record<string, LucideIcon> = {
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

/**
 * The shape the tile actually reads. Deliberately narrower than
 * `TeamWithStats` (lib/ministry-teams/service.ts), which satisfies it
 * structurally — a fixture does not have to invent `churchId`, `createdBy` or
 * the audit timestamps to render this card.
 */
export interface TeamCardViewTeam {
  id: string;
  name: string;
  type: TeamType;
  status: TeamStatus;
  icon: string | null;
  leaderName: string | null;
  filledRoles: number;
  totalRoles: number;
}

export interface TeamCardViewProps {
  team: TeamCardViewTeam;
  /**
   * Where the tile points. Defaults to the app's team route, which is what the
   * dashboard wants; a caller rendering this outside the app (the marketing
   * embed) can aim it somewhere that exists there. The element is an anchor
   * either way, so the layout is identical.
   */
  href?: string;
}

/**
 * `data-slot="team-card"`, `data-status` and `data-health` are stable,
 * zero-visual hooks, in the same spirit as shadcn's `data-slot`s and the CSF
 * tile's `data-standing` (components/phase-engine/csf-scorecard.tsx): they name
 * the tile and its standing for anything styling or animating this card from
 * outside — the marketing embeds — without adding a class the card would then
 * have to keep. None of them change what this renders.
 */
export function TeamCardView({ team, href }: TeamCardViewProps) {
  const Icon = TEAM_ICONS[team.icon ?? ""] ?? Users;
  const staffingPercent =
    team.totalRoles > 0
      ? Math.round((team.filledRoles / team.totalRoles) * 100)
      : 0;

  const alertLevel =
    staffingPercent < 40 ? "red" : staffingPercent < 60 ? "yellow" : "green";

  return (
    <Link
      href={href ?? `/teams/${team.id}`}
      data-slot="team-card"
      data-status={team.status}
      data-health={alertLevel}
    >
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
              <h3 className="truncate text-sm leading-none font-semibold tracking-tight">
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
