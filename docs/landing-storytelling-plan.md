# Landing storytelling redesign — plan

**Status: RULED 2026-08-01 (direction + all four open questions). Not yet built.**
Sequencing ruling: merge PR #248 (real-screenshot swap) first; this plan is a
follow-up PR series on top of it. The #248 capture rig and 2880×1800 masters
become crop sources here.

## Why (the Intercom findings)

Measured 2026-08-01, intercom.com vs our PR #248 preview, same crawler
(1440×900 desktop / 393×852 mobile, DOM bounding boxes of media > 30vw wide):

| | Intercom | Ours |
| --- | --- | --- |
| Desktop: product/media area as % of page | **30%** (11 distinct visuals, 14,895px page) | 22% (4 visuals, 5,811px — and half of it is painting, not UI) |
| Mobile: same | **37%** (20 visuals — MORE product on mobile) | **11%** (4 visuals, all illegible) |
| Desktop hero UI width | **81vw** (1173px) | 68vw (980px) |
| Feature-section UI width | 41–81vw | **32–34vw** (459–490px) |

The deeper difference is grammar, not size:

1. **Crops, not windows.** Intercom never shows a full app window scaled down.
   Every visual is a composition of 1–3 cropped panels sized so the text
   *inside the UI* is readable. Zoom varies with the story — one chat message
   can be the entire visual. We scale a 1440px window into 490px (2.9× down)
   and every word inside dies.
2. **Bleeds.** Their UI runs off the container edge (signals "there's more"
   while buying scale).
3. **Explainer chips.** Floating annotation cards sit ON the screenshots and
   carry the claim (their "CX rating: 4" chip over Topics Explorer).
4. **Interaction moments.** Visuals are frozen mid-action: cursor visible,
   text selected, Copilot popover open. The story is "what it feels like to
   use," not "what the screen contains."
5. **Vignettes on art.** Their strongest sections are 2–3 chat bubbles + one
   AI-summary card on an art background — zero app chrome. (Their art cards
   even carry small corner marks — our corner-mark language is compatible.)
6. **Mobile recomposes, never shrinks.** Each visual is re-cropped for 393px;
   the tab strip becomes a scroll-snap carousel with the next tab peeking;
   count of visuals goes UP on mobile.
7. **Story arc.** Hero claim → architecture story (4 beats) → the AI agent →
   three "jobs" sections (each: one claim + one big visual + a 3-item
   accordion) → trust → pricing → CTA. Every section = one claim, one proof.

## Storytelling direction (RULED)

**One church, one month, one page.** The page walks Redemption Hill from first
contact to launch Sunday — the same named cast (Sam Torres, the Riveras, Dana
Whitfield, Grace Lin) recurring across every section, four weeks out. Intercom
has pattern-perfect sections but no continuity; our seed gives us a narrative
spine they can't have. Trinity Grove appears once, at the end of the journey,
as proof of the other side ("Sunday Gathering · Week 6 · 112").

