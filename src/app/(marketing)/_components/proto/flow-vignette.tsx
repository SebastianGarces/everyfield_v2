// PROTOTYPE — landing story ruling. This file is deleted when the ruling lands;
// no part of it may be imported outside the (marketing) prototype.

import { VignetteGate } from "../vignettes/vignette-gate";

/**
 * Variant D's single visual — and the only proof the whole variant offers.
 *
 * D's premise is that a planter who is not software-minded needs one honest
 * picture of a week, not sixteen scaled-down app surfaces. So this is a
 * MARKETING VIGNETTE, not an app embed: a distillation of a moment in
 * marketing-owned DOM on marketing tokens (the second of the two kinds
 * marketing.css describes). It is a claim ABOUT the product rather than the
 * product, which is the honest register for a picture nobody could read at
 * this size anyway.
 *
 * Four moments down one ink hairline that draws itself as each card lands. The
 * third card is a SECOND copy of the second card's list rather than the same
 * list animating its own state — the page is telling you what happened between
 * Wednesday and Friday, and two frames say that more plainly than one frame
 * that changes while you look away.
 *
 * Server component. `VignetteGate` is the only client part; it takes the
 * timeline as children and adds `vg-seen` once the vignette is on screen, and
 * every animation in the fenced block hangs off `.jr-flow.vg-seen`. Base
 * styles are the finished frame and each keyframe supplies only its `from`, so
 * a gate that never fires — no JavaScript, reduced motion — is a completed
 * vignette rather than an empty one.
 *
 * Nothing inside is interactive: the checkboxes are drawn, not rendered, so
 * there is nothing here to focus, tab to or click.
 */

const FOLLOWUPS = [
  "Call the Riveras",
  "Coffee with Sam",
  "Text Dana about Sunday",
] as const;

/** The step index drives every delay in the fenced block, so the four moments
 *  stay 900ms apart wherever the vignette is dropped. */
function stepVars(i: number) {
  return { "--jr-i": i } as React.CSSProperties;
}

function Followups({ done = false }: { done?: boolean }) {
  return (
    <ul className="jr-flow-rows">
      {FOLLOWUPS.map((task, i) => (
        <li
          key={task}
          className={done ? "jr-flow-row is-done" : "jr-flow-row"}
          style={{ "--jr-r": i } as React.CSSProperties}
        >
          {/* drawn, not rendered: a real checkbox here would be a control that
              does nothing, in the tab order, on a page about not scrambling */}
          <span className="jr-flow-box" aria-hidden="true" />
          <span className="jr-flow-task">{task}</span>
        </li>
      ))}
    </ul>
  );
}

export function FlowVignette() {
  return (
    <VignetteGate className="jr-flow" threshold={0.2}>
      {/* the hairline the moments hang from — it draws downward as they land */}
      <span className="jr-flow-rule" aria-hidden="true" />
      <ol className="jr-flow-list">
        <li className="jr-flow-step" style={stepVars(0)}>
          <p className="jr-flow-when">Tuesday night</p>
          <div className="jr-flow-card">
            <p className="jr-flow-title">Vision night</p>
            <p className="jr-flow-count">
              <span className="jr-flow-n">24</span> families in a living room
            </p>
          </div>
        </li>

        <li className="jr-flow-step" style={stepVars(1)}>
          <p className="jr-flow-when">Wednesday morning</p>
          <div className="jr-flow-card">
            <p className="jr-flow-title">Three first-time visitors</p>
            <Followups />
          </div>
        </li>

        <li className="jr-flow-step jr-flow-done" style={stepVars(2)}>
          <p className="jr-flow-when">By Friday</p>
          <div className="jr-flow-card">
            <Followups done />
          </div>
        </li>

        <li className="jr-flow-step" style={stepVars(3)}>
          <p className="jr-flow-when">Sunday&rsquo;s coming</p>
          <div className="jr-flow-card">
            <p className="jr-flow-read">
              &ldquo;Your group grew again this month. You&rsquo;re on
              track.&rdquo;
            </p>
            <p className="jr-flow-foot">EveryField · this week&rsquo;s read</p>
          </div>
        </li>
      </ol>
    </VignetteGate>
  );
}
