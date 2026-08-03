"use client";

import { useInView } from "../use-in-view";

/**
 * The Plant Intelligence scorecard, drawn live instead of screenshotted.
 *
 * This is the differentiator moment: the tiles land neutral and then resolve
 * one at a time into their verdict, so the section shows the engine *reading*
 * the plant rather than a still of a page that has already read it. Copy is
 * verbatim from the shipped assessment capture (r5-csf), which this replaces.
 *
 * Marketing-only DOM: nothing here imports from the app. The verdict palette
 * is sampled from the app's own attention tokens and re-measured against the
 * white card (see marketing.css for the ratios).
 */

type Verdict = "good" | "attention" | "look";

const TILES: readonly {
  csf: string;
  verdict: Verdict;
  badge: string;
  reading: string;
  basis: string;
}[] = [
  {
    csf: "CSF 1 · Vision casting",
    verdict: "good",
    badge: "Going well",
    reading: "Vision Meetings Show Positive Momentum",
    basis: "28 at your latest vision meeting · 24 at the one before",
  },
  {
    csf: "CSF 2 · Shared ownership",
    verdict: "attention",
    badge: "Needs attention",
    reading: "Address Stale Follow-Ups",
    basis: "12 contacts waiting longer than your 14-day follow-up window",
  },
  {
    csf: "CSF 7 · Emerging leadership",
    verdict: "look",
    badge: "Worth a look",
    reading: "Fill Remaining Leadership Role",
    basis: "7 of 8 ministry roles filled",
  },
];

const VERDICT_CLASS: Record<Verdict, string> = {
  good: "v-good",
  attention: "v-attention",
  look: "v-look",
};

export function EngineScorecard() {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);

  return (
    <div ref={ref} className={inView ? "vg-scorecard vg-seen" : "vg-scorecard"}>
      <div className="vg-sc-head">
        <span className="vg-label">Critical success factors</span>
        <span className="vg-asof">As of July 31, 2026</span>
      </div>

      <div className="vg-sc-tiles">
        {TILES.map((tile, i) => (
          <div
            key={tile.csf}
            className={`vg-tile ${VERDICT_CLASS[tile.verdict]}`}
            style={{ "--vg-i": i } as React.CSSProperties}
          >
            <div className="vg-tile-top">
              <span className="vg-tile-k">{tile.csf}</span>
              <span className="vg-badge-slot">
                {/* the unresolved slot — sized by the badge beneath it, so the
                    stamp-in never moves the row */}
                <span className="vg-badge-idle" aria-hidden="true">
                  —
                </span>
                <span className="vg-badge">{tile.badge}</span>
              </span>
            </div>
            <p className="vg-reading">{tile.reading}</p>
            <p className="vg-basis">{tile.basis}</p>
          </div>
        ))}
      </div>

      <p className="vg-sc-foot">1 of 8 needs attention · 2 worth a look</p>
    </div>
  );
}
