import { FocusPanel } from "@/components/phase-engine/focus-panel";
import { InsightCardView } from "@/components/phase-engine/insight-card-view";

import {
  FOCUS_ARTICLE_REFS,
  FOCUS_ASSESSMENT,
  FOCUS_DELTA,
  FOCUS_INSIGHTS_LEAD,
} from "./focus-fixture";
import { VignetteGate } from "./vignette-gate";

/**
 * "Your focus" — the app's own Focus panel, rendered live.
 *
 * The pane beside it grades the plant; this one says what to do about it. Both
 * read the same 2026-07-31 assessment of the same church (see focus-fixture.ts
 * and csf-fixture.ts), so the two panes are one plant on one day rather than
 * two unrelated screenshots.
 *
 * It is `components/phase-engine/focus-panel.tsx` itself, not a capture of it
 * and not a marketing imitation — including the part that matters most here:
 * each insight cites the facts the judge actually read, and links the
 * methodology article that says how to improve it. That link is the reason this
 * embed needed the panel's one escape hatch: in the app the card resolves its
 * slugs against the live published wiki (PE-024), which is a database read, and
 * a landing page may not make one. So the refs are frozen in the fixture and
 * handed in; the panel then renders the pure `InsightCardView` and does no IO.
 *
 * Two compositions of the same panel:
 *
 *   - Desktop gets the real panel — its header, its as-of date, its
 *     what-changed row, and the two insights the engine ranked first. Two, not
 *     five: the pane is ~550px wide and the panel is 704px, so every extra card
 *     costs scale, and five would land the type near 7px (see
 *     FOCUS_INSIGHTS_LEAD for the arithmetic).
 *   - Below 900px the scaled panel would be unreadable, so the compact
 *     composition drops the panel's chrome for the marketing header/footer and
 *     shows the top-ranked card alone, at full size. Still the app's card; just
 *     the minimum of it that gets the idea across.
 *
 * The resolve stays on the app's own DOM: each card's border firms up out of a
 * neutral dashed ring, its severity badge stamps in, and its evidence rows land
 * after — the engine reaching a verdict, not a card sliding in. None of that is
 * drawn here; marketing.css animates it off the badge's `data-slot` and the
 * card's own element order.
 *
 * Server component on purpose. `VignetteGate` is the only client part and takes
 * the panel as children rather than rendering it, so nothing here crosses into
 * the client bundle.
 */

/** Announced as one picture of the product — the same contract as the capture
 *  it replaces, and it keeps the panel's h2/h3s out of this page's heading
 *  outline. `inert` is what makes that contract true: the cards carry real
 *  next/link anchors to the wiki, and nothing inside a picture may be reachable
 *  by keyboard or pointer. It sits on a wrapper INSIDE the labelled mount
 *  because an inert element is itself dropped from the accessibility tree —
 *  on the mount it would take this label with it. */
const EMBED_LABEL =
  "Your focus in EveryField — what changed since the last assessment (another vision meeting held, attendance up four, one more ministry role filled, thirteen more training completions) and the two next steps the engine ranked highest on July 31: clear twelve stale follow-ups, and fill the last of eight ministry roles, each citing the facts behind it and linking the article that says how.";

/** The phone composition is ONE card, so it gets its own sentence — the desktop
 *  label would promise a second insight that is not on screen. */
const COMPACT_LABEL =
  "Your focus in EveryField — the step the engine ranked highest from the July 31 assessment: clear twelve stale follow-ups, with the facts behind it and the article that says how.";

export function EngineFocus() {
  return (
    <VignetteGate className="vg-focus">
      <div className="vg-embed-full">
        <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
          <div inert>
            <FocusPanel
              assessment={FOCUS_ASSESSMENT}
              insights={FOCUS_INSIGHTS_LEAD}
              delta={FOCUS_DELTA}
              articleRefs={FOCUS_ARTICLE_REFS}
              linkStatic
            />
          </div>
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">Your focus</span>
          <span className="vg-asof">As of July 31, 2026</span>
        </div>
        <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
          <div inert>
            {/* One card, not two: the mount is ~245px wide on a phone, where an
                insight body runs to five lines — one real card is already 330px
                tall, and it carries the whole idea (a verdict, the facts behind
                it, and the article that fixes it). The count below says it is a
                ranked list. */}
            <InsightCardView
              insight={FOCUS_INSIGHTS_LEAD[0]}
              articleRefs={FOCUS_ARTICLE_REFS}
              linkStatic
            />
          </div>
        </div>
        {/* what the panel's own header says about the rest of the list, in the
            marketing voice, because the card arrives without it */}
        <p className="vg-sc-foot">The first of five focus items this week.</p>
      </div>
    </VignetteGate>
  );
}
