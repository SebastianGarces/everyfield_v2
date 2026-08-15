# Multi-Tenancy

Why and how, for the Multi-Tenancy rules in [`../invariants.md`](../invariants.md). Almost all of it is invitations, the only path that creates a cross-tenant association.

**Source:** `src/lib/invitations/` (`core.ts`, `audit.ts`, `email.ts`, `resend.ts`, `history.ts`, the import-free leaves), `src/lib/notifications/`, `src/lib/oversight/`, `src/app/(auth)/register/`, `src/db/schema/*.ts`

The two oversight FKs are **independent associations held side by side**; neither is the route to the other. Isolation is application-layer: a missing `church_id` predicate is a cross-tenant read with nothing behind it to catch the mistake.

## Answering an invitation

- **An accept never replaces an association (⚖).** The guard is on the **claim**, so a refused accept writes nothing rather than committing an acceptance with no association behind it; re-binding the same org stays an idempotent no-op for the replay path. Being a subquery it holds only against a *sequential* second accept — [transactions-atomicity.md](transactions-atomicity.md) has the lock.
- `assertConsistent` catches neither case: it reads one invitation at a time, and two accepted invitations for one slot satisfy "bound IFF accepted" vacuously.
- **An invitation with neither target set is legal**, because the invitee had no account when the address was typed. Registration BINDS before accepting: a bound `pending` row is recoverable, while claiming first leaves, on a crash, an `accepted` row with no association.
- **No invitation that cannot be answered (⚖), per invitation TYPE.** A targetable role with nowhere to answer was closed by BUILDING the surface, not by re-gating the path; a test enumerates the types, so a fourth fails until its answering view and its LEAVE control exist.
- **One route, two views, one authority rule**: the role branch is not the control, since both views pass the same actions an invitation id and nothing else.
- **"Pending" is not "answerable."** Expiry is LAZY, so any list offering an ANSWER carries `(expires_at is null or expires_at > now)` — worst on the dashboard reminder, dismissible only by answering.

## The subject and the anchor: filing a row that names no plant

A sending church joining a network names no church, and both target tables made a CHURCH their mandatory tenant. Nulling a tenant column was unavailable, because a null `church_id` on a FEATURE table means "global content" repo-wide.

- **`association_events` gains a SUBJECT** (`subject_type`, one nullable FK per kind, a CHECK that EXACTLY ONE is set). Nullable `church_id` here is not global content: the CHECK makes a subject-less row unwritable, and one function turns the union into columns, so it holds by construction.
- **`notifications` gains an ANCHOR** (`anchor_type`, one `anchor_org_id`, the same CHECK) in **ONE TABLE, never a parallel org-notifications table** — two means two queues, two dispatchers, two feeds, two at-most-once implementations. Church and org reads name different columns and **neither coalesces**, so the predicates partition the table.
- **`anchor_org_id` is ONE column while the audit subject got two, because of the dedupe index:** NULLs never collide in a btree unique index, so a nullable column per org kind silently ends idempotency for exactly these rows. It carries no FK — Postgres has no polymorphic FK.

## One table decides which role administers which kind of org

- `OVERSIGHT_ADMIN` is keyed on org type, each row `{ role, fk }`, TYPE-IMPORT-ONLY, and stays out of `access.ts`, which imports `@/db`: policy that costs a database connection is policy nobody reuses.
- **The gate pairs the role with the FK**, because both org FKs live on one `users` row and "an oversight role" is too coarse. The SQL audience and the per-recipient gate encode ONE decision; written per site they drifted, and the unpaired audience starved plants of the daily digest.
- **Half a table is still a pairing written per site.** State what the compiler was OBSERVED to do: add a third union member, run `pnpm typecheck`, read the output, restore the file. The one correspondence left written out is the `churches.sending_*_id` column, so a new kind must fail there.
- **An `SQL | undefined` audience never reaches an `and()`.** Drizzle drops undefined arms until an empty `and()` disappears, so an `exists (…)` matches every row in `users` and every plant is owed a digest forever; the overloaded builder makes that a compile error.
- **The audience carries no `OVERSIGHT_ROLES` floor, and one must not be added back.** Every arm already names its role from the table, and an arm edited to a non-oversight role would be silently ANDed to zero: a floor that turns a loud error into silence is not a floor.

## Severing

