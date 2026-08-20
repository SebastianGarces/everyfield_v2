# Hierarchical Access Control

Why and how, for the Hierarchical Access Control rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/access.ts`, `src/lib/oversight/`, `src/lib/phase-engine/oversight/read.ts`, `src/lib/notifications/`, `src/db/schema/church-privacy-settings.ts`

## The portfolio listing is deliberately ungated

`getOversightPlantHealth()` is what the oversight dashboard is *for*; the six `share_*` columns gate the feature data inside a plant, not the listing of plants. So "they see nothing unless you turn sharing on" is false — `OVERSIGHT_SHARING_TOGGLE.detail` states the real limit, and changing either the exposure or the copy means changing both.

## Naming the orgs behind a plant

The two oversight FKs are independent, so an accessible plant can name a sending church in a **different network entirely**. Rendering it discloses a third org's name to a caller not party to that relationship, and asserts a causal path the data model does not have. `sendingChurchesInNetwork` (`src/lib/oversight/read.ts`) therefore carries the caller's own `sending_network_id`.

## Launch countdowns

`daysUntilTarget` (`src/lib/launch/countdown.ts`) is the one implementation, and **a midnight-only assertion passes under both the right and the wrong one.** The sibling `diffInDays` call sites compare two genuine instants (days since last meeting, idle days, tenure), where flooring IS correct — the bug is the date/instant mix, not the flooring.
