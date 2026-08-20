# Product Values — how we decide what to build

**Status: RULED 2026-08-10.**

The companion to `ops/process.md`: that page governs *how* work is built;
this one governs *what* gets built and how tradeoffs are decided. These are tie-breakers —
they earn their keep when two options both look reasonable and something has to choose.

Each value ends with **The test** — the falsifiable form. A value that cannot fail a
decision is decoration.

Sources: `brainlift.md` (SPOV 3, DOK2), `product-brief.md` (vision, non-goals),
`gap-report-2026-06.md` §5 (prioritization principles, previously quarantined in an
archival doc), and the rulings practice to date.

---

## V1 — Mission over milestone

A milestone may bend **scope**, never **shape**. When a date forces a choice, a feature
leaves the release whole; it does not ship hollow. A half-built feature costs three times:
users learn a broken version, the team relearns the real one, and trust — the scarcest
asset (V2) — pays for both. The repo already practices this: F10 was cut outright rather
than shipped thin, and alpha scope shrank by removing whole features (#192/#193), not by
thinning them.

**The test:** if the plan says "a reduced version of X for alpha", either the reduced
version is a complete, honest product on its own terms, or X moves out of alpha. "We'll
finish it after the milestone" fails the test.

## V2 — Trust before features

Planters trust us with spiritually and personally sensitive data, and oversight
relationships are power relationships. So: privacy defaults closed; oversight sees
aggregates, never individual persons; exposure requires the plant's consent; and consent
copy never claims more privacy than the code enforces. A trust failure is not a bug — it
is the one failure mode this product cannot recover from with its audience.

**The test:** any new data flow toward oversight starts from "off" and the plant turns it
on — never the reverse. Any copy describing privacy is pinned to the actual exposure.

## V3 — Lead with the mission; technology stays invisible

The product cannot lead with AI, data, or efficiency as its value proposition — this
audience adopts tools that serve the mission (healthier plants, faithful stewardship) and
rejects tools that ask to be admired. The product speaks the planter's language — the
Launch Playbook's vocabulary — and the machinery stays behind it.

**The test:** every user-facing surface and every line of copy answers "what does this do
for the plant?" — never "look what the system can do."

## V4 — Encode the proven methodology; do not invent one

The Launch Playbook is the source. Features exist to make its practice executable and
measurable, not to express our opinions about church planting. Where a feature and the
methodology disagree, the methodology wins — or the divergence is made explicit and ruled,
never slipped in as a design choice.

**The test:** a feature's core concepts trace to the Playbook (or to an explicit ruling
that extends it). A concept that traces to "how SaaS products usually do it" is a flag.

## V5 — Honest numbers

A figure is shown only when the data proves it. Unknown renders as unknown, never as zero.
A rate names its denominator. Oversight reads aggregates, and an aggregate never
masquerades as insight into individuals. This is V2's arithmetic face: the fastest way to
lose a network's trust is a dashboard that confidently states something false about one of
its plants.

**The test:** for every displayed number, someone can say what it counts, over what
denominator, and what it shows when the data cannot answer. ("0%" for "no data" fails.)

## V6 — Build the near-term in the shape of the long-term

The long play is becoming the shared measurement layer of an industry that has none —
which plants thrive, why, and what works. That future is built or foreclosed by today's
schema and event decisions, not by a future pivot. Near-term features are therefore built
in the shape the long-term needs: real entities, journaled events, phase history that
stays honest — even when a flat column would ship faster.

**The test:** would the data this feature writes still be trustworthy input for
cross-plant learning in three years? If the shortcut writes data we would later have to
distrust, it is not a shortcut.

## V7 — Decide once, record it, re-decide in the open

A product decision is a ruling: dated, recorded in one ledger, and binding until a new
ruling replaces it. Never relitigated by accident — and never immovable on purpose. This
is the product-side mirror of R6 (`ops/process.md` § Rules bind at two strengths):
anyone (human or agent) who believes a
ruling no longer serves the mission raises it openly; nobody deviates silently, and
nobody treats a past decision as physics.

**The test:** every standing decision can be found, with its rationale, in one place; and
there is a named path to challenge it.

---

## What this means for FRDs

An FRD states the **end state** of a feature in product terms — what it is when it is
right, per the values above. Three consequences:

- **Rationale rides with the requirement; history does not.** A requirement may carry one
  line of *why* (that is what stops it being re-litigated). It never carries ruling dates,
  issue numbers, supersession chains, or "previously/currently/not yet" narration.
- **Status never lives in an FRD.** The board owns what is built; the FRD owns what true
  looks like.
- **Decisions live in the ledger, once.** The FRD absorbs a ruling by *becoming correct*,
  not by appending the ruling to itself.
