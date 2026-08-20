# Multi-Tenancy

Why and how, for the Multi-Tenancy rules in [`../invariants.md`](../invariants.md). Almost all of it is invitations, the only path that creates a cross-tenant association.

**Source:** `src/lib/invitations/` (`core.ts`, `audit.ts`, `email.ts`, `resend.ts`, `history.ts`, the import-free leaves), `src/lib/notifications/`, `src/lib/oversight/`, `src/app/(auth)/register/`, `src/db/schema/*.ts`

The two oversight FKs are **independent associations held side by side**; neither is the route to the other. Isolation is application-layer: a missing `church_id` predicate is a cross-tenant read with nothing behind it to catch the mistake.

## Answering an invitation

- **An accept never replaces an association (⚖).** The guard is on the **claim**, so a refused accept writes nothing rather than committing an acceptance with no association behind it; re-binding the same org stays an idempotent no-op for the replay path. Being a subquery it holds only against a *sequential* second accept — [transactions-atomicity.md](transactions-atomicity.md) has the lock.
- **No invitation that cannot be answered (⚖), per invitation TYPE.** A targetable role with nowhere to answer was closed by BUILDING the surface, not by re-gating the path; a test enumerates the types, so a fourth fails until its answering view and its LEAVE control exist.

## One table decides which COLUMN carries which kind of org

- **`OVERSIGHT_ADMIN` lost its `role` half with `users.role` (#494).** A row is now `{ fk }` alone, and what the role used to say — "this account speaks for THIS kind of org and nothing else" — is said instead by `oversightOrgOf` (`@/lib/auth/tenancy`), which answers only for a row naming exactly one tenancy FK.
- **Half of `OVERSIGHT_ADMIN` is still a pairing written per site.** State what the compiler was OBSERVED to do: add a third union member, run `pnpm typecheck`, read the output, restore the file. The one correspondence left written out is the `churches.sending_*_id` column, so a new kind must fail there.
- **The audience arm is the FK AND the rest of the tenancy rule, and it must not be narrowed to the FK alone.** The other columns are derived from the table's own rows, so an arm cannot be edited to name one FK and forget another. Widening it back to `or(fk, fk)` re-admits a row carrying a competing tenancy — the hierarchy walk, arriving through a column nobody checked against the rest of the row.

## Severing

- **Both sides may sever (⚖ OV-007/OV-010)**, each on the surface owning its authority rule, behind a type-to-confirm dialog, notifying the other side and writing an `association_events` row. The plant Owner's action takes an org KIND, the org's a CHURCH id, the sending church's **no argument at all**; the endpoints stay SEPARATE, because a tenancy branch inside one puts the authority rule in the client's hands. A sever whose subject the audit table cannot hold does not ship at all.

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

## Seat invitations — the same rulings, a second table (#495)

`user_invitations` invites a PERSON into a tenancy; `organization_invitations` binds one ORG to another. Two tables because the subjects, the answers and the surfaces differ; one `kind` column because a coach assignment is the same shape as a seat.

- **AS-010 inverts one clause and keeps the rest whole.** A seat invitation is REGISTER-ONLY, so an existing account is REFUSED rather than targeted — and the refusal is the same `ACCOUNT_NOT_INVITABLE_MESSAGE`, for a plant seat holder, an oversight seat holder and a coach alike. There is no arm that admits one: "no invitation that cannot be answered" forbids creating a row whose only answer is registering.
- **The positional property is unchanged, and it is why the cap keeps its own words.** Authority, the email parse, the duplicate check and the 3-per-window cap all read the caller's OWN rows for an address the caller typed, so they answer identically whether or not an account exists — and they run above the `users` lookup. Below it there is exactly one sentence and it is the imported constant.
- **Nothing is a second copy.** The constants, the resend refusal words, the register-path spelling, the created-notice copy and the pending-list COMPONENT are all the org surface's, given `/settings/team`'s own two actions. A second `ResendInvitationEmailState` is how the countdown starts working on one surface and not the other.
- **The token is a secret rather than a row id**, which is the one place the two paths differ by design. The org credential is the row's uuid, so anybody who reads the row holds it; here the database stores sha256 and the plaintext exists only in transit. A resend therefore cannot repeat a link and rotates instead — and the email says earlier links stop working.
- **Single use is `users_email_unique`, not the claim.** The claim is a compare-and-set on `pending` batched with the account, but the token is bound to one address, so at most one account can ever be created for it. **Accepted residual:** a revoke committing between the register GET and that batch leaves an account holding the seat while the row reads `revoked`; closing it needs the users insert itself to be conditional on the invitation.
