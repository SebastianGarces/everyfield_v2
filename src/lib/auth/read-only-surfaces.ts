import type { Capability } from "./seat-rules";

// ============================================================================
// THE FRD'S READ-ONLY SURFACE CHECKLIST, AS DATA — AS-020 (#499).
//
// `product-docs/features/accounts-and-seats/frd.md` → "Read-only surface
// checklist" is the SCOPE of the hide-everywhere sweep, and the FRD says why it
// is a table at all: "AS-020 is verifiable only against a list." A list a human
// walks is a claim; this file is the same list in a form a test can walk, and
// `read-only-surfaces.test.ts` parses the FRD's markdown and fails when the two
// stop agreeing — so the table cannot be edited on one side only.
//
// WHAT A ROW SAYS. `surface` and `mustNotRender` are the FRD's two columns
// VERBATIM (the parity test compares strings). Everything after them is this
// repo's answer to the row: which verb governs it, which of the three read-only
// contexts can even reach it, where the gate lives, and what deliberately
// survives.
//
// THE VERB IS NOT A NEW DECISION. Every `governedBy` names a capability from
// `CAPABILITIES` in `./seat-rules`, which is the same table `requireSeat`
// refuses a POST with. That is the whole point of routing the hide through it:
// a control's visibility and the server's answer are read off one declaration,
// so they cannot drift into either failure — a button that always refuses, or a
// button hidden from somebody the server would have said yes to.
// ============================================================================

/**
 * The three read-only contexts AS-020 names, as values.
 *
 * They are NOT interchangeable, and the sweep's central finding is that they
 * are not even similar: two of them are refused at the ROUTE and one is not.
 * See `REACH` below.
 */
export type ReadOnlyContext = "coach" | "org-member" | "plant-member";

/**
 * HOW EACH CONTEXT REACHES THE PRODUCT — the finding the sweep rests on.
 *
 * A COACH AND AN ORG MEMBER BOTH CARRY `church_id = null`. A coach holds no
 * tenancy at all (ruling 185 (2): coaching is an assignment, never a seat); an
 * org Member's tenancy is named by `sending_church_id` or
 * `sending_network_id`. Every plant surface in this product opens with the same
 * two lines — `const { user } = await verifySession()` then `if
 * (!user.churchId) redirect("/dashboard")` — so NEITHER OF THEM EVER RENDERS
 * ROWS 2 THROUGH 13 AT ALL. There is no button to hide because there is no
 * page.
 *
 * That is a far stronger guarantee than a hidden control, and it is asserted
 * mechanically: `read-only-surfaces.test.ts` → "every plant surface refuses an
 * account with no churchId" walks the route files rather than trusting this
 * comment. A new plant route that forgets the guard fails that test, which is
 * the only way this property stays true as routes are added.
 *
 * SO THE SWEEP'S REAL SUBJECT IS THE PLANT MEMBER. They hold a seat in the
 * plant, pass every route guard, and see each of these screens in full — and
 * `ADMIN_PLUS` refuses them nearly every write on it.
 */
/**
 * WHY THE WALL IS NOT THE WHOLE STORY — found in the browser, not in a test.
 *
 * The route guard reads `church_id`, and nothing else. It therefore catches an
 * account with NO tenancy and misses one that holds a `church_id` and NO SEAT —
 * a state that is perfectly representable and that this repo's own dev seed
 * creates on purpose: `coach1@everyfield.app` is `seat: null` with
 * `churchIndex: 0`, because "`churchIndex` still links them to a plant, which
 * is what gives them an in-app notification feed" (`scripts/seed-dev-db.ts`).
 *
 * Signed in as that account, `/people` RENDERS. It does not redirect. What
 * refuses the writes there is not the wall — it is the capability hide this
 * sweep put in, because `holdsSeatFor` needs a seat and there is none. The
 * observed result was the whole directory, readable, with every create control
 * absent and Export (a `read`) still present.
 *
 * SO THE HIDE IS LOAD-BEARING, NOT BELT-AND-BRACES. The tempting conclusion
 * from the route walk — "rows 2-13 are unreachable for a coach, so the gates
 * below them are defence in depth" — is false for any seatless account that
 * names a plant, and the server's own refusal (`requireSeat`) is what makes it
 * safe rather than merely tidy. Do not delete a gate on the strength of the
 * wall alone.
 */
