import { TeamCardView } from "@/components/ministry-teams/team-card-view";
import { TrainingMatrix } from "@/components/ministry-teams/training-matrix";

import {
  CHILDRENS_MINISTRY_TEAM,
  TRAINING_MATRIX,
  TRAINING_MATRIX_COMPACT,
  TRAINING_PROGRAMS,
  TRAINING_PROGRAMS_COMPACT,
} from "./team-training-fixture";

/**
 * Training — the app's own training matrix and team tile, rendered live.
 *
 * The phase panel used to be a screenshot of a team's Training tab with a
 * second screenshot of two team cards floated over it. This is both of those
 * for real: `components/ministry-teams/training-matrix.tsx` and
 * `components/ministry-teams/team-card-view.tsx`, fed the grid and the tile
 * Redemption Hill's Children's Ministry actually has (see
 * team-training-fixture.ts). Pixel-identical to the product by construction —
 * the landing page cannot drift into showing a grid the app does not render.
 *
 * The primary and the floating card come back as ONE fragment because the
 * panel's `.pshot` is their shared positioning context: the mount is the flex
 * child that centres, the card is absolutely positioned over the painting
 * beside it (marketing.css). The card is the panel's overlay in every sense
 * that mattered before — desktop-only, landing after the primary settles —
 * except that it is now the app's tile rather than a picture of one.
 *
 * `incompleteCell` is deliberately not passed. In the app it is the button
 * that marks a training complete; without it the grid draws the identical
 * marker as an inert span, which is exactly what a landing page wants.
 *
 * Two compositions, because a three-column grid on a phone is a wall of type:
 *
 *   - Desktop gets the whole grid: six members against both programs.
 *   - Below 900px it keeps ONE program — the team's own — and the four members
 *     whose rows show both answers, inside marketing chrome that says what the
 *     other column and the other two members are. Still the app's table; just
 *     the minimum of it that gets the idea across.
 *
 * Server component on purpose: nothing here is stateful, and the panel's own
 * `.pt-seen` gate drives the entrance, so no `VignetteGate` is involved and no
 * app component crosses into the client bundle. `inert` sits INSIDE the
 * `role="img"` mount rather than on it, because inert also removes its subtree
 * from the accessibility tree — on the mount it would take the picture's own
 * name with it. Here the mount keeps its name and its contents (the team
 * tile's `next/link` above all) stop being reachable.
 */

const MATRIX_LABEL =
  "The Children's Ministry training matrix — who has completed kids ministry & safety training and the Launch Team Orientation, member by member.";

const MATRIX_COMPACT_LABEL =
  "Four Children's Ministry members against kids ministry & safety training — three complete, one still open.";

const TEAM_LABEL =
  "The Children's Ministry team card — Aisha Carter leading, 2 of 7 roles filled, five still open.";

export function TeamTraining() {
  return (
    <>
      <div className="vg-embed-mount vg-training">
        <div className="vg-embed-full">
          <div className="vg-sc-head">
            <span className="vg-label">Children&rsquo;s Ministry</span>
            <span className="vg-asof">Training matrix</span>
          </div>
          <div className="vg-app-embed" role="img" aria-label={MATRIX_LABEL}>
            <div inert>
              <TrainingMatrix
                programs={TRAINING_PROGRAMS}
                matrix={TRAINING_MATRIX}
              />
            </div>
          </div>
        </div>

        <div className="vg-embed-compact">
          <div className="vg-sc-head">
            <span className="vg-label">Children&rsquo;s Ministry</span>
            <span className="vg-asof">Training matrix</span>
          </div>
          <div
            className="vg-app-embed"
            role="img"
            aria-label={MATRIX_COMPACT_LABEL}
          >
            <div inert>
              <TrainingMatrix
                programs={TRAINING_PROGRAMS_COMPACT}
                matrix={TRAINING_MATRIX_COMPACT}
              />
            </div>
          </div>
          {/* the column and the members this width leaves out */}
          <p className="vg-sc-foot">
            Two more members, and the church-wide Launch Team Orientation beside
            it.
          </p>
        </div>
      </div>

      <div className="vg-card vg-embed-card vg-teamcard">
        <div className="vg-app-embed" role="img" aria-label={TEAM_LABEL}>
          <div inert>
            {/* the whole tile is an anchor to /teams/<id>, which is behind the
                login this page sells. Inert already makes it unreachable; the
                href is aimed back at this page so the markup does not carry a
                dead app route into a public document either. */}
            <TeamCardView team={CHILDRENS_MINISTRY_TEAM} href="/" />
          </div>
        </div>
      </div>
    </>
  );
}
