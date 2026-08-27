// ============================================================================
// TeamCardView — the ministry-team card's markup, with nothing that has to run.
//
// Every pixel of a team tile lives here: the icon chip, the name row with its
// staffing dot, the leader line, the staffing bar and the two footer badges.
//
// THE DOT IS A STAFFING SIGNAL, NOT "HEALTH" (ruling 409-5B, 2026-08-12). It
// derives from staffing percent alone (red < 40, yellow < 60); the health
// dashboard's alertLevel (lib/ministry-teams/health.ts) also weighs meeting
// attendance, so the same team can legitimately read green here and yellow on
// /teams/health. The two are different signals and are labelled differently
// on purpose — /teams/health keeps the word "health"; this card says staffing.
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
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  TEAM_ICONS,
  teamStaffingDisplay,
} from "@/lib/ministry-teams/team-display";
import type { TeamStatus, TeamType } from "@/db/schema";

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
  /** Render the tile as inert markup instead of a link — for presentational
   *  embeds (the marketing page), where nothing may be clickable, focusable or
   *  prefetchable. Takes precedence over `href`. Absent, as in the app, this
   *  tile is unchanged. */
  linkStatic?: boolean;
}

/**
 * `data-slot="team-card"`, `data-status` and `data-staffing` are stable,
 * zero-visual hooks, in the same spirit as shadcn's `data-slot`s and the CSF
 * tile's `data-standing` (components/phase-engine/csf-scorecard.tsx): they name
 * the tile and its standing for anything styling or animating this card from
 * outside — the marketing embeds — without adding a class the card would then
 * have to keep. None of them change what this renders.
 */
export function TeamCardView({ team, href, linkStatic }: TeamCardViewProps) {
  const Icon = TEAM_ICONS[team.icon ?? ""] ?? Users;
  const staffing = teamStaffingDisplay(team.filledRoles, team.totalRoles);

  const card = (
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
            {staffing.kind === "configured" && (
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                  staffing.level === "red" && "bg-red-500",
                  staffing.level === "yellow" && "bg-yellow-500",
                  staffing.level === "green" && "bg-green-500"
                )}
                title={`Staffing: ${staffing.level}`}
              />
            )}
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
              {staffing.kind === "no_roles"
                ? staffing.label
                : `${team.filledRoles}/${team.totalRoles}`}
            </span>
          </div>
          <Progress value={staffing.percentage} className="h-2" />
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
  );

  // The data- hooks move with the element, because marketing.css staggers the
  // tiles off `[data-slot="team-card"]`. A span rather than an href-less
  // anchor: a presentational embed should carry no app URL at all, so there is
  // nothing left to prefetch by construction.
  const hooks = {
    "data-slot": "team-card",
    "data-status": team.status,
    "data-staffing": staffing.kind === "no_roles" ? "neutral" : staffing.level,
  } as const;

  return linkStatic ? (
    <span {...hooks}>{card}</span>
  ) : (
    <Link href={href ?? `/teams/${team.id}`} {...hooks}>
      {card}
    </Link>
  );
}