Arc: hero (the dashboard, 27 days out) → problem statement (unchanged) → **the
work** (4 feature stories = moments in Redemption Hill's week) → **the engine**
(Plant Intelligence reading that same week — gets UI for the first time) →
**the journey** (zoom out: all 7 phases, Trinity Grove closes it) → networks →
CTA.

## Implementation per section

Visual devices (three, used everywhere):

- **Crop** — recrop the existing 2880×1800 masters with sharp (no reshoots);
  per-breakpoint art direction via `<picture>`: desktop gets the composition,
  mobile gets a tighter single-panel crop. Full-window screenshots survive
  ONLY at ≥60vw desktop; on mobile, never.
- **Vignette** — marketing-only React components under
  `(marketing)/_components/vignettes/`, styled with the sharp tokens to look
  like the app but importing NOTHING from the app. Content = real seed cast
  strings. Animation = CSS transitions/keyframes driven by an
  IntersectionObserver scroll trigger + tab activation; `prefers-reduced-motion`
  falls back to the final frame. No Remotion/video/canvas in v1 (RULED:
  animated vignettes, no video).
- **Chip** — absolutely-positioned annotation cards (ink card, green square
  marker, corner-mark language) over crops and vignettes; reveal on scroll.

Sections:

1. **Hero.** Keep the real dashboard capture (LCP: static image, priority).
   Desktop: tighter crop (drop browser dead-space, keep sidebar for "real app"
   credibility) at ~80vw with a bleed past the panel edge + 2 chips ("61
   committed adults", "27 days to launch Sunday"). Mobile: recomposed crop —
   stat row + activity feed only, full-width, readable.
2. **Feature stories (fswitch).** Desktop keeps the switcher interaction, but
   the pane becomes a vignette per feature (RULED: animated vignettes):
   - *People*: Sam Torres card advances Attendee → Committed (badge flip), a
     follow-up task card slides in ("Plays bass — introduce him to the worship
     leader").
   - *Meetings*: Vision Night attendance ticks 18 → 21 → 24 → 28 over a mini
     trend, "Vision Meeting #5 · in 14 days" card lands.
   - *Teams & tasks*: launch checklist items tick; "Reserve school gym" strikes
     through; kanban card drags to Done.
   - *Wiki*: journey line fills to Phase 4; "The Final 3–4 Weeks · 7 min"
     chapter card opens.
   Mobile (RULED: stacked story sections): tabs disappear; each feature is a
   full-width block — vignette first, then title + copy. Nothing behind taps.
3. **Plant Intelligence (ink section).** Add its first UI: a scorecard
   vignette — 3 CSF tiles + one focus card with the REAL assessment copy
   ("Address Stale Follow-Ups · based on 12 contacts waiting longer than your
   14-day window"). Tiles resolve on scroll from neutral → verdict (Going
   well / Needs attention / Worth a look). This is the differentiator section;
   it currently has zero product proof.
4. **The journey (ptabs).** Desktop: keep tabs; visuals grow from ~32vw to
   55–60vw, with two full-bleed beats (~85vw): the Pre-launch checklist and
   the Beyond dashboard. Mix per phase: annotated crops for data-dense screens
   (pipeline board, teams, launch-team list), vignettes for moment-screens
   (checklist ticking to zero, run-sheet timeline 7:30→10:00, Beyond weekly
   ticker). Mobile (RULED: vertical journey scroll): tabs disappear; a stacked
   numbered timeline (echoes the wiki journey line), each phase a compact
   story block, Trinity Grove's "Week 6 · 112" closing it.
5. **Screenshot hygiene rules** (standing): no full-window screenshot under
   60vw; no UI text rendered below ~11px effective; every visual carries at
   most ONE claim; chips carry the claim, captions don't repeat it.
   The 11px floor is what forces the two compositions of the live scorecard
   (see Traps): the whole eight-tile card cannot clear it inside the engine
   pane at any width, so it reads as a card-shaped object on desktop — the same
   read as the capture beside it — and the compact composition carries the
   actual words at real size everywhere the pane is too small for that to work.

## PR series (after #248 merges)

1. **PR A — recomposition:** crops from existing masters, hero + ptab sizing,
   chips system, mobile stacking for both sections (no vignettes yet — crops
   as placeholders). The page reads correctly on mobile after this PR alone.
2. **PR B — vignettes, feature stories:** the 4 fswitch vignettes + scroll
   trigger infrastructure.
3. **PR C — vignettes, engine + journey:** PI scorecard vignette + the 2–3
   journey moment-vignettes.
4. Later / parked: ambient hero film (Remotion), prototype-switcher variants
   if any single section direction needs a side-by-side ruling.

## Traps

- ~~Vignettes must not import app components (bundle + coupling); sharp tokens
  only, `.marketing` scope.~~ **Superseded 2026-08-04 (ruling).** A
  presentational, server-only app component MAY be rendered live in marketing,
  fed by a typed fixture snapshotted from a real report — and that is now the
  PREFERRED way to show an app surface, because it is pixel-identical to the
  product by construction. The standing principle: *render the real app UI;
  show the minimum amount of it that gets the idea across* (the whole scorecard
  on desktop, a three-tile composition of the same real tiles on mobile). No
  `"use client"` on anything that renders the app component — a small client
  gate takes it as `children`, so it never reaches the client bundle. Marketing
  keeps owning stylized distillations (the chips, the run sheet, the ticker):
  those are claims about the product, not the product. The trade is the point:
  a live embed tracks the product automatically, so it cannot drift into a lie
  — and it changes when the app component changes.
- `prefers-reduced-motion`: every vignette needs a static final frame.
- The seed's real blemishes ("No contact info" rows, 33% team staffing) are
  invisible at crop scale — crops solve what reseeding would have.
- Keep `cursor-pointer` on all switcher/tab targets (repo rule).
