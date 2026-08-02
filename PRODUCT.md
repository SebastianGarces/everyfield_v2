# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Planter** (primary): the church planter running the road to launch Sunday — recruiting and shepherding people, running vision meetings, staffing ministry teams, tracking momentum. Usually a solo leader wearing every hat, working evenings around a day job.
- **Coach/Mentor**: an experienced leader giving oversight to one or a few planters; assignment is planter-initiated.
- **Core group / launch team members**: committed people inside a plant.
- **Oversight (network/sending level)**: sending church admins (1–5 plants) and network admins (10–1000+ plants) who need visibility into planter progress. Both scales must be served.
- Vocabulary is binding: *planters, coaches, sending churches, networks* — never "users."

## Product Purpose

A single platform where church planters learn, plan, execute, and measure the plant journey — people/CRM, meetings with attendance-driven follow-ups, tasks, ministry teams, wiki methodology, documents, communication — guided by a proven playbook methodology. Success right now: the invite-only alpha cohort (see Capabilities) runs their real plants in it and the demo path holds end-to-end.

## Positioning

The mechanism a neighbor can't truthfully copy: **Plant Intelligence** — an LLM-judge engine that reads the plant's *real* activity (commitments, meeting trends, team staffing and training, follow-up hygiene) against the phased methodology and tells the planter what deserves attention this week. "It reads where you actually are. Not where a checklist says you should be." The promise is clarity, never growth — outcomes belong to God; visibility belongs to us.

**Open decision (do not resolve implicitly):** whether marketing may name the methodology's source (Launch Playbook v1.2, Harvest Bible Fellowship) publicly. Until ruled, surfaces avoid provenance claims — "a proven planting methodology" with no named source is the ceiling.

## Operating Context

- The plant journey runs through seven named phases — Discovery, Core group, Launch team, Training, Pre-launch, Launch Sunday, Beyond — **named, never numbered**.
- Real rituals the product lives inside: vision nights with attendance batches that auto-create follow-up tasks; the 4 C's person progression; interviews (with an in-context interview guide); team training matrices; launch checklists and run sheets; weekly attendance after launch.
- Hierarchy is optional and mutable: plants can exist unaffiliated and later join a sending church/network by invitation; oversight invites, target accepts.

## Capabilities and Constraints

- Built and shipping: people/CRM, meetings + attendance→follow-up automation, tasks, ministry teams + health dashboard, wiki with phase-aware progress, documents/templates, notifications, Plant Intelligence assessments, onboarding, oversight dashboards.
- **Stage (confirmed 2026-08-01):** invite-only alpha; cohort ~10–15 plants recruited via Brett & Bryan's networks; **no payments in alpha** — the model later is org-pays-per-plant; the demo path is the alpha exit condition. Billing is a Beta concern (FRD #213).
- Stack is settled by the codebase (Next.js App Router on Vercel, Drizzle/Neon); no re-decision needed.
- LLM data posture: OpenAI input/output sharing deliberately ON until beta, retention opted out in code (`product-docs/features/phase-engine/data-posture.md`).

## Brand Commitments

- Name: **EveryField**; wordmark + mark in `src/components/logo.tsx` (currentColor).
- Voice (ruled 2026-07-27): **grounded shepherd** — short declaratives, concrete nouns, "you" always, honest about difficulty, sentence case, verb-first buttons; no AI hype, no churchy insider-speak, no exclamation marks, no emoji, no fake urgency.
- Visual world: `DESIGN.md` ("sharp", ruled 2026-07-30) governs the marketing surface; the app shares only green + ink + rectangle discipline. Commissioned painterly field art is the only non-product imagery; **no stock photography**.
- Marketing narrative (ruled 2026-08-01): "one church, one month, one page" — the Redemption Hill cast carries the landing story; Trinity Grove closes it (`docs/landing-storytelling-plan.md`).

## Evidence on Hand

**Binding posture (confirmed 2026-08-01):** there are **no real testimonials, case studies, or usage numbers yet** — no surface may fabricate any; quotes ship only when a real voice exists. Redemption Hill and Trinity Grove are **fictional seed churches** (with a named fictional cast: Sam Torres, the Riveras, Dana Whitfield, Grace Lin) — fine to show as product screenshots and demo data, **never to present as real customers**.

- Real screenshot masters (2880×1800) + capture/crop rigs at `~/dev/everyfield-marketing-masters`; shipped crops in `public/marketing/shots/`.
- Seed script `scripts/seed-marketing-church.ts` produces the demo churches through real product actions (attendance handlers, notifications), so screenshots show honest product behavior.

## Product Principles

1. **Truth over theater.** Signals derive from real activity (real handlers, real data paths) — never staged numbers; marketing proof follows the same law.
2. **The planter is the subject; the software is the servant.** "You stay the shepherd; it keeps watch."
3. **Methodology-anchored.** Features map to the phased playbook; the app knows which chapter the plant is living in.
4. **Serve both scales.** A lone unaffiliated planter and a 1000-plant network are both first-class; affiliations stay optional and mutable.
5. **Promise clarity, not growth.** No outcome claims, no hype vocabulary, anywhere.

## Accessibility & Inclusion

No formal standard ruled, but working law exists: measured WCAG contrast for every color pairing (see DESIGN.md's color law), `prefers-reduced-motion` honored on all marketing motion (final frame, not absence), `cursor-pointer` on every interactive element (repo-wide rule), 16px minimum inputs on mobile, and Lighthouse a11y audits as part of frontend Definition of Done.
