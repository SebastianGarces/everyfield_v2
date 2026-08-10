# CONTEXT — EveryField's Ubiquitous Language

One word per concept, used the same way in FRDs, `memory/`, issue titles, UI copy and
conversation. When a document and this file disagree, this file wins and the document is wrong.

**How to read an entry.** Each term gives the **canonical word**, what it means, and the
**deprecated synonyms** it replaces — words that are either ambiguous or that name a different
thing precisely. Deprecated does not mean forbidden in history: archived and cut FRDs
(`features/progress-dashboard`, `features/facility-management`) and every dated document keep
their original wording. New and edited text uses the canonical word.

**Scope.** This file governs prose. It does **not** rename code identifiers, database columns or
event names — `coach_assignments`, `sending_church_id` and `meeting.attendance.finalized` are
contracts and stay exactly as they are. Where a canonical word differs from the identifier that
carries it, the entry says so.

---

## 1. The five user roles

There are exactly five roles: `planter`, `coach`, `team_member`, `sending_church_admin`,
`network_admin`. No sixth role exists — not `team_leader`, not `admin`, not `owner`. Team
leadership is derived from `MinistryTeam.leader_id`, never from a role.

| Canonical word | Who they are | What they see |
|---|---|---|
| **planter** | The person leading one church plant. Full CRUD on their own plant, and the only person who may accept an association, sever one, schedule a launch, or set the sharing toggles. | Everything in their own plant. |
| **team_member** | Someone inside a plant who is not the planter. Feature-limited within that one plant. | Their own plant, minus planter-only actions. |
| **coach** | An experienced leader assigned to specific plants through `coach_assignments`. The assignment is **planter-initiated** — the planter invites their coach. | Read-only access to the plants assigned to them. |
| **sending_church_admin** | Staff at a church that sends planters. | Aggregate metrics for plants whose `sending_church_id` matches theirs, gated by that plant's `share_*` toggles. |
| **network_admin** | Staff at a church-planting network. | Aggregate metrics for plants whose `sending_network_id` matches theirs, gated by that plant's `share_*` toggles, plus the roster of member sending churches. |

**Deprecated synonyms**

- **"coach" meaning "whoever oversees a plant."** This is the failure this glossary exists to
  stop. `coach` is one role with one reach path (`coach_assignments`). A sending church admin is
  not a coach; a network admin is not a coach. Where a sentence means all of them, say
  **oversight admin** (§5) or name the roles. Where it means only the role, say **coach**.
- **"mentor", "overseer", "supervisor", "sponsor"** → use the role name, or **oversight admin**
  for the two org-level roles collectively.
- **"network user"** → **network_admin**, or **oversight admin** if sending churches are included.
- **"admin", "church admin", "org admin"** on their own → name the role.
- **"user"** where a specific role is meant → name the role. "User" is fine only when the sentence
  is true of every role.
**Two things named "coach" that this entry does not govern.** Both are content, not prose about
the role, and both keep their names:

- **"Small Group Coach"** — a ministry-team role template, a job on a roster inside a plant.
- **"Finding a Coach/Mentor"** — a wiki article title in the shipped corpus.

Keep both capitalised as titles so they do not blur into the role.

## 2. plant / church

| Canonical word | Meaning |
|---|---|
| **plant** (or **church plant**) | The new church being planted. This is the tenant: every feature row carries its `church_id`. Use **plant** in prose; **church plant** on first mention in a document. |
| **church** | Reserved for the database entity `churches` and for a congregation in general. |

A **sending church** is a church, but it is never a *plant* — it is not a tenant, it does not have
a phase, and it does not go through the journey. Never shorten "sending church" to "church" in a
sentence that also talks about plants.

**Deprecated synonyms:** "site", "campus", "project", "the church" used to mean a plant when a
sending church is also in scope.

## 3. sending church / sending network

| Canonical word | Meaning |
|---|---|
| **sending church** | A church that sends planters. Its own entity (`SendingChurch`), separate from `churches`. Typically 1–5 plants. |
| **sending network** | A church-planting network at the top of the hierarchy. Typically 10–1000+ plants. |
| **oversight org** | Sending church **or** sending network, when the sentence is true of both. |

The hierarchy is **sending network → sending church → plant**, and every level is optional: each
of the three can exist with no parent. The two hierarchy FKs on a plant (`sending_church_id`,
`sending_network_id`) are independent — neither implies the other.

**Deprecated synonyms:** "parent church", "mother church", "sponsoring church" → **sending
church**. "denomination", "org", "the network" used loosely → **oversight org**.

