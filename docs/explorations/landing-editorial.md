# Landing exploration — "The Field Journal"

**Session:** 2026-08-02 · exploration branch `explore/landing-editorial` · route `/explore`
**Rule of the session:** existing landing, DESIGN.md, and design-catalog.md are out of bounds. Only fixed constraint: **Outfit Medium, −6% letter-spacing for headings** (the logo's voice). Brand colors: green `#1CE362`, ink `#181D19`, parchment `#FBF8EA`.

This document holds both halves of the exploration: the **reference analysis and design language** (Part I) and the **narrative structure plus every word of copy** from the exploration page (Part II), preserved so it can be compared against the existing landing page after the exploration code is discarded.

---

# Part I — References & design language

## 1. What the references actually do

Screenshots in `refs/` (intercom home ×14 desktop + mobile + tablet, helpdesk ×8, omnichannel ×7, sprig ×10).

### Intercom home (intercom.com)

- **Print grammar, executed literally.** Tiny blue registration squares sit at the corners of every media block — crop marks. Eyebrows are monospace ALL-CAPS (`TRUSTED BY 30,000+ LEADING BRANDS`, `[ OMNICHANNEL ]` with literal brackets). Body copy is a **serif** (editorial), headlines a giant grotesque. The page reads like a broadsheet that happens to be interactive.
- **The hero is a masthead, not a poster.** ~120px three-line headline left, small serif deck top-right, CTAs under the deck. First screenful is ~90% typography and air; the product appears on screen two, huge.
- **Product UI never sits on white.** Screenshots float on warm textured photography (cardboard, water, leaves) and — on omnichannel — on **classical landscape paintings**. The stage under the UI is what makes it feel premium instead of like documentation.
- **Mixed-media trinity:** photography (film-strip crops), **ink-brush illustration** (flower, butterfly, man with kite), product UI. The hand-made ink pieces are the humanity valve in an otherwise rigid system.
- **Scroll-linked list pattern:** screenshot left, feature list right; the active row darkens on a light panel with a small blue square bullet, inactive rows sit at ~35% grey. Repeated on every product page.
- **Chapter machinery for long pages:** helpdesk uses a sticky left rail (PRODUCTIVITY / USABILITY / OUTBOUND / FEATURES). And the **feature index as design object**: a full-screen list of giant grey words (Copilot, Tickets, Omnichannel, Help Center…) where the hovered row turns ink-black with an arrow. Coverage without sections.
- **Ratio discipline:** one container (~1160px at 1440, ~9% side margins), media always spans it fully; type scale runs 11px mono → 120px display with almost nothing in between. Color is neutral + ONE blue; the screenshots supply all other color.
- **Mobile:** identical order, serif retained, headline rewraps (~44px). Screenshots are **cropped tighter, never shrunk** — you zoom into one panel of the UI instead of rendering the whole workspace unreadably small. Decoration (film strip) survives as a horizontal scroller.

### Sprig (sprig.com)

- **Two-tone headline** as hierarchy device: "Enterprise surveys." in ink, "Powered by agents." in grey — the sentence carries its own emphasis.
- **Quieter ratio than Intercom:** smaller display sizes, much more whitespace, a single pill CTA. Feels enterprise-calm rather than loud.
- **Features as reading matter:** hairline-separated list rows (bold title + two grey lines), no cards, no icons in the lists. Chapters marked by a sticky left label with a small gradient orb (Design / Deploy / Field).
- **Product UI framed by color:** app shots sit between two vertical gradient bars (peach→mauve, sand→olive) — the gradient is the stage, cropping the shot and giving each chapter a hue identity.
- **One dark inversion** mid-page ("the full spectrum") with four dark cards — a register change that resets attention before the close.

### Why these sites feel polished (the transferable laws)

1. **One container, one geometry.** Every block snaps to the same width; media always fills it. Nothing is 80%-ish.
2. **Type does the branding.** 2–3 families, extreme scale contrast, one weight per role.
3. **Color scarcity.** Neutral canvas + one accent; screenshots carry the rest. The accent means something (active, marked, alive).
4. **UI is always staged.** Art, texture, or gradient under every screenshot; bold crops; corner marks. Raw UI on white reads as docs, not marketing.
5. **The page is an argument, not a list.** Claim → proof (product, huge) → credibility → pillars → deep-dive the differentiator → trust → close. Features appear inside the argument, plus one index for completeness.
6. **Responsive = crop, stack, keep order.** Nothing important disappears; media crops in; type rewraps; lists stack.

---

## 2. The EveryField story

Audience: **church planters** first, **sending churches / networks** second. Product truth (product-brief): learn → plan → execute → measure, on the Launch Playbook methodology. Differentiator (phase-engine FRD): **Plant Intelligence** — deterministic facts + LLM judgment, advisory not gate, "the system counts; the judge interprets; you decide."

The four pen-and-ink masters (`docs/sketched/1–4.png`) already narrate the journey:

| Piece | Image | Story beat |
|---|---|---|
| 1 | Crossroads in an open field | **The calling** — where every plant starts: an open field and a decision |
| 3 | Tilled plot, seedling rows, crops in stages | **The work** — tending: people, meetings, teams, money, buildings |
| 4 | Harvest hill with hay bales | **The oversight/harvest** — networks see every field; launch is the harvest |
| 2 | Homestead at dawn | **The close** — the work starts at first light; break ground |

### Page narrative (chapters of a field journal)

1. **Masthead + Hero — the claim.** `[ FOR CHURCH PLANTERS ]` · "Every church begins in an open field." Deck: from calling to launch Sunday, one place to learn, plan, execute, and measure — built on a proven playbook. Product-on-art: assessment/next-step cards floating over the crossroads piece.
2. **Credibility strip.** No customer logos yet (alpha) — the playbook is the authority: "Built on the Launch Playbook · 96 articles · 4 phases · field-tested methodology."
3. **Chapter I — Know the way** (learn/plan): Wiki + document templates. Screenshot-left, list-right pattern.
4. **Chapter II — Tend the field** (execute): People CRM, meetings, ministry teams, tasks & projects, communication hub, financial tracking, facility management. Big staged UI over the seedling-rows piece + hairline feature rows.
5. **Chapter III — Plant Intelligence** (measure): the dark inversion section; green burns brightest here. Facts-vs-judgment told honestly; insight cards, "ready to advance" prompt, phase context. The longest chapter — it's the differentiator.
6. **Chapter IV — Every field, seen** (oversight): sending church / network health board over the harvest piece; privacy-first framing ("observations, not verdicts").
7. **Feature index** — the giant grey list of ALL features, hover-ink. Guarantees total coverage without 13 equal sections.
8. **Close** — homestead-at-dawn full-bleed: "Break ground." + CTA + footer.

### Design language ("sketched broadsheet")

- **Canvas** parchment `#FBF8EA`; **ink** `#181D19` for text and rules; **green** `#1CE362` reserved for registration marks, active states, underlines, and the primary CTA — scarce everywhere except inside the Plant Intelligence dark chapter, where it's the light.
- **Type:** Outfit 500 `letter-spacing:-0.06em` for every heading (logo voice); Newsreader for decks/body (the newspaper voice); Geist Mono for eyebrows/labels/caps data.
- **Print furniture:** hairline ink rules, bracketed mono eyebrows, crop-mark squares at media corners, chapter numerals (I–IV), a folio line ("THE FIELD JOURNAL · EST. TODAY").
- **Stage under UI:** the pen-and-ink masters play the role Intercom gives classical paintings. Faux-UI vignettes built in HTML (radius-0, ink-hairline cards on parchment) rather than raw screenshots — full stylistic control, crops well on mobile.
- **Texture:** faint paper grain (SVG turbulence), never enough to grey the parchment.

---

## 3. What was deliberately NOT consulted

Existing landing page code, `DESIGN.md`, `design-catalog.md/html`, `landing-storytelling-plan.md`, `marketing-church-seed.md` — this exploration derives everything from the references, the brand card, the sketched masters, and the product docs.

---

# Part II — Story & complete copy

## 4. The story the page tells

The page is structured as a **field journal** — a chaptered argument, not a feature list. Each section makes one claim, then proves it with the real product staged on the pen-and-ink field art. The chapters follow the planter's actual journey, and the four sketched masters carry the arc:

| Beat | Art | Claim |
|---|---|---|
| Hero — *the calling* | Crossroads | Every plant starts as an open field and a decision. EveryField covers the whole journey. |
| Strip — *the authority* | — | The credibility is the methodology (no customer logos needed in alpha). |
| Ch. I — *learn* | — | You are not guessing; the way is documented and meets you in your phase. |
| Ch. II — *execute* | Seedling rows | The whole work — people, meetings, teams, money, building — lives in one place. |
| Ch. III — *measure* (dark) | — | The differentiator: intelligence that reads the field. Facts counted, judgment grounded, planter in charge. |
| Ch. IV — *oversight* | Harvest | Networks see every field — honestly, without surveillance. |
| Index | — | Total feature coverage in one typographic object. |
| Close — *begin* | Homestead at dawn | Break ground. |

**Voice rules used throughout:**

- Headings speak in the field metaphor (open field / tend / reads your field / every field, seen / break ground); body copy stays concrete and names real objects (follow-ups, bylaws, RSVPs, runway).
- Serif (Newsreader) carries all persuasion; monospace carries all *apparatus* (eyebrows, figure captions, labels, stats) — the page separates "what we're saying" from "how it's organized."
- Every feature body is two lines: what it is, then why it matters to a planter specifically ("before Sunday morning does", "the project management is already churchy").
- The AI chapter never says "AI-powered." It makes a governance promise instead: counts / interprets / you decide.

---

## 5. Complete copy, in page order

Formatting key: `MONO` = monospace apparatus text (rendered uppercase), **H** = display heading (Outfit 500, −6%), *serif* = Newsreader body.

### Masthead

- `MONO folio:` The Field Journal · From calling to launch Sunday
- Logo: EveryField lockup (no text copy)
- `MONO nav:` The journey — Plant intelligence — For networks — Sign in
- Button: **Start your plant**

### Hero

- `MONO eyebrow:` [ For church planters ]
- **H1:** Every church begins in an open field.
- *Deck:* EveryField is the one place to learn the way, gather your people, and measure what matters — from first calling to launch Sunday, guided by a field-tested playbook.
- Buttons: **Start your plant** · *Read the journey ↓*
- Screenshot frame labels: `Plant Intelligence · Your focus` · `Dashboard`
- `MONO figure caption:` Fig. 1 — The calling · real product, real assessment  /  right side: Every field starts empty

### Playbook strip (credibility)

- **96** — `playbook articles`
- **4** — `phases, calling → launch`
- **13** — `tools in one place`
- **1** — `assessment that reads them all`
- `MONO tagline:` Built on the Launch Playbook — the methodology, not a template pack

### Chapter I — learn

- `MONO:` Chapter I
- **H2:** Know the way before you walk it
- *Deck:* The Launch Playbook lives inside EveryField as a 96-article wiki — searchable, phase-aware, and linked from everything you do. The documents you'll need are already drafted.
- Screenshot label: `The app · Wiki — your phase knows what you need`
- `MONO figure caption:` Fig. 2 — The playbook meets you where you are
- Feature rows:
  - **The Launch Playbook, searchable** — *Ninety-six articles of field-tested methodology — vision, people, money, facilities — organized by the phase you're actually in.*
  - **Document templates** — *Bylaws, budgets, leadership covenants, launch checklists — start from a proven draft instead of a blank page.*
  - **Phase guides** — *Each of the four phases explains itself: what it's for, what good looks like, and what usually goes wrong.*

### Chapter II — execute

- `MONO:` Chapter II
- **H2:** Tend the field, all of it
- *Deck:* A plant is people, meetings, teams, money, and a building — usually scattered across five tools. Here the work happens in one place, so the whole story stays together.
- Screenshot labels: `People & CRM` · `Meetings`
- `MONO figure caption:` Fig. 3 — The tending · people, gatherings, teams
- Feature rows:
  - **People, from visitor to committed** — *A CRM shaped for planting: every family's journey from first conversation to core-group commitment, with follow-ups that don't slip.*
  - **Meetings & RSVPs** — *Vision nights, interest meetings, launch-team gatherings — scheduled, invited, and attended without a spreadsheet.*
  - **Ministry teams** — *Define the teams a launch needs, fill the roles, and see the gaps before Sunday morning does.*
  - **Tasks & projects** — *The launch broken into workstreams with owners and due dates — the project management is already churchy.*
  - **Communication hub** — *Email your core group, notify a team, follow up a visitor — one place, with the history kept.*
  - **Financial tracking** — *Commitments, giving, and runway against your launch budget — the honest number, always current.*
  - **Facility management** — *Track the venues you're scouting, the terms you're offered, and the setup every Sunday will need.*
  - **Notifications that respect you** — *The system speaks up when something needs you — and stays quiet when it doesn't.*

### Chapter III — measure (dark inversion; the differentiator)

- `MONO eyebrow:` [ The differentiator ]
- `MONO:` Chapter III
- **H2:** Intelligence that reads your field
- *Deck:* Every tool in EveryField feeds one assessment. The system counts what's true, a judge grounded in the Playbook interprets it, and you decide what to do — nothing is ever gated.
- Screenshot label: `The app · Your focus — as of this morning`
- `MONO figure caption:` Fig. 4 — Every insight cites its facts and its playbook source
- The triad:
  - `01` **The system counts** — *Every number is computed from your real activity. The AI is never allowed to guess a fact.*
  - `02` **The judge interprets** — *An assessment grounded in the Playbook weighs your signals against the methodology — and cites its sources.*
  - `03` **You decide** — *Insights advise, never block. Advance, wait, or push back — the phase is yours to call.*
- *Coda (centered):* Assessments run quietly in the background and are waiting when you arrive — with what changed since last time. You see yours before anyone else does.

### Chapter IV — oversight

- `MONO:` Chapter IV
- **H2:** Every field, seen
- *Deck:* For sending churches and networks: an honest health view of every plant you've sent — whether that's one this decade or a hundred this year.
- Screenshot label: `The app · Network dashboard — Plant Health`
- `MONO figure caption:` Fig. 5 — The harvest · oversight without surveillance
- Feature rows:
  - **Progress dashboards at every scale** — *A single plant or a whole network — phase, health, and momentum, rendered from the same assessment the planter sees.*
  - **Observations, not verdicts** — *Network-facing insights are conservative, cite what they observe, and never expose more than the plant's privacy settings allow. Planters always see their assessment first.*

### The feature index

- `MONO header:` The index — everything inside
- Rows (giant grey type; the note appears on hover):
  - `01` **Launch Playbook wiki** — `96 articles of methodology`
  - `02` **People CRM** — `visitor → committed`
  - `03` **Communication hub** — `email, notify, follow up`
  - `04` **Meetings & RSVPs** — `vision nights to launch day`
  - `05` **Ministry teams** — `roles, gaps, coverage`
  - `06` **Tasks & projects** — `the launch, broken down`
  - `07` **Financial tracking** — `giving, runway, budget`
  - `08` **Facility management** — `venues, terms, setup`
  - `09` **Document templates** — `proven drafts, not blank pages`
  - `10` **Progress dashboard** — `the plant at a glance`
  - `11` **Notifications** — `signal, no noise`
  - `12` **Plant Intelligence** — `the assessment that reads it all`
  - `13` **Network oversight** — `every field, seen`

### Close (over the homestead-at-dawn piece)

- `MONO eyebrow:` [ The work starts at first light ]
- **H:** Break ground.
- *Deck:* EveryField is in alpha with a founding cohort of planters and networks. Your field is waiting.
- Buttons: **Start your plant** · *Talk to us*

### Footer

- Logo: EveryField lockup
- `MONO:` Every field, from calling to launch · © 2026

---

## 6. Copy principles worth comparing to the existing landing

1. **One-sentence thesis, journey-framed.** "Every church begins in an open field." + a deck that names the four verbs (learn / gather / measure) and the two endpoints (first calling → launch Sunday). The whole product in 30 words.
2. **Authority instead of logos.** In alpha there's no social proof — the strip converts the methodology itself into credibility with four numerals (96 / 4 / 13 / 1). The final "1 assessment that reads them all" plants the differentiator before its chapter arrives.
3. **The AI pitch as three governance promises.** Counts / interprets / you decide. It answers the trust objection ("will it hallucinate about my church?") without ever raising it, and "nothing is ever gated" speaks directly to planter autonomy.
4. **Oversight framed to both audiences at once.** "Every field, seen" sells visibility to networks while "observations, not verdicts" and "planters always see their assessment first" reassure the planter being observed. Privacy is a feature headline, not a footnote.
5. **Feature bodies earn their nouns.** Bylaws, vision nights, runway, "before Sunday morning does" — every row proves domain fluency in under 25 words. Nothing generic ("streamline your workflow") survives.
6. **CTA discipline.** One imperative repeated three times, always the same words: *Start your plant.* The soft alternatives change by position (Read the journey ↓ / Talk to us).
7. **Apparatus copy is a voice of its own.** Figure captions narrate the art as story beats (The calling / The tending / The harvest), and screenshot labels sell while labeling ("Wiki — your phase knows what you need", "Your focus — as of this morning").

---

## Appendix — retired v1 microcopy (faux-UI vignettes, replaced by real screenshots)

Kept because some lines may be worth reusing in product or marketing copy:

- Insight card: "Schedule your third vision meeting — three families are ready to commit." / `From 6 signals · Playbook §2.4`
- Wiki article opener: "Vision leaks. The families who wept at your first gathering will drift by the fourth unless the picture is repainted — smaller, nearer, and more often than feels natural…" (article title: *Casting vision to your core group*; related: *Your first vision night*, *From visitor to committed*)
- Judgment panel insights:
  - "Your core group grew 21% this month. Start naming ministry leaders now — momentum like this is when people say yes." / `Grounded in Playbook §3.1 · Building your leadership bench`
  - "Three first-time visitors have no follow-up scheduled. After two weeks, the door closes quietly." / `Grounded in Playbook §2.7 · The first fourteen days`
  - "Readiness: the signals for Phase III are in place. Advance when you're ready — nothing is ever gated." (buttons: `Advance to Phase III` / `Not yet`)
- Facts panel header: "The facts — counted, never guessed" · Judgment panel header: "The judgment — what matters now"
- Meeting vignette: "Vision night · No. 3 — Sun 6:00 pm · The Reyes home · 24 RSVPs · 19 yes · 5 awaiting reply"
