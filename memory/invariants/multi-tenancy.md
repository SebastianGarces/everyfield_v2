# Multi-Tenancy

Why and how, for the Multi-Tenancy rules in [`../invariants.md`](../invariants.md). Almost all of it is invitations, because that is the only path that creates a cross-tenant association.

**Source:** `src/lib/invitations/core.ts`, `src/db/schema/*.ts`, `product-docs/system-architecture.md`

A plant's two oversight FKs are **independent associations held side by side**; neither is the route to the other. Isolation is application-layer: a missing `church_id` predicate is a cross-tenant read with nothing behind it to catch the mistake.

## An accept never replaces an association (#265, ruled 2026-08-03)

Nothing stops a second org inviting a plant that already belongs to one, and the plant's planter has authority over that invitation too — so accepting used to set the FK to the newcomer and sever the incumbent silently, with none of the three things #274/OV-007 requires of a sever (type-to-confirm, notification, an `association_events` row).

The guard sits on the **claim**, so a refused accept leaves the invitation `pending` and writes nothing, rather than committing an acceptance with no association behind it. Re-binding the SAME org stays an idempotent no-op — the replay path depends on it. Being a subquery on another table, the predicate alone held only against a *sequential* second accept; [transactions-atomicity.md](transactions-atomicity.md) covers why `lockTargetRow` is what makes it a concurrency guard. `assertConsistent` catches neither case — it inspects one invitation at a time, and two accepted invitations for one slot satisfy "bound IFF accepted" vacuously.

## Open invitations: the register path (#23)

A request with neither target set is legal — the invitee had no account when the admin typed their address, so there is no row to point at. Such a row cannot be accepted as it stands: `verifyInvitationAuthority` compares the actor's org id against `null` and refuses, and `lockTargetRow`/`unboundTargetSlot`/`associationStatement` each throw on a missing target.

Registration binds before accepting because binding leaves the row `pending` with a target, which is recoverable — the planter can answer later — whereas claiming first and creating the organization second would, on a crash, leave an invitation reading `accepted` with no association behind it. `createAccountEntities` therefore sets NEITHER oversight FK.

## No invitation that cannot be answered (ruled 2026-08-04, #23)

The only place an invitation can be answered today is `/register` — the link creates the org and redeems in one request — and somebody who already registered cannot register again. Hence the blanket refusal, placed in the logic layer so a forged direct call is refused too. One message for every account, deliberately: the finer-grained refusals it replaced told an inviter what KIND of account sits behind an address.

Consequently `createInvitation` currently issues only OPEN invitations, and `assertTargetSlotFree`/`heldOversightSlot` are reachable only for a hand-built targeted row until #277 restores the targeted path.

## A token is bound to the address (ruled 2026-08-04, #23)

An invite link is a uuid in a URL — forwarded, pasted, archived — and it buys two things: the association, and (when `BETA_INVITE_CODE` is set) a bypass of the beta gate, which is why both go through one check (`registrationEmailMatchesInvitation`, `(auth)/register/beta-gate.ts`) before the gate and before any account exists. A row with NO recorded address (pre-#23) matches nobody. The register form pre-fills the address `readOnly` — not `disabled`, which submits nothing — but that is convenience: the action is a POST that never saw the form.

## Slot checked twice; revoke scoped to the org

The create-time refusal is SELECT-then-INSERT, so two racing admins still both get a row. Deleting it loses the legible refusal; deleting the accept-time one loses correctness.

`revokeInvitationQuery` matches on the session's org FK, not `inviter_user_id`, and the surface dropped its per-row `canRevoke`. List and revoke are both built from `invitingOrgOf(actor)` so they cannot disagree about "ours"; any role that does not invite, and any oversight admin with no org, produces `false` and matches nothing.

## Severing does not exist yet — and that is a privacy fact

The `disassociate*` primitives were three of the eleven unauthenticated `"use server"` exports #265 removed, each of which detached any church from its oversight org for anyone who could guess a uuid. They are **not** dead code: ruled 2026-08-03 (#274, `product-docs/features/oversight/frd.md` OV-007/OV-010) that **both sides may sever** — the plant's planter or the org's admin — with the wrappers shipping in #277 and #278. Until then a plant that accepts once cannot withdraw the exposure the ungated portfolio listing gives it (see [hierarchical-access.md](hierarchical-access.md)).
