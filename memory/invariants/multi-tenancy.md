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

## No invitation that cannot be answered (ruled 2026-08-04, #23; premise removed by #304)

The rule survives; the blanket refusal it produced does not. In 2026-08-04 the only place an invitation could be answered was `/register` — the link creates the org and redeems in one request — and somebody who already registered cannot register again, so EVERY existing account was refused and `createInvitation` issued only OPEN invitations. #304 built the surface that removes the premise; see "An existing account can be invited again" below. `assertTargetSlotFree`/`heldOversightSlot` are live again as a result, on the path they were written for.

## A token is bound to the address (ruled 2026-08-04, #23)

An invite link is a uuid in a URL — forwarded, pasted, archived — and it buys two things: the association, and (when `BETA_INVITE_CODE` is set) a bypass of the beta gate, which is why both go through one check (`registrationEmailMatchesInvitation`, `(auth)/register/beta-gate.ts`) before the gate and before any account exists. A row with NO recorded address (pre-#23) matches nobody. The register form pre-fills the address `readOnly` — not `disabled`, which submits nothing — but that is convenience: the action is a POST that never saw the form.

## Slot checked twice; revoke scoped to the org

The create-time refusal is SELECT-then-INSERT, so two racing admins still both get a row. Deleting it loses the legible refusal; deleting the accept-time one loses correctness.

`revokeInvitationQuery` matches on the session's org FK, not `inviter_user_id`, and the surface dropped its per-row `canRevoke`. List and revoke are both built from `invitingOrgOf(actor)` so they cannot disagree about "ours"; any role that does not invite, and any oversight admin with no org, produces `false` and matches nothing.

## Severing — the planter side exists (#304); the org side does not yet

Ruled 2026-08-03 (#274, `product-docs/features/oversight/frd.md` OV-007/OV-010) that **both sides may sever** — the plant's planter or the org's admin. #304/WS1 shipped the planter's half: `/settings/association` → `leaveOversightOrgAs`, behind a type-to-confirm dialog, notifying the org and writing an `association_events` row. The org's half (#278/WS2) is still open, so an org admin cannot yet remove a plant.

**The bare `disassociate*` primitives are not what it calls, and that is the point.** They were three of the eleven unauthenticated `"use server"` exports #265 removed, each of which detached any church from its oversight org for anyone who could guess a uuid. They are still exported, still unwrapped, and still the wrong shape for a sever, because `set fk = null where id = ?` cannot say WHICH org is being left: a plant belongs to a sending church and a network independently, so a sever has to assert `fk = <this org>` in its own WHERE or it takes the other association down with it (or severs for a caller aiming at an org the plant never joined). `severAssociationWithAuditStatement` (`src/lib/invitations/audit.ts`) is that statement.

It is also ONE statement, not a batch, and [transactions-atomicity.md](transactions-atomicity.md) is why: the audit `INSERT` selects `FROM severed`, the UPDATE's own `RETURNING`. Batched side by side, an UPDATE that matched nothing is not an error and does not roll the batch back, so a refused sever would have committed an audit row asserting a sever that never happened — the exact inverse of what an audit is for. The accept path needs the same care for the same reason and gets it differently: its audit is a fourth batch statement whose WHERE re-asserts the association, the claim and "no `associated` row for this invitation yet".

**Telling the org is a tenancy problem, not just a consent one.** `canAccessChurch` resolves an oversight admin's reach from the plant's CURRENT FK, so at the moment of a decline (never associated) or a sever (just nulled) the answer is false — and the notification would be skipped `outside_church`. `enqueue` therefore accepts a second, narrower basis for exactly two server-composed types (`OVERSIGHT_OWN_RELATIONSHIP_TYPES`): this org and this plant have a relationship ON RECORD, an invitation or an `association_events` row. It is asked only after `canAccessChurch` has refused, and it is unreachable for every other notification in the product.

## An existing account can be invited again (#304)

The 2026-08-04 blanket refusal of every registered address (`ACCOUNT_EXISTS_MESSAGE`) rested on a premise it named out loud: the only place an invitation could be answered was `/register`. #304 built `/settings/association` and the dashboard reminder, so the targeted path is back — `inviteeAccountTarget` maps a `planter` to their `church_id` and a `sending_church_admin` to their `sending_church_id`, and refuses everything else with ONE message (`ACCOUNT_NOT_INVITABLE_MESSAGE`). The single message is not tidiness: distinguishing "a team member" from "a coach" from "a planter with no plant yet" tells an inviter what kind of account sits behind an address they otherwise know nothing about.
