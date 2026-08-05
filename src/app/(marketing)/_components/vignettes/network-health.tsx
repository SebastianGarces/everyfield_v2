import { PlantHealthRow } from "@/components/phase-engine/plant-health-card";
import { PlantHealthPortfolio } from "@/components/phase-engine/plant-health-portfolio";

import {
  NETWORK_PORTFOLIO,
  NETWORK_SCOPE_LABEL,
} from "./network-health-fixture";
import { VignetteGate } from "./vignette-gate";

/**
 * Plant Health for a network — the app's own oversight surface, rendered live.
 *
 * This is the one section written for the person who signs the cheque, and it
 * makes a promise the picture has to keep: portfolio health at a glance, and
 * "you see health, not their people's private records". So the picture is the
 * privacy-gated surface itself — `PlantHealthPortfolio`, fed the output of the
 * real read (`getOversightPlantHealth`) for a real network admin. What the
 * landing page shows and what oversight actually exposes cannot drift apart,
 * because they are the same component reading the same shape of data.
 *
 * It brings its own heading and page description, so nothing has to be
 * reconstructed around it — the whole surface drops in as one picture.
 *
 * Two compositions:
 *
 *   - Desktop gets the portfolio: the three classification counts, the plant
 *     that needs a conversation with its three observations, and the one that
 *     doesn't.
 *   - Below 900px the full card would be scaled past reading, so the phone
 *     gets `PlantHealthRow` — the app's own compact density for this exact
 *     surface, not a marketing reduction of it — one row per plant, with the
 *     observation count where the observations were.
 *
 * Server component; `VignetteGate` is the only client part and takes the
 * surface as children, so the app component never crosses into the client
 * bundle.
 */

const EMBED_LABEL =
  "Plant Health across a network: Redemption Hill Church needs readiness focus — pre-launch, launching in 27 days, with a medium observation about prayer coverage and two low ones — while Trinity Grove Church sits on track after launch.";

const COMPACT_LABEL =
  "Plant Health across a network: Redemption Hill Church, pre-launch and launching in 27 days, with three observations; Trinity Grove Church, post-launch and on track.";

export function NetworkHealth() {
  return (
    <VignetteGate className="vg-networks">
      <div className="vg-embed-full">
        {/* inert on the inner wrapper, not the mount — an inert element is
            hidden from assistive technology, which would take the aria-label
            with it. The portfolio's count row is three real anchors and the
            compact rows are real <details> disclosures; neither may be
            reachable inside a picture. */}
        <div className="vg-app-embed" role="img" aria-label={EMBED_LABEL}>
          <div inert>
            <PlantHealthPortfolio
              plants={NETWORK_PORTFOLIO}
              scopeLabel={NETWORK_SCOPE_LABEL}
            />
          </div>
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">Plant health</span>
          <span className="vg-asof">{NETWORK_PORTFOLIO.length} plants</span>
        </div>
        <div className="vg-app-embed" role="img" aria-label={COMPACT_LABEL}>
          <div inert>
            {/* the app's own wrapper for these rows: they are <li> elements */}
            <ul className="space-y-2">
              {NETWORK_PORTFOLIO.map((plant) => (
                <PlantHealthRow key={plant.churchId} plant={plant} />
              ))}
            </ul>
          </div>
        </div>
        {/* what the desktop composition says in a heading and a count row */}
        <p className="vg-sc-foot">1 needs readiness focus · 1 on track</p>
      </div>
    </VignetteGate>
  );
}