- **Both sides may sever (⚖ OV-007/OV-010)**, each on the surface owning its authority rule, behind a type-to-confirm dialog, notifying the other side and writing an `association_events` row. The planter's action takes an org KIND, the org admin's a CHURCH id, the sending church's **no argument at all**; the endpoints stay SEPARATE, because a role branch inside one puts the authority rule in the client's hands. A sever whose subject the audit table cannot hold does not ship at all.
- **The bare `disassociate*` primitives are the wrong shape:** `set fk = null where id = ?` cannot say WHICH org is being left, so it takes the other association with it. The sever asserts `fk = <this org>` in its own WHERE, and it is ONE statement because the audit `INSERT` selects `FROM` the UPDATE's `RETURNING` — batched, an UPDATE matching nothing is not an error, so a refused sever would commit an audit row asserting a sever that never happened.
- **Telling the org is a tenancy problem, not just a consent one.** `canAccessChurch` reads the plant's CURRENT FK, false at a decline or sever, so `enqueue` accepts a narrower recorded-relationship basis for exactly two server-composed types, asked only after `canAccessChurch` refuses. The org side's own notification is deliberately not an oversight message: its recipient is the plant's planter, so its type cannot match either list in `notifications/categories.ts`.
- **The audit's one reader is scoped to the caller's own org** — reaching a plant is not permission to name the orgs behind it ([hierarchical-access.md](hierarchical-access.md)).

## The surface never answers "does this address have an account?"

- **An existing account can be invited again (⚖), and every refusal after target resolution is ONE message.** The rule is POSITIONAL, not an enumeration: collapsing only the refusals somebody named left the oracle open one guard away. The pre-resolution authority pass keeps its own messages, which describe the actor's own account.
- **The success path is the cheaper probe, so it is neutral too (⚖):** one message for both branches, no `/register?invitation=` link on any admin surface, and the collapse is in the PAYLOAD — two shapes crossing the wire is an oracle whatever the component renders.
- **The rule is the PAGE, not the notice.** Nothing derived from the two target columns reaches that client: not an `isOpen` flag, not a caption from `invitation.type`, which flips to the resolved kind when the address has an account. Reviving a refused path re-arms every conditional that was safe only because the path was dead.
- **The same closure holds at `/register`, at BOTH readers of the row** — a token buys a describable invitation and a beta-gate bypass, so ONE predicate serves both: pending, unexpired, non-empty address, both target columns null. **Ruling C:** the anonymous POST returns no per-row messages, and ONE decision feeds the bypass, the church-plant requirement and the redemption, or the mismatch stays legible in which branch fires.
- **The residual, so this is not read as a guarantee:** the GET still answers for an OPEN row, because such an invitation must be redeemable and naming the inviter is what makes the link answerable. Retires only when invite-at-registration does.
- **Pin it by CALLING both readers, never by a regex over the source**, which cannot follow a derivation through an intermediate column. When a rule is about a ROUTE, enumerate that route's readers of the row: one reader fixed is a rule half-recorded.

## A client never names the target

`createInvitation` is a `"use server"` export, so it is an HTTP endpoint, and TypeScript erases: a typed parameter constrains a forged body not at all. **An object spread is not a filter** — for an unregistered address the resolved target contributes no keys, so a forged `targetChurchId` survives and becomes the target, and a forged `targetSendingChurchId` even chooses the KIND of association.

Three closures, in order: the request is CONSTRUCTED key by key from the server-resolved target, so a field added later is not forwarded unless somebody writes it in; the caller strips those keys at its own call site, because the resolver is exported; and the endpoint parses `z.strictObject` after the session check — strict, not stripping, so a probe fails loudly. **Every `"use server"` export whose parameter is a typed object parses a strict runtime schema.**

## Rate limits protect an organization, not an address

- **An org cannot keep a banner up.** The reminder carries the org's name and is dismissible only by ANSWERING, so without a cap a decline-and-reissue loop runs forever. It counts **every status**, because counting only pending rows counts exactly the invitations that are not the problem; it runs **before** target resolution, so it is not one of the refusals that must collapse into one message; and it covers **open invitations too**, or it is the account-existence oracle in another costume.
- **An ADDRESS is not the thing being protected.** One org is reachable through several accounts, so a shared predicate re-runs the cap and the duplicate-pending check against the RESOLVED target — and that scope must use the neutral message, since it can only fire on a different address resolving to the same org.
- **The cap resets after a sever**, or a plant that joined and left burns three attempts on invitations it answered. An invitation counts unless the org has an `association_events` row about the same subject strictly NEWER than it, matched by **FK, not `subject_type`** — so an open invitation, and an org with neither id, always count: the fail-CLOSED direction.
- Both caps are SELECT-then-INSERT and not concurrency guards; two simultaneous submissions passing the last attempt is accepted.
- **The slot is checked twice** and both survive: deleting the create-time refusal loses the legible message, deleting the accept-time one loses correctness. Revoke matches the session's org FK rather than `inviter_user_id`, and list and revoke share `invitingOrgOf(actor)`.

## A token is bound to the address

