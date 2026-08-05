import { UsersRound } from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { PersonCard } from "@/components/people/person-card";

import {
  CORE_GROUP_SIZE,
  PEOPLE_FIXTURE,
  PEOPLE_FIXTURE_COMPACT,
  TOTAL_PEOPLE,
} from "./people-pipeline-fixture";

/**
 * The People panel of the feature switcher — the app's own person cards,
 * rendered live.
 *
 * Replaces the fs-people.webp crop and the sec-core-61.webp overlay that sat
 * on it. Both were pictures of these exact components showing this exact data
 * (see people-pipeline-fixture.ts), so nothing about the composition changes;
 * what changes is that the panel can no longer drift from the product, and the
 * type is vector rather than a bitmap scaled to about 60%.
 *
 * Two compositions, in two different places in the DOM, because the switcher
 * is two different layouts:
 *
 *   - `PeoplePipeline` goes in the desktop tab panel (`.fswitch-shot`), where
 *     it renders nine cards — the whole pipeline, one person per rung — with
 *     the dashboard's Core Group stat card landing on the grid the way the
 *     capture overlay used to. Below 1100px the middle row is dropped in CSS,
 *     which keeps the type above the ~11px floor; the six that remain are the
 *     two ends of the pipeline, so the claim survives the cut.
 *   - `PeoplePipelineCompact` goes in the phone stack (`.fstack-shot`), where
 *     nine cards would be a wall of unreadable type. It shows two REAL cards —
 *     Grace Lin still being followed up, and Ana Jimenez leading — at full
 *     size, inside marketing chrome that carries the stat the phone layout
 *     drops with the overlay.
 *
 * Server components on purpose, and deliberately NOT wrapped in
 * `VignetteGate`: this panel already sits inside the switcher's own scroll
 * gate (`.fswitch.fs-seen`) and its own tab-switch replay, and a second
 * observer would only fight it. Nothing here ships a byte of client JS.
 *
 * The grid is three fixed columns rather than `PeopleList`, whose own grid is
 * `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` — viewport breakpoints, which
 * inside a fixed-width, zoomed mount would reflow the composition out from
 * under the zoom ladder. The cards are the app's, untouched; only the number
 * of columns they sit in is chosen here.
 */

/** The grid is a picture of the product, so it is announced as one — the same
 *  contract as the capture it replaces, and it keeps nine card headings out of
 *  this page's outline.
 *
 *  It describes the composition WITHOUT counting it. The pane shows four cards,
 *  six or nine depending on how wide it is, so a sentence that names a number —
 *  or names every rung of the pipeline — is a sentence that is false at two
 *  widths out of three. For a screen-reader user this label IS the content, so
 *  it has to be the true one at every width. */
const GRID_LABEL =
  "Contacts from Redemption Hill's pipeline on the app's own person cards — each showing the stage it has reached, where the person came from, and the day they were added.";

const STAT_LABEL =
  "The dashboard's Core Group card reading 61 — core group, launch team and leaders.";

const COMPACT_LABEL =
  "Two person cards from the Redemption Hill pipeline: Grace Lin, still being followed up after finding the church's website, and Ana Jimenez, now a leader.";

export function PeoplePipeline() {
  return (
    <div className="vg-fs vg-fs-people">
      <div className="vg-fs-primary">
        <div className="vg-app-embed" role="img" aria-label={GRID_LABEL}>
          {/* `inert` and not just `role="img"`: these cards are real
              `next/link` anchors. The attribute takes them out of the tab
              order and out of reach of a pointer, so the panel is a picture
              all the way down. It sits on the inner element rather than the
              labelled one because an inert subtree is dropped from the
              accessibility tree — the label has to live outside it to survive. */}
          <div className="vg-inert-layer" inert>
            {/* marketing-owned container, app-owned cards: `vg-fs-grid` is
                where marketing.css sets the column count and how many cards
                the pane is wide enough to hold */}
            <div className="vg-fs-grid grid gap-3">
              {PEOPLE_FIXTURE.map((person) => (
                <PersonCard key={person.id} person={person} linkStatic />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* the overlay: the same stat card the dashboard renders, landing on the
          grid the way the capture overlay did */}
      <div className="vg-fs-overlay vg-fs-stat">
        <div className="vg-app-embed" role="img" aria-label={STAT_LABEL}>
          <div className="vg-inert-layer" inert>
            <MetricCard
              title="Core Group"
              value={CORE_GROUP_SIZE}
              icon={UsersRound}
              variant="success"
              description="Core group, launch team & leaders"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PeoplePipelineCompact() {
  return (
    <div className="vg-fs-m vg-fs-people-m">
      <div className="vg-sc-head">
        <span className="vg-label">People</span>
        <span className="vg-asof">{TOTAL_PEOPLE} total</span>
      </div>
      <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
        <div className="vg-inert-layer" inert>
          <div className="grid gap-3">
            {PEOPLE_FIXTURE_COMPACT.map((person) => (
              <PersonCard key={person.id} person={person} linkStatic />
            ))}
          </div>
        </div>
      </div>
      {/* carries the stat the phone layout drops with the overlay */}
      <p className="vg-sc-foot">
        {CORE_GROUP_SIZE} of them are core group, launch team or leaders.
      </p>
    </div>
  );
}
