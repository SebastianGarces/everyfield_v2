import { MeetingCard } from "@/components/meetings/meeting-card";
import { PeopleList } from "@/components/people/people-list";
import { PersonCard } from "@/components/people/person-card";

import {
  COMMITTED_BREAKDOWN,
  COMMITTED_PEOPLE,
  COMMITTED_PEOPLE_COMPACT,
  COMMITTED_TOTAL,
  PIPELINE_PEOPLE,
  PIPELINE_PEOPLE_COMPACT,
  PIPELINE_TOTAL,
  VISION_MEETING_4,
} from "./journey-people-fixture";

/**
 * The two people phases of the journey, rendered with the app's own cards.
 *
 * Both panels used to be screenshots of the People screen. They are now the
 * screen: `components/people/person-card.tsx`, `people-list.tsx` and
 * `components/meetings/meeting-card.tsx`, fed the frozen Redemption Hill read
 * in journey-people-fixture.ts. Pixel-identical to the product by
 * construction — the landing page cannot claim a card the app does not render.
 *
 * Two panels, two different reads, deliberately:
 *
 *   - CORE GROUP is the pipeline, and the meeting that moved people along it.
 *     Six person cards in a fixed two-column grid, in pipeline order, so what
 *     you read is prospect → attendee → following up → interviewed → core
 *     group, with the app's own status badge doing the telling. The grid is
 *     ours rather than `PeopleList`'s because `PeopleList` reflows on VIEWPORT
 *     breakpoints (2/3/4 columns) and a mount that changes shape three times
 *     needs three zoom ladders; a fixed two columns is one curve.
 *     Standing on its corner, the completed vision meeting that produced the
 *     28 the Plant Intelligence scorecard cites higher up this page — the same
 *     layered composition the retired overlay image made, now two live app
 *     surfaces at the SAME scale instead of a card photographed at another.
 *   - LAUNCH TEAM is the screen itself. `PeopleList`, with the committed
 *     filter's first page and its real total, so the component prints its own
 *     "Showing 12 of 61 people" — the "61 total" the retired capture could
 *     only put in alt text. Its viewport-driven reflow is the honest thing
 *     here: it is what the planter's own window does.
 *
 * Neither panel has a chip, so nothing here touches the one-claim-per-visual
 * chip rule in phase-tabs.tsx.
 *
 * Server components on purpose, and that is load-bearing: they must be built
 * in `page.tsx` (a server component) and passed INTO `PhaseTabs` as props.
 * `phase-tabs.tsx` is `"use client"`, so anything imported there is a client
 * component — importing these from it would drag the person card, the meeting
 * card, date-fns and the fixture into the marketing bundle. See the
 * integration spec.
 *
 * Below 900px each drops to two real cards inside marketing chrome that says
 * what the rest are: still the app's card, just the minimum of it that gets
 * the idea across at phone width.
 */

/** Announced as one picture of the product — the same contract as the capture
 *  each replaces, and it keeps the cards' own h3s out of the page outline.
 *
 *  Four labels, not two: each composition gets the sentence that is true of it.
 *  The phone compositions render two cards where the desktop ones render six and
 *  twelve, so sharing a label would describe a picture the reader is not being
 *  shown — and for a screen-reader user the label is the only picture there is. */
const PIPELINE_LABEL =
  "Six of Redemption Hill's people as the app cards them, in pipeline order — two prospects, an attendee, someone in follow-up, someone interviewed, and one now in the core group, each carrying the status the app gave it.";

const PIPELINE_COMPACT_LABEL =
  "The two ends of Redemption Hill's pipeline as the app cards them: a new prospect, and someone now in the core group.";

const COMMITTED_LABEL =
  "The People screen filtered to the committed — twelve cards with a Core Group badge on every one, and 61 committed in all.";

const COMMITTED_COMPACT_LABEL =
  "Two cards from the People screen filtered to the committed, a Core Group badge on each — 61 committed in all.";

const MEETING_LABEL =
  "Vision Meeting #4, completed at the Riveras' home on Friday, July 24 — 28 attended, one of them new.";

/**
 * Core group · the pipeline, and the vision meeting standing on its corner.
 *
 * Replaces pt-coregroup.webp AND its fs-meetings-m.webp overlay. Both live in
 * one node because they are one composition: marketing.css lays them out as a
 * flex row with a 20px overlap, which is the only way the overlap stays 20px
 * at every width — an absolutely-positioned overlay would drift across a
 * status badge as the pane grows. The meeting card is hidden below 900px, the
 * same as every other overlay in this section.
 */
export function CoreGroupPipeline() {
  return (
    <div className="vg-jp vg-jp-pipeline">
      <div className="vg-jp-full">
        <div className="vg-jp-stage">
          <div className="vg-jp-mount vg-jp-people">
            <div
              className="vg-app-embed"
              role="img"
              aria-label={PIPELINE_LABEL}
            >
              {/* inert on a wrapper inside the labelled mount: an inert element
                  is itself dropped from the accessibility tree, so on the mount
                  it would take the label with it */}
              <div inert>
                <div className="vg-jp-grid">
                  {PIPELINE_PEOPLE.map((person) => (
                    <PersonCard key={person.id} person={person} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="vg-jp-mount vg-jp-meet">
            <div className="vg-app-embed" role="img" aria-label={MEETING_LABEL}>
              <div inert>
                <MeetingCard meeting={VISION_MEETING_4} isPast />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="vg-jp-compact">
        <div className="vg-sc-head">
          <span className="vg-label">People pipeline</span>
          <span className="vg-asof">{PIPELINE_TOTAL} people</span>
        </div>
        <div
          className="vg-app-embed"
          role="img"
          aria-label={PIPELINE_COMPACT_LABEL}
        >
          <div inert>
            <div className="grid gap-3">
              {PIPELINE_PEOPLE_COMPACT.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          </div>
        </div>
        {/* the two cards above are the two ends of it */}
        <p className="vg-sc-foot">
          Contact to committed — {COMMITTED_TOTAL} have made it.
        </p>
      </div>
    </div>
  );
}

/**
 * Launch team · the People screen filtered to the committed.
 *
 * Replaces pt-launch-team.webp. No overlay, then or now.
 */
export function LaunchTeamCommitted() {
  return (
    <div className="vg-jp vg-jp-committed">
      <div className="vg-jp-full">
        <div className="vg-jp-mount">
          <div className="vg-app-embed" role="img" aria-label={COMMITTED_LABEL}>
            <div inert>
              <PeopleList
                people={COMMITTED_PEOPLE}
                total={COMMITTED_TOTAL}
                nextCursor={null}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="vg-jp-compact">
        <div className="vg-sc-head">
          <span className="vg-label">Committed</span>
          <span className="vg-asof">{COMMITTED_TOTAL} total</span>
        </div>
        <div
          className="vg-app-embed"
          role="img"
          aria-label={COMMITTED_COMPACT_LABEL}
        >
          <div inert>
            <div className="grid gap-3">
              {COMMITTED_PEOPLE_COMPACT.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          </div>
        </div>
        {/* what twelve identical badges say by repetition, said once */}
        <p className="vg-sc-foot">
          {COMMITTED_BREAKDOWN.coreGroup} core group ·{" "}
          {COMMITTED_BREAKDOWN.launchTeam} launch team ·{" "}
          {COMMITTED_BREAKDOWN.leaders} leaders
        </p>
      </div>
    </div>
  );
}