## 4. phase / stage

| Canonical word | Meaning |
|---|---|
| **phase** | The plant's position in the seven-phase journey (0 Discovery → 6 Post-Launch). Stored as `current_phase`. The phase is **advisory context, not a gate**: the Phase Engine reads real activity and guides; the planter advances when they judge they are ready. |
| **stage** | Reserved for the People/CRM pipeline — the columns a person moves through (prospect → attendee → …). |

The two are different axes. A plant has a phase; a person has a stage.

**One deliberate exception:** onboarding asks the planter "where are you in the journey?" and calls
the answer the **journey stage**, because "phase 3" means nothing to a planter on day one. That is
UI copy for one screen. The thing it writes is still the plant's **phase**.

Phase history holds two populations that must never be conflated:

- **transition** — a phase move the planter made inside EveryField.
- **initial declaration** — where the plant already stood when it arrived. A declaration is **not**
  an advance; nothing may count it as one.

**Deprecated synonyms:** "step", "level", "milestone" for a phase → **phase**. "phase" for a
person's pipeline position → **stage**.

## 5. oversight / the plant's own team

**Oversight** is the relationship between an oversight org and a plant associated with it. It is
not a feature name in prose and not a synonym for coaching.

Two circles, and no sentence may blur them:

| Canonical word | Who | Governing rule |
|---|---|---|
| **the plant's own team** | `planter` and `team_member` of that plant, plus the `coach` assigned to it | Sees the plant's own records, individual people included. |
| **oversight** | `sending_church_admin`, `network_admin` — collectively **oversight admins** | **Aggregate metrics only, never an individual person record.** The six `share_*` toggles default to false and gate what oversight may pull; push is narrower still. |

The plant's **directory listing** on an oversight surface is deliberately ungated — only the
feature data inside it is gated. Consent copy may not claim otherwise.

**Deprecated synonyms:** "coach dashboard" → **oversight portfolio**. "supervision",
"accountability partner" → **oversight**. "the network sees" when sending churches are also meant
→ **oversight sees**.

## 6. invitation / association

| Canonical word | Meaning |
|---|---|
| **invitation** | The offer. Created by the oversight org (**oversight invites, target accepts**), addressed to one email, single-use, expiring. It may name no target at all — that is the register path. |
| **association** | The relationship the accept creates: the plant's `sending_church_id` or `sending_network_id` pointing at an oversight org. |
| **disassociation** (or **sever**) | Ending an association. Either side may do it, behind type-to-confirm, with the other side notified and an `association_events` row written. |

An accept never *replaces* an existing association — it only fills an empty slot. Only the
**planter** may accept or sever on the plant's side; only the org's **admin** may sever on the
org's side.

Coach assignment is **not** an association. It is a separate, planter-initiated assignment
(`coach_assignments`) and creates no hierarchy edge.

**Deprecated synonyms:** "link", "connect", "affiliation", "join request" → **invitation** or
**association**, whichever the sentence means. "invite" as a noun → **invitation**.

## 7. launch

| Canonical word | Meaning |
|---|---|
| **launch** | The first-class entity: one live launch per plant, carrying the target date, a status (`planning` / `scheduled` / `completed` / `postponed`), readiness milestones and an outcome record. |
| **Launch Sunday** | The day itself. It is **not** a meeting — no meeting row is created for it. |
| **launch date** | The launch entity's target date. The launch entity is its **only** owner; no other row holds a copy. |

**Deprecated synonyms:** "go-live", "opening day", "first service" → **Launch Sunday**. "launch
date on the church" → there is no such column; say **the launch date**, owned by the launch.

## 8. Launch Playbook

The **Launch Playbook** (`product-docs/launch-playbook.md`) is the methodology this product
implements — the domain source for phases, ministry-team structure, meeting objectives, launch
readiness and the 4 C's. Requirements **reference** it; they never restate it, and they never
contradict it without a recorded decision.

A feature's core concepts should trace to the Playbook or to an explicit ruling in
`product-docs/decisions.md`.

**Deprecated synonyms:** "the methodology doc", "the playbook" lowercase, "the church planting
guide" → **the Launch Playbook**.

---

## Where the rest lives

| Question | File |
|---|---|
| Why the product exists, target users, the phase table, the 4 C's | `product-docs/product-brief.md` |
| Dated product decisions | `product-docs/decisions.md` |
| Rules code must not break | `memory/invariants.md` |
| How to write an FRD, including the two naming idioms | the `requirements-docs` skill |
