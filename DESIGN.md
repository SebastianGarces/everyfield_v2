---
version: alpha
name: EveryField — Sharp
description: >-
  Design system for the EveryField marketing surface (the (marketing) landing
  page). Direction ruled 2026-07-30: "sharp" — rectangles and drawn edges, type
  that is light and giant, a serif that does the storytelling, and green spent
  only where it signals. Source of truth: docs/design-catalog.html. Scope is
  marketing only; the in-app UI shares the palette but not the serif or the
  display scale.
colors:
  # Required role tokens
  primary: "#181D19" # ink — CTAs and all reading text
  on-primary: "#FBF8EA"
  accent: "#1CE362" # green — the signal, never a button
  on-accent: "#181D19"
  background: "#FBF8EA" # cream — the page ground
  on-background: "#181D19"
  surface: "#FFFEF6" # card — raised surface
  on-surface: "#181D19"
  danger: "#B4432F"
  primary-hover: "#000000" # button-primary hover deepens to black (see components.button-primary-hover)
  # Brand names (aliases of the roles above, in catalog vocabulary)
  ink: "#181D19"
  green: "#1CE362"
  cream: "#FBF8EA"
  card: "#FFFEF6"
  field-green: "#0B7A3F" # green's text voice on light — links, labels. 5.2:1 on cream
  # Neutrals — green-cast, never gray-blue
  text-secondary: "#4E584F" # ~7:1 on cream
  muted: "#616B62"
  hairline: "rgba(24, 29, 25, 0.12)"
  edge: "rgba(24, 29, 25, 0.30)" # the drawn 1px ring on cards and panels
  # On-ink (dark panel) tokens
  dark-text: "#FBF8EA"
  dark-text-secondary: "rgba(251, 248, 234, 0.64)"
  hairline-dark: "rgba(251, 248, 234, 0.14)"
  # Inputs
  input-surface: "#FFFEF9"
  input-border: "rgba(24, 29, 25, 0.45)"
typography:
  display:
    fontFamily: Outfit
    fontSize: 80px # fluid: clamp(46px, 5.8vw, 80px)
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.03em
  heading:
    fontFamily: Outfit
    fontSize: 46px # fluid: clamp(30px, 3.8vw, 46px)
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: -0.03em
  stat-numeral:
    fontFamily: Outfit
    fontSize: 56px # lining figures — font-variant-numeric: lining-nums
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.03em
  title:
    fontFamily: Outfit
    fontSize: 21px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.015em
  serif-lead:
    fontFamily: Newsreader
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.5
  engine-pull:
    fontFamily: Newsreader
    fontSize: 22px # italic, on ink
    fontWeight: 400
    lineHeight: 1.6
  marketing-body:
    fontFamily: Newsreader
    fontSize: 17.5px
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: DM Sans
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.2
  marker:
    fontFamily: DM Mono
    fontSize: 12.5px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.1em
rounded:
  none: 0px
  DEFAULT: 0px # marketing only — edges are drawn, not implied
  app-default: 10px # authenticated app: shadcn's 0.625rem base radius
  shot-frame: 16px # the one exception: product-screenshot frames (see Shapes)
spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 48px
  xl: 64px
  section: 104px # vertical rhythm between catalog/landing sections
  gutter: 48px # page inline padding at desktop
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 13px 24px
  button-primary-hover:
    backgroundColor: "#000000"
    textColor: "{colors.cream}"
  button-ghost:
    backgroundColor: "{colors.cream}" # visually transparent — sits on the cream ground, 1px ink border
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 12px 22px
  button-ghost-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
  button-on-ink:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
  button-on-green:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.none}"
    padding: 26px 28px
  panel-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.none}"
    padding: 64px 56px
  panel-green:
    backgroundColor: "{colors.green}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: 72px 56px
  input:
    backgroundColor: "{colors.input-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: 11px 14px
  input-error:
    textColor: "{colors.danger}"
    typography: "{typography.caption}"
  marker:
    textColor: "{colors.muted}"
    typography: "{typography.marker}"
  registration-square:
    backgroundColor: "{colors.accent}"
    size: 9px
  link:
    textColor: "{colors.field-green}"
    typography: "{typography.body}"
  section-subtitle:
    textColor: "{colors.text-secondary}"
    typography: "{typography.marketing-body}"
  panel-ink-body:
    textColor: "{colors.dark-text-secondary}"
    typography: "{typography.marketing-body}"
  divider:
    backgroundColor: "{colors.hairline}"
    height: 1px
  divider-on-ink:
    backgroundColor: "{colors.hairline-dark}"
    height: 1px
  ring:
    backgroundColor: "{colors.edge}" # cards/panels draw their edge as a 1px box-shadow ring in this color
    height: 1px
  input-ring:
    backgroundColor: "{colors.input-border}"
    height: 1px
  stat-lead:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    padding: 30px 34px