export const WALL_IS_NOT_THE_WHOLE_STORY =
  "the churchId guard reads a tenancy, not a seat: a seatless account holding a church_id renders every plant surface, and only the capability hide refuses its writes";

export const REACH: Readonly<
  Record<
    ReadOnlyContext,
    { readonly plantSurfaces: boolean; readonly why: string }
  >
> = {
  coach: {
    plantSurfaces: false,
    why: "a coach MINTED BY THE INVITATION FLOW holds no tenancy at all — `assignCoachOnAcceptStatement` writes a coach_assignments row and no FK — so church_id is NULL and every plant route's guard refuses them; their reach is /coaching/[churchId], one aggregate page that renders no control. But see WALL_IS_NOT_THE_WHOLE_STORY: a SEATLESS account carrying a church_id is representable, and the route guard does not catch it.",
  },
  "org-member": {
    plantSurfaces: false,
    why: "church_id NULL, tenancy named by an oversight FK — refused by the same guard; the org reach is /oversight/**, rows 20-22",
  },
  "plant-member": {
    plantSurfaces: true,
    why: "holds a seat in the plant, so every route guard admits them — the context every row below is written for",
  },
};

/** What every row carries, whatever the sweep concluded about it. */
interface ChecklistRowFacts {
  /** The FRD's left-hand column, verbatim — the parity test compares this. */
  readonly surface: string;
  /** The FRD's right-hand column, verbatim — same. */
  readonly mustNotRender: string;
  /**
   * The verbs whose absence this row asks for, from `./seat-rules`.
   *
   * Empty where the row names no write this product has: Documents generates
   * and downloads under `read`, and the wiki has no authoring surface at all.
   */
  readonly governedBy: readonly Capability[];
  /** Which contexts render this surface. The rest are refused above it. */
  readonly reachedBy: readonly ReadOnlyContext[];
  /** What the row deliberately keeps, per the FRD's own three exceptions. */
  readonly survives?: string;
  readonly note?: string;
}

/**
 * A ROW IS ITS VERDICT — the three shapes are not one shape with optional
 * fields, because the three claims need different evidence.
 *
 * `fixed-here` MUST name the files it changed: the whole point of the verdict
 * is that a reviewer can go and read the gate, and the test walks that list to
 * check each file still asks for the verb. A row claiming a fix and naming
 * nowhere is the one state this file must not be able to hold, so it does not
 * compile.
 *
 * `already-correct` may name files — where a gate exists and predates the
 * sweep, pointing at it is the evidence — and may name none, where the row is
 * satisfied because the control does not exist (Documents, the wiki) or because
 * a type makes it unreachable (Notifications). Those rows carry a `note`
 * instead, and the test insists on one.
 *
 * `deferred` names an issue and nothing else. It is a row this sweep did not
 * look at, and it must not look as though it did.
 */
export type ChecklistRow =
  | (ChecklistRowFacts & {
      readonly verdict: "fixed-here";
      /**
       * The files this sweep changed, repo-relative. The test asserts each one
       * still names one of `governedBy`, so a gate deleted in a later refactor
       * fails the suite rather than going quiet.
       */
      readonly gatedIn: readonly string[];
    })
  | (ChecklistRowFacts & {
      readonly verdict: "already-correct";
      /** The pre-existing gate, where there is one to point at. */
      readonly gatedIn?: readonly string[];
    })
  | (ChecklistRowFacts & {
      readonly verdict: "deferred";
      /** Names the issue that owns the files. Asserted by the test. */
      readonly note: string;
    });

