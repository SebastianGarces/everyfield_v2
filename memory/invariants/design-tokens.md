# Design Tokens — the Colour Layer

Why and how, for the Design Tokens rules in [`../invariants.md`](../invariants.md).

**Applies to:** `src/app/globals.css` (the token layer), `src/app/theme-color.ts` (the shared colour math and token reader), and every stylesheet under `src/app/`.

**Pinned by:** three suites, one subject each — `src/app/theme-tokens.test.ts` (token identity, token-on-surface contrast), `src/app/focus-ring.test.ts` (the focus indicator, SC 1.4.11 rather than AA), `src/app/text-contrast.test.ts` (what SHIPS: `.tsx` markup and the other stylesheets).

## Where a number is allowed to live

`globals.css` says what a token IS and what it is FOR. It does not say what a token MEASURES.

This is the #357 defect generalised. #357 was one wrong figure (`L 0.5055`) in the comment whose whole job was to be right — it understated the headroom rather than overstating the margin, so nothing unsafe shipped, but nothing had checked it either. The answer to that is not "write the figures more carefully". A measurement in a stylesheet is re-derived by nothing: it is correct on the day it is typed, and it keeps sounding authoritative long after the tokens under it have moved. The #411 pass proved the point by reproducing it — it doubled the file's comments and left about twelve fresh, correct, unchecked measurements behind.

So every measured ratio lives in the test that derives it, and `theme-tokens.test.ts` fails `globals.css` for naming any ratio that is not one of the standard's own thresholds (4.5:1, 3:1) — those are constants, not measurements, and the guard reads them from the constants rather than from a list.

Two figures survive in prose because a test requires them to:

- **`L ≈ 0.526`**, the lightest neutral L that still clears AA on `--muted`, is the one thing an editor must know before touching `--muted-foreground`. `theme-tokens.test.ts` bisects for it, requires the comment to name it, and requires the comment NOT to name the old wrong 0.5055.
- **The destructive ring's `4.65:1 light / 5.31:1 dark`** in `src/components/ui/button.tsx`. `focus-ring.test.ts` reads those two numbers back out of the comment and re-computes them from the tokens, so the sentence cannot drift away from the values it argues from.

## Identity is a colour comparison, not a luminance one

Two assertions tie `globals.css` to DESIGN.md: `--ink` is the ruled ink, and `--destructive` is the ruled `danger`. They are the only mechanism stopping the palette and the app from separating, and the obvious way to write them does not work.

`contrastRatio(a, b) < 1.01` is not an identity check. Contrast is relative luminance, so hue and chroma are discarded before the comparison happens:

- `oklch(0.5354 0.151 320)` is a **magenta**, and it sits 1.0058:1 from `#B4432F`. A luminance guard "proves" the ruled danger red still ships while every error message renders purple.
- At the ink's chroma, **every** hue on the wheel passes.

`isSameColour` (`src/app/theme-color.ts`) therefore compares gamma-encoded sRGB channel by channel, with a one-unit-in-255 tolerance. That is wide over the round-trip noise between a hex and an oklch spelling of one colour (the two real pairs measure 0.109 and 0.058 apart) and far under any real colour difference. `theme-tokens.test.ts` mutates both tokens off-hue and asserts the guard now fails, so the guard cannot quietly go back to luminance.

## One colour, one owner

`--ink` is the sole declaration of DESIGN.md's `#181D19`. It used to be written twice — the hex on a brand token, `oklch(0.224 0.011 151.267)` on nine role tokens — which is one colour with ten owners and nothing in the file saying they were the same value. Darken the ink and nine of them go stale in silence.

The guard is DERIVED from the `:root` block rather than run against a list of the tokens that point at `--ink` today. A hand-kept list catches a token that STOPS pointing at the alias; it cannot catch the failure the alias exists to prevent, which is an ELEVENTH token with the literal pasted onto it — exactly how the ten copies accumulated. A list also has to be edited by hand whenever a role token is added, so it goes stale itself: the same defect, moved out of the CSS and into the test.