---

# EveryField — Sharp

## Overview

EveryField helps church planters run the road to launch Sunday — people,
meetings, teams, giving — with a plant-intelligence engine that reads real
progress against a proven methodology. The marketing surface has to feel like
the product's character: **warm, direct, honest about the work**. The voice is
a *grounded shepherd* — short declaratives, concrete nouns, "you" always. We
promise clarity, never growth.

The visual direction is **sharp**, ruled 2026-07-30 after a side-by-side
against a softer rounded direction ("too soft with rounded corners looks
uncared for"). The grammar was extracted live from intercom.com and translated
to our assets: green takes cobalt's job, ink takes black's, Newsreader takes
the serif role. In one line:

> Radius 0 everywhere with drawn 1px edges; display type light and giant
> (Outfit 400 at −3%, line-height 1); Newsreader as the marketing body voice;
> ink rectangle CTAs; green spent only where it signals — registration
> squares, active rules, the current phase, and exactly one solid green
> closing panel per page.

Color arrives through commissioned painterly art, not decoration. Long pages
earn interactive toggles (feature switcher, phase tabs) before they earn more
scroll. Product shots are full CSS app frames with real words standing on the
field paintings — never gray-bar skeletons — until real screenshots exist.

**Scope:** this document governs the marketing surface (`(marketing)` routes).
The in-app UI takes exactly two brand colors — green (the signal) and ink
(text and primary) — while keeping its neutral surfaces. Marketing remains
Sharp. The authenticated app uses shadcn's `0.625rem` base radius and native
component geometry; pills and avatars retain their intentional shapes, and
page-level workspace panels use `rounded-xl`. Newsreader and the giant display
scale never appear in UI.

The authenticated app bar is ink with its light foreground. Its 24px brand
mark is the sole green-on-ink exception. That exception does not license green
text, controls, or general icons on ink.

## Colors

Three brand colors — green, ink, cream — plus a card surface and green-cast
neutrals. Cream is a *true* cream (#FBF8EA): red leads green in the hex, so it
reads warm rather than pale-green.

| Token | Value | Role |
| --- | --- | --- |
| `green` | `#1CE362` | The signal. Registration squares, active rules, current phase, the one solid green closing panel. **Never a button color.** |
| `ink` | `#181D19` | All reading text; CTAs; the one dark panel per page. Carries cream text only. |
| `cream` | `#FBF8EA` | The page ground. |
| `card` | `#FFFEF6` | Raised surface for cards — replaces retired green washes. |
| `field-green` | `#0B7A3F` | Green's text voice on light — links, labels, small accents. |
| `text-secondary` | `#4E584F` | Secondary text. Neutrals stay green-cast; no gray-blues. |
| `muted` | `#616B62` | Captions, annotations, mono labels. |
| `danger` | `#B4432F` | Errors and "don't" marks only. |

### The color law

The allowed dark pairings are **cream-on-ink** and **ink-on-green** — nothing
else. All ratios below are measured (WCAG 2):

| Pairing | Ratio | Verdict |
| --- | --- | --- |
| Ink on cream — all reading text | 16.7:1 | PASS |
| Cream on ink — the dark moment | 16.7:1 | PASS |
| Ink on green — CTA, closing panel | 10.1:1 | PASS |
| Field green on cream — links | 5.2:1 | PASS |
| Text-secondary on cream | ~7:1 | PASS |
| **Green on ink** | 10.1:1 | **BANNED**, except for the authenticated app bar's 24px brand mark. The logo is an identity exception, not a general text, control, or icon pairing. On marketing ink, accents turn cream. |
| **Green on cream (as text)** | 1.7:1 | **FAIL** — illegible. Green is fill-only on light; field-green carries its meaning in text. |

Green tints are allowed as quiet fills at low alpha (e.g. selection tint
`rgba(24,29,25,0.045)`, status pill `rgba(28,227,98,0.16)` with field-green
text — 4.9:1 on the tint, checked). One meaning per color: green signals
state/brand, field-green is interactive text, danger is only ever bad news.

## Typography

Four families, each with one job. Never more, never crossed:

| Family | Job |
| --- | --- |
| **Outfit** | Display and headings only. Weight 400 at display sizes — scale talks, weight doesn't. Section/pillar titles step up to 500. |
| **Newsreader** | The marketing body voice: section subtitles, lead paragraphs, feature/phase descriptions, pull quotes, italic emphasis words. **Never in UI.** |
| **DM Sans** | Working text: buttons, captions, nav links, form labels, stat labels, in-app mock text. |
| **DM Mono** | Annotation: markers, nav in the catalog, timestamps, figure captions. Uppercase with positive tracking. |

The scale (fluid sizes via `clamp()`; front-matter tokens hold the max):

| Token | Spec | Use |
| --- | --- | --- |
| `display` | Outfit 400 · clamp(46px, 5.8vw, 80px) · lh 1 · −3% | The hero line. One per page. |
| `heading` | Outfit 400 · clamp(30px, 3.8vw, 46px) · lh 1.05 · −3% | Section headlines. |
| `stat-numeral` | Outfit 400 · 56px · lh 1 · −3% | Stat cell numerals, lining figures. |
| `title` | Outfit 500 · 21px · lh 1.25 · −1.5% | Feature/phase panel headers. |
| `engine-pull` | Newsreader 400 italic · 22px · lh 1.6 | The engine panel's pull quote. |
| `serif-lead` | Newsreader 400 · 19–20px · lh 1.5 | Pitch leads, hero sub. |
| `marketing-body` | Newsreader 400 · 17.5px · lh 1.6 | Section body prose. |
| `body` | DM Sans 400 · 16px · lh 1.6 | Default working text. |
| `caption` | DM Sans 400 · 14px · lh 1.5 · muted | Footnotes, CTA notes. |
| `label` | DM Sans 500 · 15px | Buttons. |
| `marker` | DM Mono 500 · 12.5px · +10% · uppercase | The registration marker label. |

Craft rules that ship with the type:

- Headings get `text-wrap: balance`; descriptions that orphan get
  `text-wrap: pretty`. Neither in long-form prose.
- Measure caps: display/lead ~54ch, marketing body 56–60ch, section heads 68ch
  max. Never full-width paragraphs.
- Line-height is unitless everywhere; anything wrapping to 3+ lines gets ≥1.4.
- Stats and changing numbers use `font-variant-numeric: lining-nums` /
  `tabular-nums`.
- Negative tracking only at display sizes; positive tracking only on small
  uppercase mono. Body copy gets neither.
- `-webkit-font-smoothing: antialiased` once at the root.
- Sentence case everywhere; uppercase is applied via `text-transform`, never
  typed into copy. No exclamation marks.
- Inputs stay at 16px on mobile viewports (iOS zoom).

## Layout

- **Container:** max-width 1200px, 48px inline gutters at desktop. Landing
  sections use an inner measure of 980px with 56–64px section padding.
- **Rhythm:** 104px between major sections; 44px between a section head and
  its content; component gaps at 20–24px. Increments follow the spacing scale.
- **Landing structure (ruled order):** nav → hero (c1 painting under a
  top-heavy cream veil, left-set) → problem statement → feature switcher →
  ink engine panel (flat) → phase tabs → c2 art band → networks + stats
  (lead stat ink-on-green) → green CTA panel → ink footer.
- **Long pages earn a toggle.** The feature switcher (`fswitch`) replaces the
  pillar card grid; phase tabs (`ptabs`) replace the journey strip + caption.
  Content that would stack becomes an interactive pattern before it becomes
  more scroll.
- **Nav:** cream bar that gains a full-width 1px ink rule on scroll; link
  hovers invert to ink-on-cream → cream-on-ink.
- Grids collapse to one column near 900px; nav links hide below 950px; the
  hero meta grid halves at 700px.
- One idea per section. The dark (ink) panel appears once per page; the green
  panel exactly once, as the close.

## Elevation & Depth

The system is deliberately flat: **edges are drawn, not implied**.

- Structure comes from 1px rings (`edge` at 30% ink) and hairline dividers —
  never from shadows-as-decoration.
- Exactly two functional shadows exist: the app-mock lift
  (`0 0 0 1px rgba(24,29,25,.55), 0 20px 40px -18px rgba(24,29,25,.5)`) that
  seats a product frame on a painting, and the browser-frame shadow on the
  landing mock. Both are earned by "a screenshot sitting on art".
- Radial glows, soft gradients, and green washes are banned ("AI-looking").
  Panels are flat fills. The only gradient in the system is the functional
  cream veil over the hero painting.
- Art panels carry 8px green corner registration marks (top-start,
  bottom-end) instead of elevation.
- Images get a subtle inset outline (`1px rgba(0,0,0,0.1)`) so paintings meet
  cream cleanly.

## Shapes

**Radius 0 throughout marketing.** Marketing buttons, cards, panels, inputs,
avatars, pills, kanban cards, chart bars, browser chrome, and checkboxes are
rectangles by ruling. The authenticated app follows the rounded shadcn geometry
defined in Scope above.

Radius 0 governs marketing UI elements. Product-screenshot frames are the one
exception: a real app shot standing on a painting carries a 16px radius and an
8px white border at 70% (`shot-frame`), so the captured window reads as a
photographed object rather than another panel of the page (recorded 2026-08-01;
ruled in the #252 rounds).

- Defined 1px rings replace rounded softness: `edge` for cards and panels,
  `input-border` (45% ink) for inputs, 55% ink for app-mock frames.
- The registration square is the system's atom: a 9×9px green square before a
  mono label (8px on art-panel corners; 10px in the app-mock brand). On ink
  it turns cream — green never sits on ink.
- Selection indicators are rectangles too: a 3px green top rule on the active
  feature, a 3px green bottom rule under the active phase tab, a 12×3px green
  dash before list items.

## Components

### Buttons

Rectangles, DM Sans 500 at 15px, verb-first sentence-case labels
("Request an invite").

- **Primary:** ink fill, cream text, 13px/24px padding; hover deepens to
  black. Transitions 150ms `cubic-bezier(0.2, 0, 0, 1)` on background and
  color only — never `transition: all`.
- **Ghost:** transparent with a 1px ink border, 12px/22px padding, trailing
  `→`; hover inverts to ink fill.
- **On ink panels:** primary flips to cream fill with ink text.
- **On the green panel:** the button is ink. Green is never a button color.

### The registration marker

DM Mono 500, 12.5px, uppercase, +10% tracking, muted — set after a 9×9 green
square (19px start padding). The accent spent the way Intercom spends cobalt.
On ink: label goes `dark-text-secondary`, square goes cream.

### Cards (`pillar-item`)

Card surface `#FFFEF6`, 1px `edge` ring, radius 0, 26–28px padding. Header
pattern: field-green mono kicker → Outfit 500 19px title → 14.5px
text-secondary body. No washes, no decorative shadows.

### Inputs

`#FFFEF9` fill, 1px border at 45% ink, radius 0, 11px/14px padding. Always a
visible bold label; placeholder shows the expected format
("name@church.org"); a hint line in muted below. Focus: border turns
field-green with a 3px `rgba(11,122,63,0.2)` ring — visible, not
color-only.

### Journey strip (`phases`)

Seven named stops — Discovery, Core group, Launch team, Training, Pre-launch,
Launch Sunday, Beyond — **named, never numbered**. 14px square dots on a
hairline: done = ink fill, current = green fill with ink border (a licensed
green appearance), future = cream with 30% ink border.

### Feature switcher (`fswitch`)

Two columns (1.5fr shot / 1fr list; stacks under 900px). The shot is the
hero: a full CSS product frame with real words, standing on the per-feature
painting (people/meetings/teams/giving swap the backdrop; c1 is the
fallback). Selection is a whisper — 3px green top rule + `rgba(24,29,25,.045)`
tint; the active item reveals its Newsreader description. `role="tablist"`
with `aria-selected` maintained. Real screenshots replace the mocks when the
app ships.

### Phase tabs (`ptabs`)

Mono uppercase tabs on a hairline; the active tab carries a 3px green rule
the full width of its cell. Each panel: Outfit 500 title, Newsreader
description, green-dash list, and a focused app window (`appwin`) on the c2
painting. Same tablist semantics as the switcher.

### Stats

Lead stat cell is ink-on-green (the one allowed green fill outside the CTA
panel); supporting cells are card surface with an `edge` ring. Numerals in
Outfit 400 at 56px with lining figures.

### Quote

Newsreader italic 28px, centered, on a card surface with ring; mono uppercase
cite. Only real voices — the placeholder ships only until a real
sending-network quote exists, or it's removed.

### App mocks

Full frames (sidebar + head + body) or focused windows, 12px base type,
1px 55% ink ring + lift shadow. Real product words only — real names,
statuses, kanban cards, run sheets. Gray bars are banned.

### Motion

150–220ms transitions on named properties with `cubic-bezier(0.2, 0, 0, 1)`.
No entrance animations, no stagger theatrics; toggles swap instantly with a
static cue (rule + tint). `prefers-reduced-motion` collapses transitions and
disables smooth scroll.

## Do's and Don'ts

### Do

- Grounds stay cream. Color arrives through art, registration squares, and
  one ink panel.
- Dark pairings are cream-on-ink and ink-on-green — nothing else.
- Field green `#0B7A3F` carries green's meaning in text and links.
- On marketing surfaces, use rectangles everywhere: radius zero, defined 1px
  rings, corner marks on art panels. Edges are drawn, not implied.
- CTAs are ink — fills or 1px outlines, hovers invert. Green fills exactly
  one closing panel per page, its button ink.
- Display type is light and giant: Outfit 400 at −3%, line-height 1.
  Newsreader is the marketing body voice; never in UI.
- Long content earns an interactive toggle before it earns more scroll.
- Speak as the grounded shepherd: short declaratives, concrete nouns
  (people, meetings, launch Sunday), "you" always, honest about difficulty.
  Promise clarity, not growth.

### Don't

- **No green-on-ink** beyond the authenticated app bar's 24px brand mark. It is
  10:1 legible but remains retired for text, controls, general icons, and all
  marketing accents; those turn cream on ink.
- **No green text on cream** — 1.7:1, illegible. Fill or nothing.
- No green buttons anywhere; ink is the CTA color.
- On marketing surfaces, no rounded corners, pills, or ground-line markers —
  the entire "radiant, refined" world is retired (2026-07-30 side-by-side
  ruling).
- No green-wash panels, radial glows, or soft gradients ("AI-looking").
- No gray-bar skeletons as product stand-ins — full frames with real words.
- No loud selection states — the v3 boxed list with a 3px edge rule read
  louder than the product; selection stays a thin rule + a breath of tint.
- No decorative mark crops or generative field patterns (parked, not in the
  system).
- No stock photography — the product, the mark, or commissioned art.
- No AI hype ("AI-powered", "intelligent insights", "supercharge"), no
  churchy insider-speak ("Kingdom impact", "unleash"), no "users" (planters,
  coaches, sending churches, networks), no exclamation marks, no emoji, no
  fake urgency.

## Voice

Ruled 2026-07-27: **grounded shepherd**. The pitch:

> **Your church plant, understood.** EveryField puts a proven planting
> methodology to work on your real progress — the people, meetings, and
> momentum that get you to *launch Sunday* — and tells you what deserves
> your attention this week.

- Short declaratives. One idea per sentence. "You stay the shepherd; it
  keeps watch."
- Concrete nouns: people, meetings, giving, launch Sunday — never
  "workflows" or "solutions".
- Honest about difficulty: "Planting a church is one of the hardest things
  you'll ever do."
- "You", always. The planter is the subject; the software is the servant.
- Sentence case; verb-first buttons: "Request an invite."
- Promise clarity, not growth. Outcomes belong to God; visibility belongs
  to us.

## Assets

- **Wordmark & mark:** SVG lockup (1218:234, 2026-07-31 revision) is primary;
  the standalone mark (278:208) serves avatars, favicons, small spaces. Both
  live in `src/components/logo.tsx` and render via `currentColor`: ink on
  cream/green, cream on ink. Functional sizes only — decorative crops and
  mark-as-pattern are parked.
- **Art:** commissioned painterly landscapes in `docs/` — `c1-field.png`
  (dawn; hero backdrop), `c2-field.png` (the path; section panel + phase-tab
  backdrop), per-feature backdrops `people.png`, `meetings.png`,
  `teams-tasks.png`, `giving.png`, and the parked `a1-sprout.png`. All PNGs
  are 0.8–2.4 MB and must be optimized (WebP/AVIF at display size) before the
  real page ships.
- **Fonts:** Outfit (400/500), Newsreader (400/500 + italics, optical
  sizing), DM Sans (400–700), DM Mono (400/500) — via `next/font` on the
  real page.
