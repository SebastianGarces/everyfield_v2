import {
  CsfScorecard,
  FactorTile,
} from "@/components/phase-engine/csf-scorecard";

import { CSF_FIXTURE, CSF_FIXTURE_COMPACT } from "./csf-fixture";
import { VignetteGate } from "./vignette-gate";

/**
 * The Plant Intelligence scorecard — the app's own component, rendered live.
 *
 * This is the differentiator moment, so the proof has to be the product: not a
 * capture of the card, and not a marketing imitation of it, but
 * `components/phase-engine/csf-scorecard.tsx` itself, fed the real assessment
 * this page has always quoted (see csf-fixture.ts). Pixel-identical to the app
 * by construction — the landing page cannot drift into showing a card the
 * product does not render.
 *
 * Two compositions of the same component, because the card is eight tiles:
 *
 *   - Desktop gets the whole card. It is a fixed-width render scaled down into
 *     the pane (see .vg-app-embed in marketing.css), the same way the pane
 *     beside it is a scaled-down capture of an app screen.
 *   - Below 900px the full card would be a wall of unreadable type, so the
 *     compact composition shows three REAL tiles — one of each raised standing
 *     — inside marketing chrome that says what the other five are. Still the
 *     app's tiles; just the minimum of them that gets the idea across.
 *
 * The resolve stays: raised tiles land neutral (dashed ring, no tint, no
 * standing) and then resolve one at a time into the verdict the assessment
 * reached. None of that is drawn here — marketing.css animates the real card's
 * own DOM through the `data-standing` hooks the tile exposes.
 *
 * Server component on purpose. `VignetteGate` is the only client part and it
 * takes the card as children rather than rendering it, so the app component
 * never crosses into the client bundle.
 */

/** The card is a picture of the product, so it is announced as one — the same
 *  contract as the capture it replaces, and it keeps the app card's own h2 and
 *  eight h3s out of this page's heading outline. */
const EMBED_LABEL =
  "The Plant Intelligence scorecard reading all eight critical success factors — vision casting going well, shared ownership needs attention, two worth a look.";

export function EngineScorecard() {
  return (
    <VignetteGate className="vg-scorecard">
      <div className="vg-embed-full">
        <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
          <CsfScorecard scorecard={CSF_FIXTURE} />
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">Critical success factors</span>
          <span className="vg-asof">As of July 31, 2026</span>
        </div>
        <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
          <ul aria-label="Critical success factors" className="grid gap-3">
            {CSF_FIXTURE_COMPACT.map((factor) => (
              <FactorTile key={factor.category} factor={factor} />
            ))}
          </ul>
        </div>
        {/* the app's own summary sentence for this assessment — it carries the
            five factors this composition leaves out */}
        <p className="vg-sc-foot">1 of 8 need attention, 2 worth a look.</p>
      </div>
    </VignetteGate>
  );
}
