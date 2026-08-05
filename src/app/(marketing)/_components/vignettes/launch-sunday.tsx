import { MeetingSummaryCards } from "@/app/(dashboard)/meetings/[id]/meeting-summary-cards";
import { MeetingHeader } from "@/components/meetings/meeting-header";

import {
  LAUNCH_SUNDAY_CARDS,
  LAUNCH_SUNDAY_MEETING,
} from "./launch-sunday-fixture";

/**
 * Launch Sunday — the app's own meeting page, rendered live.
 *
 * The panel used to be a screenshot of /meetings/<id> with the run-sheet
 * vignette floated over it. The vignette stays: it is a marketing moment, a
 * distillation of this meeting's notes into an hour-by-hour rule, and the one
 * thing a still of this page could never show. What it now stands on is the
 * page itself — `components/meetings/meeting-header.tsx` and
 * `app/(dashboard)/meetings/[id]/meeting-summary-cards.tsx`, fed the Launch
 * Sunday meeting Redemption Hill actually has (see launch-sunday-fixture.ts).
 *
 * The header block's wrapper (`bg-card`, `p-6 pb-0`) is copied from the
 * meeting page's own layout (app/(dashboard)/meetings/[id]/layout.tsx:50-54),
 * minus the tab strip that sits under it there, so the composition around the
 * real header is the app's rather than an invention.
 *
 * The Notes card is deliberately absent — the fixture drops that one field,
 * and only that one, because the notes ARE the run sheet the vignette is
 * already saying. One claim per visual.
 *
 * This embed does not animate. The run sheet beside it is the panel's moving
 * part, and two things resolving at once in one frame is two claims; the mount
 * gets the same entrance the crop it replaces had, and then holds still.
 *
 * Two compositions:
 *
 *   - Desktop gets the header and the three cards under it.
 *   - Below 900px the header's two-column top row has nowhere to go, so the
 *     compact composition keeps the three cards — date, venue, estimate — and
 *     lets marketing chrome carry the title and the run sheet, which is where
 *     the vignette's claim goes at a width the vignette does not survive.
 *
 * Server component on purpose, and `inert` sits inside the `role="img"` mount
 * so the mount keeps its accessible name while its contents keep none.
 */

const MEETING_LABEL =
  "The Launch Sunday meeting page — August 28, 2026 at 10:00 AM in Lakeview Elementary's gym, about 120 people estimated, still in planning.";

const MEETING_COMPACT_LABEL =
  "Launch Sunday's date, venue and estimate as the app shows them: August 28, 2026 at 10:00 AM, Lakeview Elementary's gym, about 120 estimated.";

export function LaunchSunday() {
  return (
    <div className="vg-embed-mount vg-launch">
      <div className="vg-embed-full">
        <div className="vg-app-embed" role="img" aria-label={MEETING_LABEL}>
          <div className="space-y-6" inert>
            <div className="bg-card p-6 pb-0 shadow-sm">
              <MeetingHeader meeting={LAUNCH_SUNDAY_MEETING} />
            </div>
            <MeetingSummaryCards meeting={LAUNCH_SUNDAY_CARDS} />
          </div>
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">Launch Sunday</span>
          <span className="vg-asof">Redemption Hill</span>
        </div>
        <div
          className="vg-app-embed"
          role="img"
          aria-label={MEETING_COMPACT_LABEL}
        >
          <div inert>
            <MeetingSummaryCards meeting={LAUNCH_SUNDAY_CARDS} />
          </div>
        </div>
        {/* the run sheet, which is desktop-only as a vignette — this is the
            meeting's own note, in the marketing voice */}
        <p className="vg-sc-foot">
          Run sheet: 7:30 setup &middot; 8:15 band call &middot; 9:15 doors
          &middot; 10:00 service.
        </p>
      </div>
    </div>
  );
}