`--ink` is deliberately NOT exported through `@theme inline`. It is the value behind the role tokens, not a colour to paint with; there is no `text-ink`. Paint with the role.

## `--ef-dark`: a rule about GROUND, not about a number

`--ef-dark` is `var(--ink)`, and `.dark` declares no twin on purpose — the logo tile is the same green in both themes, so the ink that reads on it does not invert. The cascade therefore hands the dark theme the LIGHT value, which is right on the green tile and catastrophic anywhere else: ink on dark `--card` is 1.05:1, text nobody can see.

`people/status-timeline.tsx` had exactly that line on its current-step label. It was LATENT rather than shipped — the component has no call sites — and it was corrected anyway, because "nothing renders it today" is not a property anyone maintains. The guard is over the whole tree, mounted or not.

## What actually paints a Delete button

The `#411` defect was never a missing token, and the first fix (restoring `--destructive-foreground`) changed nothing about what rendered.

`AlertDialogAction` and `AlertDialogCancel` wrap `Button` with `asChild`. Radix's `Slot` **concatenates** `buttonVariants()` with the child's className, and the `cn(className)` inside the wrapper is handed only the CALLER's own classes — it never sees the variant's. tailwind-merge was therefore never in the path and deleted nothing: the DOM carried `bg-primary text-primary-foreground` AND `bg-destructive text-destructive-foreground` at once, and **CSS source order** picked primary. Five Delete buttons rendered the neutral ink fill in both themes while every token assertion passed. A fifth site had the same defect in another spelling — `tasks/[id]/task-detail-actions.tsx` painted raw `bg-red-600`, off-token and off DESIGN.md — and lost to primary for the same reason.

Colour math cannot see this and neither can a token check: both classes are declared, and both are correct in isolation. The only guard that sees it is one over the CALL SITE, and the call-site guard is what found the fifth one. All five now pass `variant="destructive"`, so one variant supplies the colour and no two same-group utilities reach the DOM at all.

`--destructive-foreground` was added in the same pass under the "an undeclared `*-foreground` utility emits no CSS" rule, then removed once that rule's converse turned out to be false: nothing paints it (the variant hardcodes `text-white`), so the token had zero shipped users and existed only to satisfy a mechanism the next commit disproved.

## The DECISIONs carried out of #411

Both are recorded rather than decided, because both are design rulings and not a sweep's call.

1. **`--destructive` headroom.** The AA limit on `--muted` at the ruled colour's chroma and hue is L 0.5432; DESIGN.md's `danger` is L 0.5354. The headroom is 0.008 of lightness, where `--muted-foreground` deliberately keeps a real step. It is thin because the colour is RULED, not chosen — buying a step means darkening below DESIGN.md.
2. **`bg-destructive/10 text-destructive`.** Twelve shipped call sites (eleven error banners plus `ui/dropdown-menu.tsx`, which focuses to `/10` light and `dark:/20` dark). The tint is made from the token it carries, so ink and backdrop darken together and NO token value fixes it. The remedy is a solid ground (`csf-scorecard.tsx` sets the precedent) or a text-on-tint role token.

What is not deferred is MEASURING it. `theme-tokens.test.ts` reads every shipped tint out of the markup, checks it on all eight surfaces, and holds the failing ones to their exact number in `DEFERRED_DESTRUCTIVE_TINTS` — with an INVERTED assertion, so a deferred entry that starts passing fails the suite too and the ledger only holds what is genuinely still open. A new call site, a new alpha or a token move fails loudly instead of passing quietly.

## Why `theme-color.ts` is not scanned by its own walk

`markupLines()` and `tsxFiles()` scan shipped `.ts`/`.tsx` under `src/`. `theme-color.ts` sits under `src/app/` but is test-only support code, so the walk skips it, exactly as it skips `.test.ts`.

Without the skip the guards scan their own implementation, and every utility class the module has to NAME in order to describe a rule reads as a shipped USE of it — the module fails the tests it powers. The only defence then available is a comment asking future authors to describe the rules without naming them, which is a hazard held off by good manners.
