import { CheckIcon } from "lucide-react";

import {
  MaterialsChecklistView,
  type MaterialsChecklistItemView,
} from "@/components/meetings/materials-checklist-view";

import {
  LAUNCH_PREP_COMPACT,
  LAUNCH_PREP_DESKTOP,
  LAUNCH_PREP_SUMMARY,
} from "./launch-prep-fixture";

/**
 * Pre-launch — the app's own preparation checklist, rendered live.
 *
 * This replaces two things at once: the pt-prelaunch capture the panel stood
 * on, and the hand-drawn checklist card that floated over it. The drawn card
 * was a marketing distillation of this exact surface — a progress count, a
 * bar, four rows with boxes — so keeping it beside the real component would
 * have been the same claim twice, once in the product's voice and once in an
 * imitation of it. What renders now is
 * `components/meetings/materials-checklist-view.tsx` fed the checklist
 * Redemption Hill's Launch Sunday meeting actually has (see
 * launch-prep-fixture.ts): 4 of 8 ready, the same four rows the drawn card
 * drew, in the app's own type.
 *
 * WHY `renderControl`. The view's default control is the app's shadcn
 * Checkbox, which is a Radix client component: rendering it here would put a
 * focusable control inside a picture and ship its island to a page that must
 * not offer it. The slot below is a static replica — same box, same 4px
 * radius, same checked fill and check glyph, at the same `size-4` — with no
 * state, no handler and nothing to focus. It keeps `id={item.id}` because the
 * view binds each row's <label> to its control with `htmlFor`, which is the
 * documented contract for a custom control.
 *
 * `data-checked` on that replica is the animation's only hook: marketing.css
 * resolves the rows that are done from open to struck, which is the app's real
 * state arriving rather than a number this page made up. The count and the bar
 * are the meeting's own and never move.
 *
 * Two compositions:
 *
 *   - Desktop gets the progress card and two category cards. Not all five: the
 *     full checklist renders the app's type at ~8px in this pane, which is
 *     worse than the capture it replaces.
 *   - Below 900px, the progress card and Materials — three real rows at the
 *     app's real size, with marketing chrome for the rest.
 *
 * Server component on purpose, and `inert` sits inside the `role="img"` mount
 * so the mount keeps its accessible name while its contents keep none.
 */

const CHECKLIST_LABEL =
  "The Launch Sunday preparation checklist — 4 of 8 ready; promo cards mailed and signage ordered struck through, greeters and bulletins still open.";

const CHECKLIST_COMPACT_LABEL =
  "Three materials on the Launch Sunday checklist — promo cards mailed and signage ordered, bulletins still to print — under a 4 of 8 progress bar.";

/**
 * The app's checkbox at rest, with nothing that runs. Classes are lifted from
 * components/ui/checkbox.tsx so the box is the same box; only the parts that
 * exist for interaction (focus ring, cursor, disabled, transition) are gone,
 * because none of them can ever apply here.
 */
function InertCheckbox(item: MaterialsChecklistItemView) {
  return (
    <span
      id={item.id}
      data-slot="checkbox"
      data-checked={item.isChecked ? "true" : "false"}
      aria-hidden="true"
      className={
        item.isChecked
          ? "bg-primary text-primary-foreground border-primary size-4 shrink-0 rounded-[4px] border shadow-xs"
          : "border-input dark:bg-input/30 size-4 shrink-0 rounded-[4px] border shadow-xs"
      }
    >
      {item.isChecked ? (
        <span
          data-slot="checkbox-indicator"
          className="grid place-content-center text-current"
        >
          <CheckIcon className="size-3.5" />
        </span>
      ) : null}
    </span>
  );
}

export function LaunchPrepChecklist() {
  return (
    <div className="vg-embed-mount vg-prelaunch">
      <div className="vg-embed-full">
        <div className="vg-app-embed" role="img" aria-label={CHECKLIST_LABEL}>
          <div inert>
            <MaterialsChecklistView
              items={LAUNCH_PREP_DESKTOP}
              summary={LAUNCH_PREP_SUMMARY}
              renderControl={InertCheckbox}
            />
          </div>
        </div>
      </div>

      <div className="vg-embed-compact">
        <div className="vg-sc-head">
          <span className="vg-label">Preparation progress</span>
          <span className="vg-asof">Launch Sunday</span>
        </div>
        <div
          className="vg-app-embed"
          role="img"
          aria-label={CHECKLIST_COMPACT_LABEL}
        >
          <div inert>
            <MaterialsChecklistView
              items={LAUNCH_PREP_COMPACT}
              summary={LAUNCH_PREP_SUMMARY}
              renderControl={InertCheckbox}
            />
          </div>
        </div>
        {/* the five rows this width leaves out, in the marketing voice */}
        <p className="vg-sc-foot">
          Five more across Essential, Setup, AV and Organization — the sound
          check and the dry run already done.
        </p>
      </div>
    </div>
  );
}