An invite link is a uuid in a URL — forwarded, pasted, archived — buying the association plus the beta-gate bypass, so both go through one check before the gate and before any account exists; a row with no recorded address matches nobody. **The refusal is SILENT**, because `/register` is an anonymous POST and a per-row message there is an account-existence oracle. That leaves the pre-filled `readOnly` address as the only warning an honest user gets — `readOnly`, not `disabled`, which submits nothing.

## The invitation email

- **It is not a notification**: the invitee has no account, so there is no preference row, no category and nothing to unsubscribe from, and the message carries no `List-Unsubscribe`.
- **It is best-effort, and the status guard lives in the sender**, because a rollback on a failed send sends the admin's retry into the duplicate-pending refusal. `emailSent` is three-valued (`true` / `false` / nothing tried) and must not be collapsed to a boolean.
- **The id is a bearer credential, so it is never logged** — not the id, URL, subject or address. Failure logs carry the invitation TYPE and a reason code.
- **One spelling of the link, in an import-free leaf**, because `email.ts` evaluates the Resend client at module scope: a client component importing the helper from there ships the SDK and the API key into a browser chunk. `src/lib/oversight/org-label.ts` is a leaf for the same reason, and its trunk must never re-export it.
- **The rule is about LEAVES, not one file** — a guard naming one leaf's symbols enforces the instance, and the next leaf breaks it. It walks ONE table with a row per leaf: the leaf imports nothing, exactly one module in `src/` exports its symbols, no `app/` or `components/` module imports them by another specifier, and no prose calls them re-exported. **The table is derived from the directory**, failing by name on any import-free module without a row.
- **One name for the inviting org**, exhaustive over the type union with a `never` guard. A copy taking `type: string` fell through to `null`, so a fourth type breaks the BUILD in one place and silently blanks the org name in the other — where a null name stops the invitation describing itself at all. Derive from `type`, not from whichever FK is populated: the insert performs no type↔id consistency check.

## Resending the email (⚖ nothing persisted)

- The ruling is a **Resend email** action on pending rows, persisting nothing. An `email_sent` column also fails on the merits: `sent` from the provider is *acceptance*, not delivery.
- **One status decision, still in the sender**: the resend calls the create's path and keeps the refusal reason, adding only the expiry, because the sender guards the STATUS and not the window. **No refusal offers a link** — when a ruling removes a CONTROL, grep the copy and the docblocks too.
- **A deliberate resend is not a duplicate.** The create already presented `org-invitation-<id>`, so a resend appends a 60-second bucket to that key, and the suffix doubles as the only rate limit the ruling permits. **The key only counts if the provider is given it**: `headers` is the message's own RFC block, while request idempotency is the SECOND argument to `resend.emails.send(payload, { idempotencyKey })` — in the header map it type-checks, delivers mail, and does nothing.
- **The button refuses for the rest of the bucket it just keyed**, or the product reports "Email sent" over a collapsed message. One piece of arithmetic builds both the key suffix and the countdown, and only DURATIONS cross to the browser.
- **Accepted residual (⚖):** the cooldown is per client session, so a reload or a second admin mounts the row with none. Closing it needs a durable last-send record, which the no-persistence constraint refuses, and an idempotent replay returns the ORIGINAL response. The inbox still gets one email per bucket: the residual is a wrong CLAIM, never a wrong DELIVERY.
- **A failed resend is a failed action**, unlike the create: the send is its entire product, so a refusal throws and renders inline on the row. Authority is the same `invitingOrgOf(actor)` predicate as list and revoke, and "no such invitation" and "not yours" are ONE message, because an invitation id is also an unauthenticated bearer token.

## What a decline may say back

A decline is the one milestone whose recipient never became associated with the plant, so it names the ADDRESS THE ORG TYPED and nothing else: naming the plant hands a stranger the organization behind an address they may have guessed. The field is named for what it does — a `plantName` that sometimes holds an email is how the leak came back the first time.

## Source-shaped tests anchor through the shared reader

Suites here assert on the SOURCE of a function, because the subject is a client component or a `"use server"` module a unit test cannot execute — and slicing with `indexOf` rots in BOTH directions: it returns -1, so `slice(start, -1)` returns almost the whole file while `slice(-1, end)` returns the EMPTY STRING, where `assert.doesNotMatch("", /anything/)` is a tautology. `sourceReader` (`src/lib/testing/source-span.ts`) is the only way in, every anchor is a DECLARATION rather than a docblock, a bare `indexOf` is allowed only where a branch HANDLES -1, and a directory is converted AND added to the `indexOf` scan in one change.

Write a source-shape guard by IMPORTING the shared scanner (`staticValueSpecifiers`, `src/lib/auth/server-action-surface.ts`): a hand-rolled `^import` is blind to `export … from` — the shape the leaf rule forbids — and to an indented import, while `import()` is excluded deliberately, because deferring `@/db` into the call is what *satisfies* the seam rule.
