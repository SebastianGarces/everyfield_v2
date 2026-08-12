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

**The rule is per INVITATION TYPE, and it is checked per type.** `inviteeAccountTarget` maps two roles to a target, so two of the three types can name an existing account, and each needs its own in-app answer. As of #304 WS3 (ruled 2026-08-09) **both of them have one**:

* `church_to_sending_church` / `church_to_network` → the target is a plant, the answerer is its planter, and the surface is `/settings/association` plus the dashboard reminder (#304 WS1);
* `sending_church_to_network` → the target is a sending church and the answerer is its admin. `verifyInvitationAuthority` has always accepted that answer (`core.ts`, the `sending_church_to_network` arm); the SURFACE that offers it is the second view of `/settings/association` (#304 WS3).

That second view is what closes the gap HR4 found on 2026-08-09 — a `sending_church_admin` was targetable with nowhere in the product to answer from — and Sebastian ruled it closed by BUILDING the surface, not by re-gating the path. The first build's own rewrite of this file declared the rule resolved for all roles while it was true only for planters; it is now true, and it is true by a test rather than by this paragraph.

**ONE ROUTE, TWO VIEWS, and the authority rule is shared.** `/settings/association` branches on the session's role: a `planter` with a plant gets the plant view, a `sending_church_admin` with a sending church gets the network view, everyone else is redirected. The redirect is not the control — both views hand the same `acceptAssociationInvitation` / `declineAssociationInvitation` actions an invitation id and nothing else, so WHO may answer is decided once, per invitation TYPE, by `verifyInvitationAuthority`. A non-admin member of the target sending church is refused there, exactly as a `team_member` of a plant is. There is no second pair of endpoints for the two surfaces to disagree about.

**How the claim stays true.** `answer-surfaces.test.ts` enumerates `organizationInvitationTypes` and, for each type that `inviteeAccountTarget` can produce, asserts four things: the role that answers it, that a surface reads a pending list for that role, that `/settings` links the surface to that role, and — since OV-013 — that the same surface carries a type-to-confirm LEAVE control wired to an action that takes no entity id. A fourth invitation type, or a third role added to `inviteeAccountTarget`, fails that test until its answering view AND its leave control exist — which is the only form of this invariant that cannot rot. The leave half belongs in the same test because it is the same claim one step on: a role an invitation can ASSOCIATE must be able to end that association from the surface it answered on.

**WHAT THE SENDING CHURCH'S ACCEPT AND DECLINE DO — and what it took (#351 RULED, 2026-08-09; migration 0036).** Accept sets `sending_churches.sending_network_id` through the ordinary accept batch, WRITES an `association_events` row and NOTIFIES the network on the milestone rail; decline sets the status and notifies. For most of #304's life the middle clause of each was missing, and the reason was structural rather than a decision: both target tables made a CHURCH their mandatory tenant. `association_events.church_id` was NOT NULL because its subject was a plant; `notifications.church_id` was NOT NULL because it is the tenancy boundary every read filters on (N-010), depended on by 121 references across `src/lib/notifications/`, and `memory/invariants.md` gives a null `church_id` the repo-wide meaning "global content" on a FEATURE table. A sending church joining a network names no church, so neither row had anywhere honest to be filed, and nulling either tenant column was the one move not available.

#351 ruled for the two shapes each table's own header had asked for.

* **`association_events` gains a SUBJECT.** `subject_type` ∈ {`church`, `sending_church`}, one nullable FK per kind (`church_id`, `subject_sending_church_id`), and a CHECK that EXACTLY ONE is set. `church_id` is nullable here and that emphatically does not mean "global content": the CHECK makes a subject-less row unwritable, which is precisely what the old NOT NULL was standing in for. `AssociationSubject` in `audit.ts` is the union with no "both" and no "neither" value, and `toSubjectColumns` is the one place it becomes columns — so the CHECK is satisfied by construction rather than by a writer remembering to null the other side.
* **`notifications` gains an ANCHOR.** `anchor_type` ∈ {`church`, `sending_church`, `network`}, plus a single `anchor_org_id`, plus the same exactly-one CHECK. **ONE TABLE, not a parallel org-notifications table** — two would mean two queues, two dispatchers, two feeds and two places to re-implement the at-most-once delivery guarantee. Every church-scoped read is byte-for-byte unchanged (`scopedWhere` still names `church_id`); the org reads (`orgScopedWhere`, `orgNotificationFeedQuery`, `orgUnreadCountQuery`) name `anchor_org_id`. **Neither coalesces**, and with the CHECK guaranteeing one populated column per row the two predicates partition the table — which is what makes "an org's row can never appear in a plant's feed" a property rather than a habit.

**WHY `anchor_org_id` IS ONE COLUMN AND `association_events` GOT TWO.** Not taste — the dedupe index. Idempotency (N-001) is a partial UNIQUE index over (anchor, recipient, key), and NULLs never collide in a btree unique index. With a nullable column per org kind, every org-anchored row would have carried a NULL in its index key and `dedupeKey` would have silently stopped being idempotent for exactly the rows this change adds. A single non-null `anchor_org_id` keeps the guarantee; it carries no FK for the same reason `association_events.org_id` does not (no polymorphic FK in Postgres), and it gets its OWN index plus its OWN `ON CONFLICT` clause in `insertIfAbsent`. The church index is deliberately untouched: its predicate is mirrored byte-for-byte by that clause and every keyed enqueue in the product rides it. `association_events`'s subject is a tenancy anchor with only two kinds and no dedupe index over it, so it can afford real FKs.

**THE ORG GATE IS ITS OWN GATE.** `enqueue`'s gate 1 for an org-anchored row is `recipientAdministersOrg`: this recipient's own org FK equals the anchor, and their role is the one that administers THAT KIND of org — `sending_church` → `sending_church_admin`, `network` → `network_admin` (#304 ruling 4, item 6). "An oversight role" was too coarse and reopened the hierarchy walk through the role instead of the FK: both org FKs live on the same `users` row, so a `network_admin` who also carries a `sending_church_id` (a founder who administers both, or a row where the second FK was set once and never cleared) passed the sending-church arm and received that sending church's own notifications. `listOversightAdminsOfOrg` pairs the role with the FK inside each `or` arm for the same reason — two places decide who administers an org, and an audience wider than the gate produces silent drops while a narrower one produces notifications nobody was told about. It is not `canAccessChurch` with a hole in it — that helper resolves an oversight admin's reach THROUGH a plant's FKs, and there is no plant here. It is not a hierarchy walk either: a network admin does not receive a SENDING CHURCH's own notifications, because the row is filed under the sending church, which is a different tenant (the same rule that keeps a plant's rows out of its network's feed). And consent has no third party to come from — there is no plant that could have opted in — so a category that REQUIRES sharing is refused outright rather than approximated. Today only the three consent-exempt own-relationship milestones are org-anchored, so that refusal is a fail-closed floor rather than a live path.

**THE THREE DOWNSTREAM ONE-LINERS FLIPPED TOGETHER**, as the previous version of this file said they would have to: `auditableAssociationOrg`'s `sending_church_to_network` arm now returns the real subject, and the `if (updated.targetChurchId)` gates on the accept and decline paths each gained an `else if (updated.targetSendingChurchId)` arm that announces to the network. The decline arm obeys the same disclosure rule as the planter's: it names the ADDRESS THE ORG TYPED (`invitee_email`) and never looks the sending church up.

`scripts/g3-association-lifecycle.ts` §7 was the tripwire, and it has been tripped: it used to print three `UNMET #351` lines and assert the ABSENCE of the audit row and both milestones, so that a green run could never be read as a pass. It now REQUIRES all three — the row's subject columns, both notifications' anchors, and the decline naming the address rather than the org — and §8 exercises OV-013 end to end.

## OV-013 — the sending church leaves its network (#304 WS3)

The Leave control that was deliberately absent from the sending-church view now exists, and its absence and its arrival are the same rule: **#274 requires a type-to-confirm, a notification AND an `association_events` row of every sever**, so a sever whose subject the audit table cannot hold does not ship at all. It waited on the schema, never on a design question.

`leaveNetworkAsSendingChurchAdmin` (`core.ts`) takes **no argument at all** — not an org id, not a kind. The sending church is the actor's own, the network is whatever that sending church currently points at, and a sending church associates with networks and nothing else. So "only the sending church's admin may sever" is structural before it is a check; the explicit `role !== "sending_church_admin"` refusal exists to make it legible, and a non-admin member is refused server-side whether or not they ever loaded the dialog.

`severAssociationWithAuditStatement` serves it unchanged in shape: one statement, the audit `INSERT` selecting `FROM` the UPDATE's `RETURNING`, and a WHERE that nulls the FK only while it still points at the network being left. What `subjectSql` added is which table and which subject column — and it throws rather than guessing if a caller asks to sever a sending church from anything but a network.

The two leave endpoints are SEPARATE (`leaveOversightOrg`, `leaveNetwork`), and so are their dialogs. One shared endpoint with a role branch would put the choice of authority rule in the client's hands, which is the one thing neither rule permits.

## An org cannot keep a banner up (#304, HR4 2026-08-09)

Restoring the targeted path gave an oversight admin a write onto a stranger's screen: a targeted invitation raises the dashboard reminder, the reminder is dismissible only by ANSWERING (OV-005), and the org's own display name is inside it. `assertNoDuplicatePending` stops two standing at once and does nothing about the replay — a declined row is no longer pending, so the org could re-issue immediately and forever.

`assertInviteRateLimit` caps it: `INVITES_PER_INVITEE_PER_WINDOW` (3) invitations from one inviting org to one address per `INVITATION_EXPIRY_DAYS`, counting **every status**. Counting only pending rows would count exactly the invitations that are not the problem.

Two placement facts matter more than the numbers:

* it runs **before `resolveInvitationTarget`**, so it is not one of the post-resolution refusals that must collapse into `ACCOUNT_NOT_INVITABLE_MESSAGE`. It reads only rows the caller's own org wrote, to an address the caller itself typed;
* it applies to **open invitations too**. A cap that only bit on the targeted path would be the oracle in another costume — "that address is rate-limited, so somebody has an account there".

It is SELECT-then-INSERT and therefore not a concurrency guard (`transactions-atomicity.md`). Accepted: two simultaneous submissions can both pass the fourth attempt, and one extra row does not threaten "an org cannot keep a banner up indefinitely".

**AN ADDRESS IS NOT THE THING BEING PROTECTED (#304 ruling 4, fix 4).** Both create-time caps counted `invitee_email`, and the banner lands on an ORGANIZATION. One organization can be reached through several accounts — every `sending_church_admin` of one sending church resolves to that sending church, and a plant may carry more than one `planter` — so an org that had spent its three attempts at `admin1@…` typed `admin2@…` and started over against the same target, with `assertNoDuplicatePending` blind to the standing invitation as well. `targetReachFilter` is the shared predicate that closes it: `assertInviteRateLimit` runs a SECOND pass after resolution counting rows aimed at the resolved target, and `assertNoDuplicatePending` runs a second pending check the same way.

The two scopes carry two messages, and the split is the positional rule rather than a style choice. The ADDRESS scope stays legible — it describes the actor's own org, on an address the actor typed. The TARGET scope can only fire on a DIFFERENT address that resolved to the same organization, so naming the cap would say "these two addresses belong to one org": a fact about a stranger, refused with `ACCOUNT_NOT_INVITABLE_MESSAGE`.

## A client never names the target (#304 ruling 4, fixes 1–3; HR4 2026-08-09)

`createInvitation` is a `"use server"` export, so it is an HTTP endpoint, and its parameter is an OBJECT. `InvitationRequest` declares `targetChurchId` / `targetSendingChurchId` because those are the keys the SERVER writes on after resolving the typed address — which means the endpoint's declared surface literally included the two fields that decide which organization gets enrolled. TypeScript erases; a typed parameter constrains a forged body not at all.

`resolveInvitationForResolvedTarget` then composed `{ ...request, ...target }`, **and an object spread is not a filter**. For an address nobody has registered `target` is `{}` and contributes no keys, so a caller-supplied `targetChurchId` survived untouched and became the invitation's target: the invited plant's planter saw a real invitation from the attacker's org, and Accept enrolled the plant. The same shape one level down — a resolved CHURCH target left a forged `targetSendingChurchId` in place, and `resolveInvitationRequest` reads the sending-church key first when deciding the `type`, so the forged key even chose the kind of association.

Three closures, and the order matters:

* **the request is CONSTRUCTED, key by key** — the two target keys come from the server-resolved `target` and nowhere else. Not `target.x ?? request.x`, not a partial spread: the only shape with no hole is naming every key. A field added to `InvitationRequest` later is not forwarded unless somebody writes it in;
* **`createInvitationAs` strips them at its own call site** too, passing `{ inviteeEmail, inviteAs }`. Defence in depth, because `resolveInvitationForResolvedTarget` is exported and a future caller will not read its comment;
* **the endpoint parses `z.strictObject` before the logic layer**, AFTER the session check (every action in that module must still reject a sessionless call from its first statement). Strict, not stripping: an unknown key is a refusal, so a probe fails loudly instead of half-working.

The rule generalizes: **every `"use server"` export whose parameter is a typed object parses a strict runtime schema.** The other invitation actions take a bare `invitationId: string` and are covered by the id checks in the logic layer; the object-taking actions in this track (`settings/association/actions.ts`, `oversight/plants/[id]/actions.ts`) parse their own.

## The invitations SURFACE never says whether an account exists (#304 ruling 4, item 5 — RULED 2026-08-09)

This supersedes the earlier HR4 fix, which branched the notice: `/register?invitation=…` for an OPEN invitation, and "they already have an EveryField account" for a targeted one. Both halves are the same disclosure. Ruling 2 collapsed every refusal on an email-resolved target precisely so an authenticated admin could not probe addresses for account existence — and the SUCCESS path answered the identical question, in plainer words, for every address that was not refused. It is the cheaper probe, because it needs no error at all.

So: **one neutral message for both branches** ("This invitation is answered inside EveryField."), and this surface renders **no `/register?invitation=` link**. The collapse is in the PAYLOAD, not only in the component — `CreateInvitationState.created` is `{ inviteeEmail }` and carries nothing derived from the row's two target columns, because two shapes crossing the wire is an oracle whether or not a component renders the difference.

### The rule is the PAGE, not the notice (extended 2026-08-09 on the integration verdict)

The first attempt at item 5 fixed the notice and left the oracle standing one section below it, on a component the track never opened. `/oversight/invitations` renders the create form and the pending list together (`page.tsx`). The page mapped each row to `isOpen: targetChurchId === null && targetSendingChurchId === null` and `invitations-list.tsx` rendered a `/register?invitation=<id>` **Copy link** button on exactly the rows where it was true. So: type an address, read the carefully neutral notice, look at the row that just appeared. Copy link present → that address has no EveryField account. Absent → it has one. One submission per address, no error at all — the identical probe, in a control instead of a sentence.

**It was NEW, not pre-existing.** On `main` `resolveInvitationTarget` refused every address that already had an account, so every creatable invitation was open, `isOpen` was always true and the branch was dead. #304 revives targeting and makes it live. Reviving a refused path re-arms every conditional that was only safe because the path was dead — look for them by hand; a diff of the track's own files will not show them.

**The fix (RULED — Option A, no copy control at all).** `isOpen` is gone from `InvitationListRow`, the page's mapping names five fields and none is target-derived, and `CopyInviteLinkButton` is deleted. The rule now reads: nothing derived from the two target columns reaches this page's client, and no admin-facing surface renders a register link.

**Why not "render the control on every pending row"**, which would have kept the stopgap and removed the variation: it relocates the oracle rather than closing it. `describeInvitationForRegistration` set `redeemable` from those same two columns, and `register-form.tsx` rendered an invitation banner only when it was true — so an admin who copied the link and opened it read the same fact one click later. It also hands a targeted invitee a URL that redeems nothing, which needs copy explaining a distinction we are trying not to draw. The relocation itself is closed as of round 10, below; the link still does not belong on this page.

### The relocation, closed at `/register` itself (round 10, RULED 2026-08-11)

Removing the link raised the bar by one URL concatenation against an audience that already holds the uuid — `RevokeButton` renders it into a hidden input, by design, because Revoke needs it. So the boundary was never "no admin surface renders the link"; it is what the register route answers.

`describeInvitationForRegistration` returns `null` for any row with `target_church_id` or `target_sending_church_id` set, beside its existing nulls for unknown / answered / expired / addressless. A targeted token, an answered one and a guessed uuid therefore produce byte-identical pages, with no session anywhere in the story. `redeemable` is **deleted** rather than left constant-true — a field that cannot vary is a sentence, not data — and `register-form.tsx` and `register/actions.ts` lost their `redeeming` branch with it.

`accountType` **survives**, and the reason is worth writing down because the ruling offered to delete it: it is read off `invitation.type`, which is target-derived *in general* (`resolveInvitationRequest` prefers the resolved target and falls back to `inviteAs` only when there is none) — but every row this function can now describe is OPEN, where the fallback is the only branch that can have run. So what crosses the wire is the inviting admin's own form selection. The two alternatives the ruling named both break a live path: an open `sending_church_to_network` invitation registers a SENDING CHURCH, and a constant `"planter"` would ask that invitee to name a church plant and leave `redeemRegistrationInvitation` nothing to bind. **If a targeted invitation ever becomes describable again, `accountType` goes with it.**

Nothing else moves. `hasValidInvitationBypass` reads `getInvitation` directly and independently requires `registrationEmailMatchesInvitation`, so the beta bypass is unchanged; the email-mismatch guard in `register/actions.ts` stops firing for targeted rows, which is correct — such a registration already dies on "user already exists".

**Pinned by CALLING the function**, never by a regex over the page: both previous rules of this family were guarded by regexes that passed while the property was false. The function reads the database, so it takes a `RegistrationInvitationReader` seam, and `invitations-ui.test.ts` §9c calls it with rows the real resolver produced — three targeted/absent ids deep-equal `null`, one open row still described, and the org lookup provably never reached for a targeted row. `scripts/g3-association-lifecycle.ts` §11 repeats it against real database rows.

## The invite cap resets after a sever (#304 round 10, RULED 2026-08-11)

The cap counts EVERY status, which is what defeats the decline–reinvite loop above. It also meant an association that was ACCEPTED and later ENDED still spent the allowance — and this track ships three ways to end one. A plant that joined and left inside the 30-day window burned an org's three attempts on invitations it had *answered*, so the fourth was refused by `INVITE_RATE_LIMITED_MESSAGE` ("wait for an answer") with nothing pending, or by `ACCOUNT_NOT_INVITABLE_MESSAGE` pointing at a plants list showing nothing. `remove-plant-dialog.tsx` promises "you can invite them back later" in the very dialog that spends the allowance.

`afterTheLastAssociationEventFilter` is the floor, and both count queries carry it — one predicate, for the same reason `targetReachFilter` is one predicate. Per ROW: this invitation counts unless the org has an `association_events` row about the same subject that is strictly NEWER than it. So a join-then-leave cycle refunds exactly the invitations it answered, and a decline — which writes no event at all — refunds nothing.

Two details that are not arbitrary. The subject is matched by **FK**, not by `subject_type`: the exactly-one CHECK makes a non-null `church_id` mean `subject_type = 'church'`, so comparing the invitation's own target column against the matching subject column *is* the discriminator, and an OPEN invitation (no target) matches no event and always counts. And an org carrying neither id matches no event, so every invitation still counts — the fail-CLOSED direction for a cap.

`scripts/g3-association-lifecycle.ts` §10 exercises it end to end on real rows: an org already capped against a sending church associates with it, leaves, and is then allowed a fresh invitation — after which three more declines cap it again.

What is lost, in both halves, is the admin hand-forwarding the register URL out of band — a stopgap for the email delivery that has not shipped, priced at an account-existence disclosure on every successful invite. The token itself is untouched: `/register?invitation=<id>` still redeems an open invitation, and it is what the invitation email will carry. Do not reintroduce a link or a target-derived row field on this page without a ruling that supersedes item 5. Pinned by `invitations-ui.test.ts` §9, which asserts the property behaviourally (two addresses, two target shapes, one rendered surface).

### The derivation is TRANSITIVE — the caption was the third attempt (extended 2026-08-10, on the verdict that rejected the second)

Removing `isOpen` and the Copy-link button left the oracle standing **one field over on the same row**. The page still mapped

```ts
kindLabel: invitation.type === "sending_church_to_network" ? "Sending church" : "Church plant"
```

and `type` is target-derived too. `resolveInvitationRequest` computes `const kind` from the RESOLVED target first and falls back to the admin's `inviteAs` only when there is no target. Executed against the real exported resolver with the exact expression `page.tsx` used, the four combinations a network admin can produce were:

| form selection | address | caption |
|---|---|---|
| Church plant | no account | Church plant |
| Church plant | sending-church admin | **Sending church** |
| Sending church | no account | Sending church |
| Sending church | planter with a plant | **Church plant** |

So the caption equalled the admin's own selection when the address had no EveryField account and flipped when it had one of the other kind. One submission, no error, same screen: pick "Church plant", read "Sending church" on the row that just appeared, and you have learned that the address is a registered sending-church admin with an organization. Same class as the two before it, and it too was **dead code on `main`** — every creatable invitation was open there, so `type` always followed `inviteAs` and the caption could never disagree.

**The fix (Option A again, consistent with `isOpen`).** `kindLabel` is gone from `InvitationListRow`. The row is five fields — `id`, `inviteeEmail`, `status`, `sentLabel`, `expiresLabel` — and the mapping is `toInvitationListRow` in `src/lib/invitations/list-row.ts`, an exported pure function rather than an inline `.map()` in `page.tsx`.

**Why not refuse a kind mismatch instead** (make `type` follow `inviteAs` by rejecting, post-resolution, when the resolved kind disagrees, with `ACCOUNT_NOT_INVITABLE_MESSAGE`): it would fix the silent intent flip, but it ADDS an oracle bit rather than removing one. Today a network admin who picks "Church plant" and types a sending-church admin's address gets a successful create, indistinguishable in outcome from an accountless address. Under the refusal that submission would fail — and a refusal where an accountless address succeeds is precisely the account-existence answer item 5 forbids. The flip itself is not an authority escalation: a network admin may invite both kinds anyway, and a sending-church admin's mismatch is already refused inside `resolveInvitationRequest` and collapsed to the one message. If the caption is wanted back, it needs a column recording what was ASKED, plus a ruling.

**And the reason it survived two guards: the tests were regexes.** `assert.doesNotMatch(page, /targetChurchId/)`, `/isOpen/`, and an allowed-field set that explicitly listed `kindLabel` — every one passed while the property was false, because the derivation ran through `type`. Text checks cannot follow an intermediate column. §9b now CALLS `resolveInvitationForResolvedTarget` for both target shapes, builds a stored row from what it returned, runs `toInvitationListRow` on each and asserts the two are deep-equal, with a `notEqual` on `type` first so the test cannot pass vacuously if targeting is ever refused again. Reintroducing `kindLabel` fails it by name. Keep the regexes as a second net; never as the proof.

## A token is bound to the address (ruled 2026-08-04, #23)

An invite link is a uuid in a URL — forwarded, pasted, archived — and it buys two things: the association, and (when `BETA_INVITE_CODE` is set) a bypass of the beta gate, which is why both go through one check (`registrationEmailMatchesInvitation`, `(auth)/register/beta-gate.ts`) before the gate and before any account exists. A row with NO recorded address (pre-#23) matches nobody. The register form pre-fills the address `readOnly` — not `disabled`, which submits nothing — but that is convenience: the action is a POST that never saw the form.

## Slot checked twice; revoke scoped to the org

The create-time refusal is SELECT-then-INSERT, so two racing admins still both get a row. Deleting it loses the legible refusal; deleting the accept-time one loses correctness.

`revokeInvitationQuery` matches on the session's org FK, not `inviter_user_id`, and the surface dropped its per-row `canRevoke`. List and revoke are both built from `invitingOrgOf(actor)` so they cannot disagree about "ours"; any role that does not invite, and any oversight admin with no org, produces `false` and matches nothing.

## Severing — both sides exist (#304)

Ruled 2026-08-03 (#274, `product-docs/features/oversight/frd.md` OV-007/OV-010) that **both sides may sever** — the plant's planter or the org's admin. #304 shipped both halves, each with the surface that owns its authority rule and each behind a type-to-confirm dialog, notifying the other side and writing an `association_events` row:

* the PLANTER's, `/settings/association` → `leaveOversightOrgAs`. Takes a two-valued org KIND, because one planter genuinely has two associations to choose between;
* the ORG ADMIN's, `/oversight/plants/[id]` → `removePlantFromOrgAs`. Takes a CHURCH id, because an org has many plants — and nothing else. Which org and which KIND come from the session (`oversightOrgOfUser`: a `sending_church_admin` can only end the sending-church association, a `network_admin` only the network one), so there is no parameter an admin of another org could aim, and the write's own WHERE refuses them anyway.

The org side's notification runs the other way and is deliberately NOT an oversight message: its recipient is the plant's planter, a church-level role whose `canAccessChurch` on their own plant is true, so it needs neither the recorded-relationship basis nor a consent exemption. Its type is `association.removed_by_org` rather than `oversight.milestone.*` precisely so it cannot match either list in `notifications/categories.ts` (`src/lib/notifications/plant-association.ts`).

**The audit's one reader is scoped to the caller's own org.** `associationHistoryQuery` (`src/lib/invitations/history.ts`) puts `org_type` and `org_id` in the WHERE alongside `church_id`. Reaching a plant is not permission to name the orgs behind it — the two FKs being independent, an accessible plant's history can contain a sending church in another network entirely (see [hierarchical-access.md](hierarchical-access.md), the same fault the provenance lookup had).

**The bare `disassociate*` primitives are not what it calls, and that is the point.** They were three of the eleven unauthenticated `"use server"` exports #265 removed, each of which detached any church from its oversight org for anyone who could guess a uuid. They are still exported, still unwrapped, and still the wrong shape for a sever, because `set fk = null where id = ?` cannot say WHICH org is being left: a plant belongs to a sending church and a network independently, so a sever has to assert `fk = <this org>` in its own WHERE or it takes the other association down with it (or severs for a caller aiming at an org the plant never joined). `severAssociationWithAuditStatement` (`src/lib/invitations/audit.ts`) is that statement.

It is also ONE statement, not a batch, and [transactions-atomicity.md](transactions-atomicity.md) is why: the audit `INSERT` selects `FROM severed`, the UPDATE's own `RETURNING`. Batched side by side, an UPDATE that matched nothing is not an error and does not roll the batch back, so a refused sever would have committed an audit row asserting a sever that never happened — the exact inverse of what an audit is for. The accept path needs the same care for the same reason and gets it differently: its audit is a fourth batch statement whose WHERE re-asserts the association, the claim and "no `associated` row for this invitation yet".

**Telling the org is a tenancy problem, not just a consent one.** `canAccessChurch` resolves an oversight admin's reach from the plant's CURRENT FK, so at the moment of a decline (never associated) or a sever (just nulled) the answer is false — and the notification would be skipped `outside_church`. `enqueue` therefore accepts a second, narrower basis for exactly two server-composed types (`OVERSIGHT_OWN_RELATIONSHIP_TYPES`): this org and this plant have a relationship ON RECORD, an invitation or an `association_events` row. It is asked only after `canAccessChurch` has refused, and it is unreachable for every other notification in the product.

## An existing account can be invited again — and every refusal is one sentence (#304, ruled 2026-08-09)

The 2026-08-04 blanket refusal of every registered address (`ACCOUNT_EXISTS_MESSAGE`) rested on a premise it named out loud: the only place an invitation could be answered was `/register`. #304 built `/settings/association` and the dashboard reminder, so the targeted path is back — `inviteeAccountTarget` maps a `planter` to their `church_id` and a `sending_church_admin` to their `sending_church_id`.

Restoring that path re-opened the oracle the blanket refusal had closed. An oversight admin types an address and reads the outcome; before this ruling the outcomes were four and each was a fact about a stranger: an invitation was created (no account, or an invitable one), the account cannot be invited, the plant's slot is held by ANOTHER org (`SLOT_TAKEN_MESSAGE`), the plant is already ours (`ALREADY_OURS_MESSAGE`). Probing costs one form submission, and the third answer is somebody else's tenancy.

**So every refusal on an email-resolved target is `ACCOUNT_NOT_INVITABLE_MESSAGE`, and the other two constants are gone.** `assertTargetSlotFree` still computes the three-valued verdict — that is what is true of the row, and collapsing the FACT would hide from the next reader that the distinction ever existed — but the message comes from `slotRefusalMessage`, which is pure and total and maps every non-free verdict to the one sentence, so the collapse is a test over the whole domain rather than a claim about a branch. Every target in the product is email-resolved: there is deliberately no picker (`resolveInvitationTarget`), so there is no second path needing a legible message.

**The rule is POSITIONAL, and the first attempt at it was not.** Collapsing the three refusals the ruling happened to name satisfied its letter and left the oracle open one line away. `createInvitationAs` runs the pure authority rules TWICE: once on a target-less request (before any lookup, to keep the `users` read unreachable for a caller who may not invite at all) and once more on the target the server just resolved. The second call had messages of its own, and one of them was reachable: a `sending_church_admin` probing an address that belongs to ANOTHER sending-church admin hit the `kind === "sending_church"` arm and read back "A sending church can only invite church plants" — a third outcome, distinguishable from both success and the one message, which says "that address is a sending-church admin who has an organization". Exactly the fact about a stranger the ruling forbids, arriving through a guard nobody had listed.

So the invariant is stated by POSITION, not by enumeration: **every refusal reachable after `resolveInvitationTarget` is the one message.** `resolveInvitationForResolvedTarget` is where that holds — it wraps the second pass, is pure, and replaces any refusal with `ACCOUNT_NOT_INVITABLE_MESSAGE` whenever a target was actually resolved. It is deliberately NOT a rewording of `resolveInvitationRequest`, because that same function serves the target-less authority pass, whose messages ("Set up your sending church first") describe the actor's own account and must stay legible. The remaining post-resolution refusals are audited to the same rule: the slot guard has no vocabulary but `slotRefusalMessage`, and `assertNoDuplicatePending` reports the actor's OWN org state — a row their own invitations list already shows them. The test is a property over the whole account domain for both actor roles, asserting the outcome set is exactly {created, the one message}; enumerating branches is what missed it the first time.

What an admin loses is a refusal that told them their own org's state. That state is still legible where it belongs — their pending-invitations list and their plants directory — and neither names anything outside their own tenancy. What they keep is the one bit they need: pick another address.

## What a decline may say back (#304, ruled 2026-08-09)

A decline is the one milestone whose recipient never became associated with the plant. So it names the ADDRESS THE ORG TYPED (`organization_invitations.invitee_email`) and nothing else: no plant name, no lookup of who answered. Naming the plant handed a stranger the organization behind an address they may simply have guessed — the same disclosure `ACCOUNT_NOT_INVITABLE_MESSAGE` exists to prevent, arriving by another route two steps later.

`MilestoneFacts.subject` carries it, and the field is named for what it does rather than for the common case: a `plantName` that sometimes holds an email is how the leak came back the first time.

## "Pending" is not "answerable" (#304, HR4 2026-08-09)

Expiry in this product is LAZY. `expireInvitationQuery` runs only when somebody tries to answer a row whose window has closed (`loadRespondableInvitation`), so a 40-day-old invitation still reads `pending` until then. Any list that offers an ANSWER must therefore carry `(expires_at is null or expires_at > now)` beside the status — `bindOpenInvitationTargetQuery` always did; `pendingInvitationsForPlantQuery` did not, and the dashboard reminder rendered expired invitations with live Accept/Decline buttons the server then refused.

That was worse there than anywhere else, because the reminder is dismissible only by answering (OV-005): the planter had a banner they could neither answer nor remove. A declined or revoked invitation disappears from the same predicate on the next render, which is what makes "dismissed only by answering" a property of the data rather than of the component.