export const READ_ONLY_SURFACE_CHECKLIST: readonly ChecklistRow[] = [
  {
    surface: "Global navigation and command palette",
    mustNotRender:
      'Any "new" or "create" entry, the seat-management page, and any destructive action entry',
    governedBy: ["seat.invitation.manage"],
    reachedBy: ["coach", "org-member", "plant-member"],
    verdict: "already-correct",
    gatedIn: ["src/lib/settings/sections.ts"],
    note: "THERE IS NO COMMAND PALETTE. The only CommandDialog in the product is the wiki's article search (`src/components/wiki/wiki-search.tsx`), which is a reader control with no create entry. The nav itself carries destinations, never verbs: `mainNavItems` (`src/lib/navigation.ts`) has no new/create item, and the seat-management page is reached through the settings registry, whose `team` entry is already gated on `seat.invitation.manage` — so a Member and a coach are shown no entry to it.",
  },
  {
    surface: "Dashboard",
    mustNotRender:
      'Quick-action tiles, "add" cards, inline phase-advance controls, dismiss and edit affordances on cards',
    governedBy: ["people.write", "meetings.write"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: ["src/app/(dashboard)/dashboard/plant-dashboard.tsx"],
    note: "The two create tiles (Add Person, Schedule Meeting) rendered for every seat. There is no inline phase-advance control on this surface — the phase is a text label, and the declaration lives on /phase. The association Accept/Decline reminder was already Owner-gated at its data read (`isPlantOwner(viewer)`), and the leadership prompts were already gated by `canAnswerLeadershipQuestion`.",
  },
  {
    surface: "People directory (list)",
    mustNotRender:
      "New person, import, bulk actions, per-row edit and delete menus, stage drag-and-drop",
    governedBy: ["people.write"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/app/(dashboard)/people/page.tsx",
      "src/components/people/people-list.tsx",
      "src/components/people/pipeline-view.tsx",
      "src/components/people/pipeline-card.tsx",
    ],
    note: "Export stays: `exportPeopleAction` is `read`, so hiding it would be stricter than the server. There are no bulk actions and no per-row menu on this list — the row is a plain link — so those two clauses had nothing to hide.",
  },
  {
    surface:
      "Person detail and its activity, assessments, communication and teams tabs",
    mustNotRender:
      "Edit, delete, change-stage, add-note, new-assessment, assign-to-team and send-message controls",
    governedBy: ["people.write", "communication.send"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/components/people/person-header.tsx",
      "src/components/people/note-form.tsx",
      "src/components/people/assessments-tabs.tsx",
      "src/components/people/skills-list.tsx",
      "src/components/people/tag-picker.tsx",
      "src/components/people/household-members.tsx",
      "src/components/people/person-overview.tsx",
      "src/app/(dashboard)/people/[id]/communication/page.tsx",
    ],
    survives:
      "Editing and deleting a note the viewer wrote themselves stays authorship-gated as it was; it is not a seat question.",
    note: "There is no assign-to-team control on the teams tab — the tab renders memberships and a read link to /teams.",
  },
  {
    surface: "Meetings (list)",
    mustNotRender: "New meeting, per-row edit and delete menus",
    governedBy: ["meetings.write"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/app/(dashboard)/meetings/page.tsx",
      "src/components/meetings/meeting-list.tsx",
    ],
  },
  {
    surface:
      "Meeting detail and its attendance, evaluation, invitations, logistics, outcomes and analytics tabs",
    mustNotRender:
      "Edit meeting, record and finalize attendance, submit evaluation, send invitations, edit logistics, record outcomes — a Member's own RSVP is the one control that stays",
    governedBy: ["meetings.write"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/app/(dashboard)/meetings/[id]/meeting-details-client.tsx",
      "src/components/meetings/attendance-capture.tsx",
      "src/components/meetings/evaluation-form.tsx",
      "src/components/meetings/guest-list.tsx",
      "src/components/meetings/materials-checklist.tsx",
      "src/components/meetings/agenda-builder.tsx",
      "src/components/meetings/attendee-notes.tsx",
    ],
    note: "TWO DEFECTS THIS ROW FOUND THAT THE FRD'S WORDING DOES NOT NAME, both ruled in for #499. `attendee-notes.tsx` mounts DIRECTLY on the evaluation tab rather than inside the evaluation form, so gating the form left its Add Note control — an `addAttendeeNoteAction` call, `meetings.write` — rendering for a Member; it is gated on its own now. And the materials checklist's read-only path originally OMITTED the view's `renderControl` slot, which falls back to a default built for the marketing embed: a handler-less Radix `<Checkbox>`, which renders `<button role=\"checkbox\">` and is focusable and announced. That is a disabled control in better clothing, so the read-only render now passes a marker that carries the state and is not a control.",
    survives:
      "A Member's OWN RSVP is untouched because it is not on this surface: it is answered from the emailed link at /rsvp/[token], a page outside (dashboard) authorised by the token and holding no session. The in-dashboard RSVP toggle on the guest list is staff recording somebody ELSE's answer — `updateRsvpStatusAction` is `meetings.write` — so it is hidden with the rest. The own-duty RSVP verb AS-006 describes cannot exist yet: the guest list references `persons.id` and nothing links a person row to an account (the residual recorded in memory/invariants.md).",
  },
  {
    surface: "Tasks (list, detail, templates)",
    mustNotRender:
      "New task, import template, per-row complete, assign, edit and delete — a Member's own assigned task keeps its own complete control",
    governedBy: ["tasks.write"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/app/(dashboard)/tasks/page.tsx",
      "src/components/tasks/task-card.tsx",
      "src/components/tasks/bulk-actions.tsx",
      "src/components/tasks/subtask-list.tsx",
      "src/components/tasks/follow-up-assignments.tsx",
      "src/components/tasks/template-picker.tsx",
      "src/app/(dashboard)/tasks/[id]/task-detail-actions.tsx",
    ],
    survives:
      "Completing and reopening a task ASSIGNED TO THE VIEWER. Those are `tasks.own` (SEATED), which a Member holds, and the subject half is checked server-side by `assertMayActOnTask`. The row's own complete control is therefore gated on `task.assignedToId === viewer`, not on the seat — the one place this sweep asks a question about WHOSE row it is rather than what the seat may do.",
  },
  {
    surface:
      "Ministry Teams (list, detail, meetings, responsibilities, training tabs, health, org chart)",
    mustNotRender:
      "New team, add and remove member, assign role, set leader, edit responsibilities, record training — a team leader's writes on their own team stay, derived from `MinistryTeam.leader_id`",
    governedBy: ["teams.write"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/components/ministry-teams/teams-dashboard.tsx",
      "src/components/ministry-teams/members-roles-tab.tsx",
      "src/components/ministry-teams/responsibilities-tab.tsx",
      "src/components/ministry-teams/training-tab.tsx",
      "src/components/ministry-teams/meetings-tab.tsx",
    ],
    survives:
      "NOTHING, AND THE FRD'S THIRD EXCEPTION CANNOT SHIP YET — ruled here for #499. `ministry_teams.leader_id` references `persons.id`; a session names a `users.id`; and there is no column joining them until AS-013's registration link lands. So no rendered surface can ask 'am I this team's leader?', and writing `team.leaderId === user.id` would compare two different id spaces and be false for everyone forever. `seat-rules.ts` already records the server half of this residual — every teams write sits at `teams.write` (ADMIN_PLUS) for the same reason — so hiding all of them matches what the server does today. Retired by the account-to-person link, which restores both halves at once.",
  },
  {
    surface:
      "Communication (list, compose, history, templates, template editing, message detail)",
    mustNotRender:
      "Compose, send, schedule, new template, edit template, delete",
    governedBy: ["communication.send"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: [
      "src/app/(dashboard)/communication/page.tsx",
      "src/app/(dashboard)/communication/compose/page.tsx",
      "src/app/(dashboard)/communication/templates/page.tsx",
      "src/app/(dashboard)/communication/templates/[id]/edit/page.tsx",
      "src/components/communication/resend-non-openers.tsx",
    ],
    note: "The compose and template-edit ROUTES are refused, not merely unlinked: a hidden button that leaves a reachable URL is a screen a Member still walks into and is refused at submit. There is no 'new template' control to hide — templates are forked server-side on first edit.",
  },
  {
    surface: "Documents",
    mustNotRender: "Upload, generate from template, rename, delete",
    governedBy: [],
    reachedBy: ["plant-member"],
    verdict: "already-correct",
    note: "NOTHING IS HIDDEN HERE, DELIBERATELY. This surface has no upload, no rename and no delete — they do not exist. Generating is a download: the one server action is `read`, and the generator itself is `GET /api/documents/[templateId]`. A read-only context holds `read`, so gating any of it would make the UI stricter than the server — the inverse of the drift AS-020 is about, and an over-hide the positive tests exist to catch.",
  },
  {
    surface: "Launch",
    mustNotRender:
      "Schedule launch, edit launch date, edit milestones, record outcome",
    governedBy: ["launch.milestone"],
    reachedBy: ["plant-member"],
    verdict: "fixed-here",
    gatedIn: ["src/app/(dashboard)/launch/page.tsx"],
    survives:
      "TICKING A MILESTONE STAYS FOR A MEMBER, and this row is narrowed against the FRD's wording deliberately (ruled for #499). Scheduling, changing the date and recording the outcome are `launch.schedule` (OWNER_ONLY) and were already gated on `isPlanter`. Milestone completion is a DIFFERENT verb — `launch.milestone`, SEATED — which LS-007 split off on purpose so that milestone ticks follow ordinary task rules and a Member may do them. Hiding it would refuse in the UI what the server allows, which is the over-hide the sweep must not commit. What the board's `canEdit` was is `true`, hardcoded; what it is now is that capability, which refuses a coach and an org account and admits the Member.",
  },
  {
    surface: "Phase",
    mustNotRender:
      "Advance phase, declare phase, answer an attestation, dismiss an insight",
    governedBy: ["phase.declare"],
    reachedBy: [],
    verdict: "already-correct",
    gatedIn: ["src/app/(dashboard)/phase/page.tsx"],
    note: "REACHED BY NO READ-ONLY CONTEXT AT ALL. The route redirects unless `isPlantOwner(user) && user.churchId`, so a Member is refused with the coach and the org account, and the whole surface is the Owner's. Adding capability gates below a route guard that already fires would be a branch that can never be taken. 'Dismiss an insight' has no control — insight interaction is feedback only, and that is `self.write`, the viewer's own row.",
  },
  {
    surface: "Wiki (article and progress)",
    mustNotRender:
      "Edit article, create church article, and any authoring entry point",
    governedBy: [],
    reachedBy: ["coach", "org-member", "plant-member"],
    verdict: "already-correct",
    note: "THERE IS NO AUTHORING SURFACE. The article write functions were deleted as zero-caller in #411; content is pushed in through `POST /api/wiki/revalidate` behind a shared secret, never a browser session. The wiki's only controls are the reader's own — print, download, bookmark, progress, feedback — on `read` and `self.write`, which every context holds and none of which may be hidden.",
  },
  {
    surface: "Notifications",
    mustNotRender:
      "Preference editing that belongs to another account; a person's own preferences stay their own",
    governedBy: ["self.write"],
    reachedBy: ["coach", "org-member", "plant-member"],
    verdict: "already-correct",
    note: "SATISFIED BY A TYPE, not by a gate. A preference write is addressed by `PreferenceOwner`, a branded type mintable only from a verified session or a signed unsubscribe token — so no surface can point the matrix at another account, because no call site can construct the argument that would name one. `PreferenceMatrix` takes no user id.",
  },
  {
    surface: "Settings — account",
    mustNotRender: "Nothing hidden: an account always edits its own account",
    governedBy: [],
    reachedBy: ["coach", "org-member", "plant-member"],
    verdict: "already-correct",
    gatedIn: ["src/components/settings/sections/account-section.tsx"],
    note: "A POSITIVE ROW — the sweep's job here is to leave it alone, and the positive test asserts it renders in all three contexts. The section's registry entry is `everyAccount`, and its two forms are `self.write`, which carries no seat set and no tenancy.",
  },
  {
    surface: "Settings — church profile",
    mustNotRender: "Every field control, for a Member and for a coach",
    governedBy: ["church.profile"],
    reachedBy: [],
    verdict: "already-correct",
    gatedIn: ["src/components/settings/sections/church-section.tsx"],
    note: 'One early return on `holdsSeatFor(user, "church.profile")` covers the whole section, so every field control below it is absent rather than each one gated. The registry hides the entry too, so a Member is not shown a section that would render empty.',
  },
  {
    surface: "Settings — sharing",
    mustNotRender: "Every toggle, for anyone but the Owner",
    governedBy: ["sharing.toggle"],
    reachedBy: [],
    verdict: "deferred",
    note: "DEFERRED TO #645, which holds the sharing panel's files in flight. Read, not touched: `sharing-section.tsx` already returns early unless `isPlantOwner(user) && user.churchId`, so the row appears satisfied — but the verdict is #645's to record, not this sweep's, and the parity test claims nothing about it.",
  },
  {
    surface: "Settings — association",
    mustNotRender: "Accept, decline, leave and sever, for anyone but the Owner",
    governedBy: ["association.answer", "association.leave"],
    reachedBy: [],
    verdict: "already-correct",
    gatedIn: ["src/components/settings/sections/association-section.tsx"],
    note: "Positively gated on both sides — the plant view needs `isPlantOwner`, the org view `isOrgOwner`, and anything else redirects to /settings. The dashboard's association reminder is gated at its DATA read (`isPlantOwner(viewer)` in plant-dashboard.tsx), so a Member's dashboard fetches no invitation and the answer buttons never mount.",
  },
  {
    surface: "Settings — team",
    mustNotRender:
      "The whole page for a Member and a coach; appointment, demotion and removal controls for an Admin",
    governedBy: ["seat.invitation.manage", "seat.manage"],
    reachedBy: [],
    verdict: "already-correct",
    gatedIn: ["src/components/settings/sections/team-section.tsx"],
    note: "Shipped with #497 against this same requirement: the page redirects unless `seat.invitation.manage`, and `SeatRoster` takes `canManageSeats` from `seat.manage` and states the hidden-not-disabled rule in its own header. `seat-roster.test.ts` is the render-level proof and predates this sweep.",
  },
  {
    surface: "Oversight — plants directory and plant detail",
    mustNotRender: "Remove-from-org, and any control that writes to the plant",
    governedBy: ["org.association.sever", "org.invitation.manage"],
    reachedBy: ["org-member"],
    verdict: "already-correct",
    gatedIn: [
      "src/app/(dashboard)/oversight/plants/page.tsx",
      "src/app/(dashboard)/oversight/plants/[id]/page.tsx",
    ],
    note: "`canSever` off `org.association.sever` hides the removal dialog; the directory's empty-state invite call to action is gated on `org.invitation.manage` under the standing rule that no empty state offers an invite its reader cannot send.",
  },
  {
    surface: "Oversight — invitations",
    mustNotRender: "Create, revoke and resend, for an org Member",
    governedBy: ["org.invitation.manage"],
    reachedBy: ["org-member"],
    verdict: "already-correct",
    gatedIn: ["src/app/(dashboard)/oversight/invitations/page.tsx"],
    note: "One `canManageInvitations` read gates the create form and both row controls.",
  },
  {
    surface: "Oversight — sending-church roster and drill-down",
    mustNotRender: "Invite, remove and roster-edit controls, for an org Member",
    governedBy: ["org.invitation.manage"],
    reachedBy: ["org-member"],
    verdict: "already-correct",
    gatedIn: ["src/app/(dashboard)/oversight/sending-churches/page.tsx"],
    note: "The roster's invite call to action is gated on `org.invitation.manage`; the drill-down carries reads only, and there is no remove or roster-edit control on it to hide.",
  },
];
