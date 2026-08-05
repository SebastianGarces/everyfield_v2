import { MeetingCard } from "@/components/meetings/meeting-card";

import {
  MEETINGS_COMPACT_PAST,
  MEETINGS_COMPACT_UPCOMING,
  MEETINGS_PAST,
  MEETINGS_UPCOMING,
} from "./meetings-board-fixture";

/**
 * The Meetings board — the app's own cards, rendered live.
 *
 * The feature switcher's meetings panel used to be a screenshot of
 * /meetings. This is that page's card region rendered for real:
 * `components/meetings/meeting-card.tsx` itself, fed the board Redemption Hill
 * actually has (see meetings-board-fixture.ts). Pixel-identical to the product
 * by construction — the landing page cannot drift into showing a card the app
 * does not render.
 *
 * WHY NOT `MeetingList`. The app's list component is the obvious thing to
 * reach for and the wrong one: it is a client component that reads
 * `useSearchParams`, so embedding it would drag a Suspense boundary and a
 * router dependency onto the marketing page to render two filter toggles that
 * this page must not offer anyway. What is reused instead is everything below
 * the controls — the section heading, the count in its parentheses, and the
 * three-column grid — copied from `meeting-list.tsx` (the `space-y-*`
 * wrappers, `text-foreground/80 text-lg font-semibold` heading and
 * `grid gap-4` cards, lines 105-142) so the composition around the real cards
 * is the app's, not an invention.
 *
 * The counts in the headings are computed the way the app computes them, from
 * the length of the array being rendered, so the heading and the cards under it
 * can never disagree. The fixture explains why that board is three and three.
 *
 * Two compositions, because six cards on a phone would be a wall of type:
 *
 *   - Desktop gets the board: both sections, one row of three each. It is a
 *     fixed-width render scaled into the panel (see `.vg-meetings` in
 *     marketing.css) the same way the panel beside it scales a capture.
 *   - Below 900px the switcher's stacked story shows two real cards at real
 *     size — the one that is planned and the one that was run and counted —
 *     inside marketing chrome that says what the other four are.
 *
 * Both are server components: nothing here is stateful, and the panel's own
 * `.fs-seen` gate already drives the entrance, so no `VignetteGate` is
 * involved and no app component crosses into the client bundle. That only
 * holds if these are rendered from a SERVER parent and passed into
 * `FeatureSwitcher` (a client component) as a prop — importing them inside
 * feature-switcher.tsx would pull MeetingCard, its icons and the fixture into
 * the browser bundle.
 *
 * `inert` on the wrapper inside the mount is load-bearing: every MeetingCard is
 * a `next/link` to /meetings/<id>, and a landing-page picture of the product
 * must have nothing clickable or tabbable in it. `inert` also removes its
 * subtree from the accessibility tree, which is why it sits INSIDE the
 * `role="img"` mount rather than on it — the mount keeps its name, the cards
 * stop being reachable.
 */

const BOARD_LABEL =
  "The Meetings board for Redemption Hill — three upcoming: a worship team night, an orientation, and Vision Meeting #5 — over three past vision nights that drew 21, 24 and 28 people.";

const COMPACT_LABEL =
  "Two Meetings cards from Redemption Hill: Orientation #2, planned for the Riveras' home with about 12 people, and Vision Meeting #4, which drew 28 — one of them new.";

export function MeetingsBoard() {
  return (
    <div className="vg-fs-primary vg-fs-meetings">
      <div className="vg-app-embed" role="img" aria-label={BOARD_LABEL}>
        <div className="space-y-6" inert>
          <div className="space-y-4">
            <h2 className="text-foreground/80 text-lg font-semibold">
              Upcoming ({MEETINGS_UPCOMING.length})
            </h2>
            {/* the app's grid is `md:grid-cols-2 lg:grid-cols-3`, which is a
                statement about the VIEWPORT the app is being used at. Inside a
                fixed-width mount that gets scaled into the panel, the viewport
                says nothing about how wide this canvas is, so the desktop
                (three-column) composition is pinned — this is a picture of the
                meetings page on a desktop. */}
            <div className="grid grid-cols-3 gap-4">
              {MEETINGS_UPCOMING.map((meeting) => (
                <MeetingCard key={meeting.id} meeting={meeting} />
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-foreground/80 text-lg font-semibold">
              Past ({MEETINGS_PAST.length})
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {MEETINGS_PAST.map((meeting) => (
                <MeetingCard key={meeting.id} meeting={meeting} isPast />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MeetingsBoardCompact() {
  return (
    <div className="vg-fs-m vg-fs-meetings-m">
      <div className="vg-sc-head">
        <span className="vg-label">Meetings</span>
        <span className="vg-asof">Redemption Hill</span>
      </div>
      <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
        <div className="grid gap-4" inert>
          <MeetingCard meeting={MEETINGS_COMPACT_UPCOMING} />
          <MeetingCard meeting={MEETINGS_COMPACT_PAST} isPast />
        </div>
      </div>
      {/* the four cards this width leaves out, in the marketing voice */}
      <p className="vg-sc-foot">
        Two more upcoming and two more past on the board.
      </p>
    </div>
  );
}
