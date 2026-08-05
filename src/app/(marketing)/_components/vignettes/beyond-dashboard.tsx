import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PHASES } from "@/lib/constants";

import {
  BEYOND_ACTIVITY,
  BEYOND_ACTIVITY_COMPACT,
  BEYOND_CHURCH_NAME,
  BEYOND_METRICS,
  BEYOND_PHASE,
} from "./beyond-dashboard-fixture";
import { DashboardSurface, metricCards } from "./dashboard-surface";

/**
 * Beyond: the same dashboard, six weeks after launch.
 *
 * The journey's last stop is the same surface as its first — which is the
 * point of the panel. Trinity Grove is a different plant in a different phase
 * with different numbers, and the app has not changed shape around it: the
 * feed that counted vision meetings before launch now counts Sunday
 * gatherings. Rendering both from the same composition
 * (./dashboard-surface.tsx) is what makes that claim true rather than
 * asserted.
 *
 * The week's actions are left out here, and the column they occupy is where
 * the `WeeklyTicker` stands. That vignette carries the panel's claim (Week 6,
 * 112 in the room), which is why this panel has no desktop chip; the feed
 * beside it shows the app's own last three gatherings, and the ticker
 * distills all six from the same rows.
 *
 * The pane this sits in is height-capped, so the composition is short on
 * purpose — see the fixture's note on why the feed stops at three.
 *
 * The compact composition below 900px is only reached if the mobile journey
 * also retires `pt-beyond-m.webp` for this phase. If it does, the phase's
 * mobile chip has to go with it: the chip says "Week 6 · 112 in the room" and
 * the feed's first row says the same thing in the app's own words, and one
 * visual makes one claim. Keeping the mobile capture (and its chip) and
 * embedding on desktop only is the other valid reading — see the integration
 * spec.
 */

const EMBED_LABEL = `Trinity Grove Church's dashboard six weeks after launch: ${BEYOND_METRICS.coreGroupSize} in the core group, ${BEYOND_METRICS.totalPeople} people, no overdue tasks, and a feed of Sunday gatherings — week 6 completed with 112 attendees.`;

const COMPACT_LABEL = `Trinity Grove Church's dashboard six weeks after launch: ${BEYOND_METRICS.coreGroupSize} in the core group, and the last two Sunday gatherings.`;

export function BeyondDashboard() {
  const [coreGroup, , , visionMeetings] = metricCards(BEYOND_METRICS);

  return (
    <div className="vg-beyond">
      <div className="vg-embed-full">
        {/* inert on the inner wrapper, not the mount — see hero-dashboard.tsx */}
        <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
          <div inert>
            <DashboardSurface
              churchName={BEYOND_CHURCH_NAME}
              phase={BEYOND_PHASE}
              metrics={BEYOND_METRICS}
              activities={BEYOND_ACTIVITY}
            />
          </div>
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">{BEYOND_CHURCH_NAME}</span>
          <span className="vg-asof">{PHASES[BEYOND_PHASE]}</span>
        </div>
        <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
          <div inert>
            {/* the two that carry the post-launch story: who is committed, and
                how many gatherings are behind them */}
            <div className="grid grid-cols-2 gap-3">
              {[coreGroup, visionMeetings].map(({ key, ...card }) => (
                <MetricCard key={key} {...card} />
              ))}
            </div>
            <div className="mt-3">
              <ActivityFeed activities={BEYOND_ACTIVITY_COMPACT} />
            </div>
          </div>
        </div>
        <p className="vg-sc-foot">
          {BEYOND_METRICS.totalPeople} people · {BEYOND_METRICS.overdueTasks}{" "}
          overdue tasks
        </p>
      </div>
    </div>
  );
}
