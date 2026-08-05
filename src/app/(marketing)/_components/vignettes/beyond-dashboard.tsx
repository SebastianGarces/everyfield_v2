import {
  BEYOND_ACTIVITY,
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
 * Desktop-only on purpose (B1, confirmed 2026-08-05 — PR #299 decision 6):
 * below 900px the mobile journey keeps `pt-beyond-m.webp` and its "Week 6 ·
 * 112 in the room" chip, so this component renders no compact composition —
 * the capture and chip carry the phone's claim, and one visual makes one
 * claim.
 */

const EMBED_LABEL = `Trinity Grove Church's dashboard six weeks after launch: ${BEYOND_METRICS.coreGroupSize} in the core group, ${BEYOND_METRICS.totalPeople} people, no overdue tasks, and a feed of Sunday gatherings — week 6 completed with 112 attendees.`;

export function BeyondDashboard() {
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
    </div>
  );
}
