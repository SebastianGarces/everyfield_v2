import { MetricCard } from "@/components/dashboard/metric-card";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PHASES } from "@/lib/constants";

import { DashboardSurface, metricCards } from "./dashboard-surface";
import {
  HERO_ACTIVITY,
  HERO_ACTIVITY_COMPACT,
  HERO_CHURCH_NAME,
  HERO_METRICS,
  HERO_PHASE,
} from "./hero-dashboard-fixture";

/**
 * The hero: a real plant's dashboard, rendered live.
 *
 * The first thing anyone sees on this page is a picture of the product, and
 * the strongest version of that picture is the product. Everything inside the
 * mount is app DOM — `MetricCard`, `ActivityFeed`, `QuickActions` — fed a
 * frozen read of Redemption Hill Church (see hero-dashboard-fixture.ts). Not a
 * screenshot that ages out of date the next time the dashboard changes, and
 * not a marketing imitation of it.
 *
 * Two compositions of the same components:
 *
 *   - Desktop gets the whole surface: the church and its phase, the four
 *     metrics, the week's activity, and the four actions beside it.
 *   - Below 900px that surface would be scaled to unreadable type, so the
 *     phone gets two real metric cards and the real feed cut to three items,
 *     inside marketing chrome that says what the other two cards hold. Still
 *     the app's components; just the minimum of them that gets the idea
 *     across.
 *
 * NO SCROLL GATE, and no animation. This is the LCP element on the page: an
 * entrance here is a measured cost paid for a beat nobody scrolls to see,
 * because it is already on screen when the page opens. It is also why this
 * whole subtree stays server-rendered — the hero ships no client JavaScript
 * of its own.
 *
 * The two Chips over this are marketing-owned and positioned in marketing.css
 * against the CAPTURE's geometry; a chrome-less composition has no header bar
 * or sidebar, so everything sits higher and their offsets need re-measuring.
 */

const EMBED_LABEL = `The EveryField dashboard for Redemption Hill Church in pre-launch: a core group of ${HERO_METRICS.coreGroupSize}, ${HERO_METRICS.totalPeople} people in the pipeline, ${HERO_METRICS.overdueTasks} overdue tasks and ${HERO_METRICS.visionMeetingsHeld} vision meetings held, over a feed of the week's real activity and the four actions the app keeps one click away.`;

const COMPACT_LABEL = `Redemption Hill Church's dashboard: a core group of ${HERO_METRICS.coreGroupSize}, ${HERO_METRICS.totalPeople} people in the pipeline, and the three most recent things that happened.`;

export function HeroDashboard() {
  const [coreGroup, totalPeople] = metricCards(HERO_METRICS);

  return (
    <div className="vg-hero">
      <div className="vg-embed-full">
        {/*
          `inert` sits on an inner wrapper, not on the labelled mount. An inert
          element is itself hidden from assistive technology, so putting it on
          the mount would take the aria-label with it and leave the picture
          undescribed. Here the outer element is a labelled image (role="img"
          makes its contents presentational) and the inner one is unreachable:
          `QuickActions` renders four real next/link anchors, and nothing in a
          picture may be focusable or clickable.
        */}
        <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
          <div inert>
            <DashboardSurface
              churchName={HERO_CHURCH_NAME}
              phase={HERO_PHASE}
              metrics={HERO_METRICS}
              activities={HERO_ACTIVITY}
              quickActions
            />
          </div>
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">{HERO_CHURCH_NAME}</span>
          <span className="vg-asof">{PHASES[HERO_PHASE]}</span>
        </div>
        <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
          <div inert>
            <div className="grid grid-cols-2 gap-3">
              {[coreGroup, totalPeople].map(({ key, ...card }) => (
                <MetricCard key={key} {...card} />
              ))}
            </div>
            <div className="mt-3">
              <ActivityFeed activities={HERO_ACTIVITY_COMPACT} />
            </div>
          </div>
        </div>
        {/* the two metric cards this composition leaves out, as their numbers */}
        <p className="vg-sc-foot">
          {HERO_METRICS.overdueTasks} overdue tasks ·{" "}
          {HERO_METRICS.visionMeetingsHeld} vision meetings held
        </p>
      </div>
    </div>
  );
}
