"use client";

// ============================================================================
// TeamCard — the app's team tile, as the dashboard has always used it.
//
// The markup and the icon table moved to team-card-view.tsx, which is
// server-safe and is now the single definition of what a team tile looks like.
// Import them from there, not from here: this module is a client boundary, so
// anything re-exported through it becomes a client reference and stops being
// callable on the server.
//
// Nothing on this card ever needed the browser — no state, no handlers, only a
// link — so the "use client" here is inherited, not required. It stays so the
// client boundary the teams dashboard renders is exactly the one it rendered
// before; the view is what the marketing embeds import instead.
// ============================================================================

import type { TeamWithStats } from "@/lib/ministry-teams/service";
import { TeamCardView } from "./team-card-view";

interface TeamCardProps {
  team: TeamWithStats;
}

export function TeamCard({ team }: TeamCardProps) {
  return <TeamCardView team={team} />;
}
