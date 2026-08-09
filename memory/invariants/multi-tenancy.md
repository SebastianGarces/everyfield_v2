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

**WHAT THE SENDING CHURCH'S ACCEPT AND DECLINE DO — and what it took (#351 RULED, 2026-08-09; migration 0033).** Accept sets `sending_churches.sending_network_id` through the ordinary accept batch, WRITES an `association_events` row and NOTIFIES the network on the milestone rail; decline sets the status and notifies. For most of #304's life the middle clause of each was missing, and the reason was structural rather than a decision: both target tables made a CHURCH their mandatory tenant. `association_events.church_id` was NOT NULL because its subject was a plant; `notifications.church_id` was NOT NULL because it is the tenancy boundary every read filters on (N-010), depended on by 121 references across `src/lib/notifications/`, and `memory/invariants.md` gives a null `church_id` the repo-wide meaning "global content" on a FEATURE table. A sending church joining a network names no church, so neither row had anywhere honest to be filed, and nulling either tenant column was the one move not available.

#351 ruled for the two shapes each table's own header had asked for.

* **`association_events` gains a SUBJECT.** `subject_type` ∈ {`church`, `sending_church`}, one nullable FK per kind (`church_id`, `subject_sending_church_id`), and a CHECK that EXACTLY ONE is set. `church_id` is nullable here and that emphatically does not mean "global content": the CHECK makes a subject-less row unwritable, which is precisely what the old NOT NULL was standing in for. `AssociationSubject` in `audit.ts` is the union with no "both" and no "neither" value, and `toSubjectColumns` is the one place it becomes columns — so the CHECK is satisfied by construction rather than by a writer remembering to null the other side.
* **`notifications` gains an ANCHOR.** `anchor_type` ∈ {`church`, `sending_church`, `network`}, plus a single `anchor_org_id`, plus the same exactly-one CHECK. **ONE TABLE, not a parallel org-notifications table** — two would mean two queues, two dispatchers, two feeds and two places to re-implement the at-most-once delivery guarantee. Every church-scoped read is byte-for-byte unchanged (`scopedWhere` still names `church_id`); the org reads (`orgScopedWhere`, `orgNotificationFeedQuery`, `orgUnreadCountQuery`) name `anchor_org_id`. **Neither coalesces**, and with the CHECK guaranteeing one populated column per row the two predicates partition the table — which is what makes "an org's row can never appear in a plant's feed" a property rather than a habit.

**WHY `anchor_org_id` IS ONE COLUMN AND `association_events` GOT TWO.** Not taste — the dedupe index. Idempotency (N-001) is a partial UNIQUE index over (anchor, recipient, key), and NULLs never collide in a btree unique index. With a nullable column per org kind, every org-anchored row would have carried a NULL in its index key and `dedupeKey` would have silently stopped being idempotent for exactly the rows this change adds. A single non-null `anchor_org_id` keeps the guarantee; it carries no FK for the same reason `association_events.org_id` does not (no polymorphic FK in Postgres), and it gets its OWN index plus its OWN `ON CONFLICT` clause in `insertIfAbsent`. The church index is deliberately untouched: its predicate is mirrored byte-for-byte by that clause and every keyed enqueue in the product rides it. `association_events`'s subject is a tenancy anchor with only two kinds and no dedupe index over it, so it can afford real FKs.

**THE ORG GATE IS ITS OWN GATE.** `enqueue`'s gate 1 for an org-anchored row is `recipientAdministersOrg`: this recipient's own org FK equals the anchor, and their role is an oversight one. It is not `canAccessChurch` with a hole in it — that helper resolves an oversight admin's reach THROUGH a plant's FKs, and there is no plant here. It is not a hierarchy walk either: a network admin does not receive a SENDING CHURCH's own notifications, because the row is filed under the sending church, which is a different tenant (the same rule that keeps a plant's rows out of its network's feed). And consent has no third party to come from — there is no plant that could have opted in — so a category that REQUIRES sharing is refused outright rather than approximated. Today only the three consent-exempt own-relationship milestones are org-anchored, so that refusal is a fail-closed floor rather than a live path.

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

## The success notice may only offer a link that works (#304, HR4 2026-08-09)

`/register?invitation=…` is the delivery mechanism for an OPEN invitation and a dead end for a targeted one: the addressee already has an account and cannot register again. `createInvitationAction` therefore reports `inviteePath: null` when the row it just wrote carries either target, read off the row rather than guessed from the address — `resolveInvitationTarget` is the only thing that knows. The notice then tells the admin the invitee answers in-app, instead of handing them something useless to forward.

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
