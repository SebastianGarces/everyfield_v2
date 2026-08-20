# Multi-Tenancy

Why and how, for the Multi-Tenancy rules in [`../invariants.md`](../invariants.md). Almost all of it is invitations, the only path that creates a cross-tenant association.

**Source:** `src/lib/invitations/` (`core.ts`, `audit.ts`, `email.ts`, `resend.ts`, `history.ts`, the import-free leaves), `src/lib/notifications/`, `src/lib/oversight/`, `src/app/(auth)/register/`, `src/db/schema/*.ts`

The two oversight FKs are **independent associations held side by side**; neither is the route to the other. Isolation is application-layer: a missing `church_id` predicate is a cross-tenant read with nothing behind it to catch the mistake.

## Answering an invitation

- **An accept never replaces an association (⚖).** The guard is on the **claim**, so a refused accept writes nothing rather than committing an acceptance with no association behind it; re-binding the same org stays an idempotent no-op for the replay path. Being a subquery it holds only against a *sequential* second accept — [transactions-atomicity.md](transactions-atomicity.md) has the lock.
- **No invitation that cannot be answered (⚖), per invitation TYPE.** A targetable role with nowhere to answer was closed by BUILDING the surface, not by re-gating the path; a test enumerates the types, so a fourth fails until its answering view and its LEAVE control exist.

## One table decides which role administers which kind of org

- **Half of `OVERSIGHT_ADMIN` is still a pairing written per site.** State what the compiler was OBSERVED to do: add a third union member, run `pnpm typecheck`, read the output, restore the file. The one correspondence left written out is the `churches.sending_*_id` column, so a new kind must fail there.
- **The audience carries no `OVERSIGHT_ROLES` floor, and one must not be added back.** Every arm already names its role from the table, and an arm edited to a non-oversight role would be silently ANDed to zero: a floor that turns a loud error into silence is not a floor.

## Severing

- **Both sides may sever (⚖ OV-007/OV-010)**, each on the surface owning its authority rule, behind a type-to-confirm dialog, notifying the other side and writing an `association_events` row. The planter's action takes an org KIND, the org admin's a CHURCH id, the sending church's **no argument at all**; the endpoints stay SEPARATE, because a role branch inside one puts the authority rule in the client's hands. A sever whose subject the audit table cannot hold does not ship at all.

## The surface never answers "does this address have an account?"

- **An existing account can be invited again (⚖), and every refusal after target resolution is ONE message.** The rule is POSITIONAL, not an enumeration: collapsing only the refusals somebody named left the oracle open one guard away. The pre-resolution authority pass keeps its own messages, which describe the actor's own account.
- **The success path is the cheaper probe, so it is neutral too (⚖):** one message for both branches, no `/register?invitation=` link on any admin surface, and the collapse is in the PAYLOAD — two shapes crossing the wire is an oracle whatever the component renders.
- **The rule is the PAGE, not the notice.** Nothing derived from the two target columns reaches that client: not an `isOpen` flag, not a caption from `invitation.type`, which flips to the resolved kind when the address has an account. Reviving a refused path re-arms every conditional that was safe only because the path was dead.
- **The same closure holds at `/register`, at BOTH readers of the row** — a token buys a describable invitation and a beta-gate bypass, so ONE predicate serves both: pending, unexpired, non-empty address, both target columns null. **Ruling C:** the anonymous POST returns no per-row messages, and ONE decision feeds the bypass, the church-plant requirement and the redemption, or the mismatch stays legible in which branch fires.
- **The residual, so this is not read as a guarantee:** the GET still answers for an OPEN row, because such an invitation must be redeemable and naming the inviter is what makes the link answerable. Retires only when invite-at-registration does.

## Resending the email (⚖ nothing persisted)

- The ruling is a **Resend email** action on pending rows, persisting nothing. An `email_sent` column also fails on the merits: `sent` from the provider is *acceptance*, not delivery.
- **One status decision, still in the sender**: the resend calls the create's path and keeps the refusal reason, adding only the expiry, because the sender guards the STATUS and not the window. **No refusal offers a link** — when a ruling removes a CONTROL, grep the copy and the docblocks too.
- **Accepted residual (⚖):** the resend cooldown is per client session, so a reload or a second admin mounts the row with none. Closing it needs a durable last-send record, which the no-persistence constraint refuses, and an idempotent replay returns the ORIGINAL response. The inbox still gets one email per 60-second bucket: the residual is a wrong CLAIM, never a wrong DELIVERY.
- **A failed resend is a failed action**, unlike the create: the send is its entire product, so a refusal throws and renders inline on the row. Authority is the same `invitingOrgOf(actor)` predicate as list and revoke, and "no such invitation" and "not yours" are ONE message, because an invitation id is also an unauthenticated bearer token.
