---
target: the landing page
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-08-01T16-55-57Z
slug: src-app-marketing-page-tsx
---
> **Status (2026-08-02):** historical snapshot — this critique ran against the pre-#256 page.
> PR #256 (merged 2026-08-02) addressed all four P1s: /terms + /privacy pages shipped (verified
> 200 in production), stats source line + footer mailto added, hero clamp floor fixed
> (two-stage clamp in marketing.css), networks section got the net-health product shot, overlays
> re-cut (r8-*) with the fswitch rework, and tablist arrow keys landed (use-tablist-keys.ts).
> Not adopted: the "free during the alpha" CTA line — the CTA says "early access with a small
> cohort" instead, consistent with the org-pays-per-plant ruling (#192/#193).

Method: dual-agent (A: design review sub-agent · B: detector/browser sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Invite success has no role="status"/aria-live, no focus move; pending state is button label only |
| 2 | Match System / Real World | 3 | "Named, never numbered" phases violated by mobile "PHASE 0 · DISCOVERY" markers and in-shot "Phase 6: Post-Launch"; ChMS/4 C's/4 Pillars never expanded |
| 3 | User Control and Freedom | 2 | Mistyped email unrecoverable (success is terminal); Sign in vanishes below 800px with no replacement |
| 4 | Consistency and Standards | 2 | 13 role="tab" elements, zero role="tabpanel"; no aria-controls/roving tabindex/arrow keys; invite label is clipped against DESIGN.md's visible-label rule |
| 5 | Error Prevention | 3 | type=email + required + autocomplete + honeypot solid; no typo assist |
| 6 | Recognition Rather Than Recall | 3 | All controls labeled, 37/37 real alt texts; no active-section cue on a 6,339px page; mobile hides nav |
| 7 | Flexibility and Efficiency | 2 | Two tab groups, no arrow-key support (verified: ArrowRight moves nothing); 11,855px mobile scroll, no jump links |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely disciplined; held back by overlays on legible text and ~45% dead right column ×3 sections at 1440 |
| 9 | Error Recovery | 2 | Email-format error excellent (role="alert"); server error is a dead end (no contact route anywhere) |
| 10 | Help and Documentation | 1 | No pricing/eligibility/timeline/FAQ/contact; Terms and Privacy both 404 |
| **Total** | | **23/40** | **Acceptable (57.5%)** — high visual craft on a thin trust-and-semantics layer |

## Design Specificity Verdict

**AUTHORED — clears the bar, one interchangeable module.** Cover the logo and the page is still identifiable: real phase vocabulary, commissioned field paintings with green registration squares, Newsreader/Outfit-400 pairing, radius-0 held everywhere, named fictional cast in real screenshots. The interchangeable module is the stats block (86–90% / 68%): unsourced, product-free, could sit on any B2B page. Biggest missed opportunity: the differentiating mechanism (the engine reading real activity) is described but never legibly shown — engine screenshots render at ~10–11px effective text.

**Deterministic scan:** CLI 5 advisory findings (3 font sizes off ramp, #000 hover off-token, 16px frame radius vs DESIGN.md's radius-0 ruling — the last is doc drift, the code comment records a later ruling). URL scan found the one real bug: **hero h1 overflows its box by 23px at 390px** (clamp floor 46px too wide for the column; iPhone 12–14 width; no page h-scroll, but the margin breaks). Confirmed false positives: line-length (detector measures container capacity, not rendered lines), transition:height (dead Tailwind utility from the shared bundle, no element animates height), heading clamp (documented verbatim in DESIGN.md), all-caps kicker (the sanctioned marker token).

**Visual overlays:** injection into the live preview succeeded technically, but the overlay landed on the other assessment's tab in the shared browser and was cleared without being read; no user-visible overlay tab exists. Detector evidence came from detect.mjs URL mode (own browser) instead — race-free and complete.

## Priority Issues

1. **[P1] Trust layer is unattributed and its two links are dead.** /terms and /privacy 404 on a page collecting emails; stats unsourced; no contact route anywhere; free-in-alpha never stated. Fix: stub legal pages, source line under stats, footer mailto, one line at CTA ("Free during the alpha..."). → /impeccable harden
2. **[P1] Overlay cards land on legible product text in four panes + hero.** People overlay cuts a person card mid-row; Guides flush crop cuts headings mid-word ("…erson"); Training overlay chops the matrix heading; engine popover slices sentences; hero chip covers the shot's phase label and restates a visible number. Fix: re-place overlays onto chrome/whitespace/card boundaries; re-cut flush crop on a column edge; new hero chip claim; replace the Guides empty-state primary. → /impeccable polish
3. **[P1] Hero headline overflows by 23px at 390px** (measured; 0px at 414px). Fix the clamp floor / wrap of "understood." → /impeccable adapt
4. **[P1] The buyer-facing networks section is the only one with no product visual** — the network admin who pays sees prose + two stat cells while every other audience sees the app. Fix: oversight portfolio screenshot on a c2 pane; sharing-control view as overlay makes the privacy claim true on screen. → /impeccable layout
5. **[P2] Tablist ARIA contract announced but not implemented** — role="tab" without tabpanel/aria-controls/roving tabindex/arrow keys makes it worse than plain buttons. → /impeccable harden

## Persona Red Flags

**Jordan (first-timer):** no pricing/eligibility answer before the email ask (true answers exist and are good); ChMS/4 C's/4 Pillars unexplained; success message never announces itself; typo'd email unfixable.
**Riley (stress tester):** Privacy→404, Terms→404; unsourced stats discount accurate claims; three naming systems for the same seven phases (tab "Beyond" vs shot "Phase 6: Post-Launch"; "eight ministry areas" vs "eleven ministry teams"); arrow keys contradict visible state; empty state used as proof; tab state not in URL, nothing shareable.
**Casey (mobile):** 11,855px scroll (~14 screens, 87% more than desktop); Sign in gone below 800px; email input ~40px tall (<44pt) as the most important target; hero crop shows a clipped card as first product evidence; no state persistence.

## Minor Observations

- ~45% dead right column ×3 consecutive sections at 1440 (26ch h2 / 56ch body caps in a 1,296px container).
- Engine CSF grid at ~10–11px effective text — the core differentiator is the least readable artifact.
- "Guides & documents" only multi-word tab, overflows its flex cell.
- Anchor links land under the fixed nav (no scroll-margin) — clipped headline after the first click.
- Token drift: `.btn.primary:hover` #000 (should be ink), `.engine-pull` 22px and `.stat-cell .n` 56px off the ramp; 16px frame radius is a ruled exception that needs recording in DESIGN.md.
- Invite input's only label is clipped; placeholder dies on first keystroke.
- `.pjourney` numbers phases on mobile while desktop names them.
- 9 em-dashes in body text (19 at mobile) — voice risk, reads AI-ish in aggregate.

## Questions to Consider

1. What is the ONE readable artifact that proves the mechanism? A legible CSF card at hero scale with its real sentence would out-persuade the whole engine section.
2. If the two statistics were deleted tomorrow, would the page be weaker or stronger? "Truth over theater" is the product's own principle.
3. Mobile gets 87% more page than desktop — which one is the real design? Does mobile want a swipe deck, a phase select, or three features instead of six?
