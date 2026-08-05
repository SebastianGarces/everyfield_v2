import { TeamCardView } from "@/components/ministry-teams/team-card-view";

import { FS_TEAMS_FIXTURE, FS_TEAMS_TOTAL } from "./fs-teams-fixture";

/**
 * The Teams panel's overlay — the app's own ministry-team tile, rendered live.
 *
 * The panel's primary visual stays a capture (r5-teamhealth): the Team Health
 * Dashboard is `"use client"` because of its recharts radar chart, and recharts
 * plus its d3/redux chain is ~100kB gzipped of JavaScript that would have to
 * ship to every landing-page visitor to draw one decorative polygon. The
 * overlay is where the live embed earns its keep instead — `TeamCardView` is
 * the ONE definition of a team tile in this codebase (`team-card.tsx` renders
 * it and owns no markup of its own), so what the landing page shows here
 * cannot drift from what a planter sees.
 *
 * Two tiles, not six. The retired r5-teamcards capture showed six at 8–9px
 * effective type; two real ones at ~13px say the same thing legibly, and the
 * pair is chosen so the tiles agree with the dashboard behind them — the
 * dashboard's "All Teams" list flags Children's Ministry red and Prayer green,
 * and the tile derives its dot from the same staffing ratio.
 *
 * Server components, both of them. The only client island in the subtree is
 * the Radix progress bar the tile itself uses (~2kB gzipped), which is the
 * whole point of the recharts trade.
 */

/**
 * Announced as one picture of the product — the same contract as the capture
 * it replaces, and it keeps the tiles' own h3s out of this page's heading
 * outline. It carries the count the compositions crop away, so the visible
 * footnote below is a repeat rather than the only place that fact lives.
 */
const EMBED_LABEL =
  "Two of Redemption Hill's eleven ministry team cards — Children's Ministry staffed two of seven roles and flagged red, Prayer two of three and healthy.";

/** The tile is an anchor in the product, so it stays one here: same box, same
 *  layout, same everything. The mount is `inert`, so it is neither focusable
 *  nor clickable — this href exists only so the element keeps its identity. */
const INERT_HREF = "#";

function TeamTiles() {
  return (
    // gap-4 is the app's own teams grid gutter (teams-dashboard.tsx)
    <div className="grid gap-4">
      {FS_TEAMS_FIXTURE.map((team) => (
        <TeamCardView key={team.id} team={team} href={INERT_HREF} />
      ))}
    </div>
  );
}

/**
 * Desktop: the overlay that lands on the health-dashboard crop.
 *
 * The frame carries the description and the mount carries `inert`. Both is
 * deliberate: `inert` takes its subtree out of the accessibility tree, so a
 * label on the mount alone would leave this visual unannounced.
 */
export function FsTeamsOverlay() {
  return (
    <div className="vg-fs-ov vg-fs-teams" role="img" aria-label={EMBED_LABEL}>
      <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL} inert>
        <TeamTiles />
      </div>
    </div>
  );
}

/**
 * Mobile: the same two tiles at the size the app draws them — no scaling at
 * all, which is the one thing a 375px-wide screen can show honestly. The
 * stacked story section already carries the heading and the sentence, so the
 * only marketing chrome here is the footnote that accounts for the nine teams
 * this composition leaves out.
 */
export function FsTeamsMobile() {
  return (
    <div
      className="vg-fs-stack vg-fs-teams-m"
      role="img"
      aria-label={EMBED_LABEL}
    >
      <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL} inert>
        <TeamTiles />
      </div>
      <p className="vg-sc-foot">
        {FS_TEAMS_TOTAL - FS_TEAMS_FIXTURE.length} more teams — staffing,
        training and attendance on each.
      </p>
    </div>
  );
}
