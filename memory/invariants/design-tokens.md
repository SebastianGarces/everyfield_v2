# Design Tokens — the Colour Layer

Why and how, for the Design Tokens rules in [`../invariants.md`](../invariants.md).

**Applies to:** `src/app/globals.css` (the token layer), `src/lib/testing/theme-color.ts` (the colour math and token reader), `DESIGN.md` (the design authority the identity guards read), and every stylesheet under `src/app/`.

Four guards, one subject each: token identity and token-on-surface contrast; the focus indicator (SC 1.4.11 rather than AA); what SHIPS, meaning `.tsx` markup and the other stylesheets; and the person-status badge scale, whose colours come from Tailwind's own palette and `badge.tsx` rather than from any token.

## Where a number is allowed to live

`globals.css` says what a token IS and what it is FOR, never what it MEASURES: a measurement in a stylesheet is re-derived by nothing, so it keeps sounding authoritative long after the tokens under it have moved. Measured ratios live in the test that derives them, and only the standard's own thresholds (4.5:1, 3:1) may be named in CSS. Two figures survive in prose because a test re-derives them and requires the comment to name them: **`L ≈ 0.526`**, the lightest neutral L still clearing AA on `--muted`, which an editor must know before touching `--muted-foreground`; and the destructive ring's **`4.65:1 light / 5.31:1 dark`** in `src/components/ui/button.tsx`.

## Identity is a colour comparison, not a luminance one

`contrastRatio(a, b) < 1.01` is not an identity check: contrast is relative luminance, so hue and chroma are discarded first. `oklch(0.5354 0.151 320)` is a **magenta** sitting 1.0058:1 from `#B4432F`, so a luminance guard "proves" the ruled danger red still ships while every error message renders purple; at the ink's chroma, every hue on the wheel passes. `isSameColour` therefore compares gamma-encoded sRGB channel by channel with a one-unit-in-255 tolerance — wide over the round-trip noise between a hex and an oklch spelling of one colour, far under any real colour difference.

The other side of the comparison is **parsed from DESIGN.md at test time**, never typed into the test: a copied hex is the same re-derived-by-nothing failure one level up, so editing `danger:` and stopping there — exactly what the rule instructs — would leave the suite green while the two files disagree. The parse is bounded to the `colors:` block, because DESIGN.md publishes the palette again in a prose table; it is asserted before use, so a renamed key fails loudly instead of degrading the guard to a no-op; and no literal survives, not even as a canary.

## One colour, one owner

`--ink` is the sole declaration of DESIGN.md's `#181D19`; written twice it becomes one colour with ten owners, and darkening the ink leaves nine of them stale in silence. The guard is DERIVED from the `:root` block rather than run against a list of today's aliases — a list catches a token that stops pointing at `--ink`, but not the failure the alias exists to prevent, which is an ELEVENTH token with the literal pasted onto it. `--ink` is deliberately not exported through `@theme inline`: it is the value behind the role tokens, not a colour to paint with.

## `--ef-dark`: a rule about GROUND, not about a number

`--ef-dark` is `var(--ink)` and `.dark` declares no twin on purpose, because the logo tile is the same green in both themes. The cascade therefore hands the dark theme the LIGHT value — right on that tile, catastrophic anywhere else, where ink on dark `--card` is 1.05:1. The guard covers the whole tree, mounted or not.

## What actually paints a Delete button

Radix's `Slot` (`asChild`) **concatenates** `buttonVariants()` with the child's className, and the `cn()` inside the wrapper sees only the caller's classes, so tailwind-merge is never in that path: the DOM carries `bg-primary` and `bg-destructive` at once and **CSS source order** picks primary. Colour math cannot see it and neither can a token check, since both classes are declared and correct in isolation — only a guard over the CALL SITE sees it. Pass `variant="destructive"`; never a raw `bg-red-*`, never a second same-group utility. `--destructive-foreground` does not exist, because the variant hardcodes `text-white`.

## Two DECISIONs, recorded rather than decided

1. **`--destructive` headroom.** The AA limit on `--muted` at the ruled hue and chroma is L 0.5432 and DESIGN.md's `danger` is L 0.5354 — 0.008 of lightness, where `--muted-foreground` keeps a real step. Thin because the colour is RULED: buying a step means darkening below DESIGN.md.
2. **`bg-destructive/10 text-destructive`**, twelve shipped call sites. The tint is made from the token it carries, so ink and backdrop darken together and NO token value fixes it; the remedy is a solid ground or a text-on-tint role token.

Measuring is not deferred: the failing tints are held to their exact numbers in `DEFERRED_DESTRUCTIVE_TINTS` with an INVERTED assertion, so an entry that starts passing fails too and the ledger holds only what is open.

## The status badge scale

Ruled direction: **tinted editorial** — every status that carries colour paints ONE hue three ways (pale ground, deep ink, hairline border) and the dark theme mirrors it. Two named exceptions: **Prospect stays neutral**, the pipeline's zero, on the token-backed `secondary` variant; and **Attendee and Launch Team stay on ONE hue** separated by tint LEVEL, the hue split having been offered and declined. Badges carry `variant="outline"` so exactly one ground, one ink and one border reach the DOM, and there is no hover fill — a badge is not a control.

Its guard is a separate suite because its source of truth differs: `bg-blue-50` is not a token, so the palette is read out of Tailwind's own `theme.css` and no number is typed. It pins the SHAPE as well as AA for all fourteen status/theme pairs: six classes per tinted status stated in BOTH themes (a missing `dark:` twin inherits the light value — the `--ef-dark` trap one layer out), one hue family, and the mirror asserted by MEASURED luminance rather than by step numbers. **There is no deferral list here and none may be added:** a scale that cannot clear 4.5:1 is a ruling to reopen. The defect that produced the scale was found in a browser, because the repo-wide guards were all shaped to the tokens and a 1.91:1 fill sat outside the token layer entirely.

## Why `src/lib/testing/` is not scanned by the markup walk

Test-only support code is not markup, so the walk skips that whole directory as it skips `.test.tsx?`. Otherwise the guards scan their own implementation, and every utility class a module there NAMES in order to describe a rule reads as a shipped USE of it. The skip is a **directory**, never a path equality on one file: an equality stops matching on a rename in silence and leaves the identical hole open for that module's neighbours.
