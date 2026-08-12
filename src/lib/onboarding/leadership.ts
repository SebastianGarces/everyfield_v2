/**
 * F12 / OB-004 — the leadership answer, as data.
 *
 * Ruling #157: the first account on a church is ASSUMED to be the
 * planter/pastor — but the flow asks, because the no-planter state silently
 * degrades downstream behaviour (follow-up tasks have nobody to assign to), and
 * a silent assumption is exactly the kind of thing a planter never discovers
 * was wrong.
 *
 * Three states, not two. `null` is "never asked" and is NOT the same as "no
 * planter": every church that existed before this step shipped has a null here,
 * and treating those as planter-less would light a nudge on churches that are
 * perfectly well led and would strip the assignee off their follow-up tasks.
 * Only an explicit `"no_planter"` means the planter question was answered No.
 *
 * Pure data and pure functions — no React, no database client — so the rules
 * that decide "does this church have a planter?" are unit testable and can be
 * imported by the schema (as a type), by server actions, by the step component
 * and by the task-assignment path without dragging any of them into each other.
 */

/**
 * The persisted answer. Stored on `churches.leadership_status`.
 *
 * - `"planter_confirmed"` — the creating account IS the lead planter/pastor.
 *   The assignment itself is the existing mechanism (`users.church_id` + the
 *   `planter` role, written at step 1); this column is what makes it explicit
 *   and queryable rather than inferred.
 * - `"no_planter"` — answered No. The church deliberately has no planter until
 *   the answer changes (assigning somebody else needs user invitations, which
 *   are a separate feature).
 */
export const CHURCH_LEADERSHIP_STATUSES = [
  "planter_confirmed",
  "no_planter",
] as const;

export type ChurchLeadershipStatus =
  (typeof CHURCH_LEADERSHIP_STATUSES)[number];

/** What the radio group submits. */
export type LeadershipAnswer = "yes" | "no";

/** OB-004: "default Yes" — the assumption of #157, made visible and editable. */
export const DEFAULT_LEADERSHIP_ANSWER: LeadershipAnswer = "yes";

/** The shape any caller needs to answer "does this church have a planter?". */
export type ChurchLeadership = {
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
};

export function isLeadershipAnswer(value: unknown): value is LeadershipAnswer {
  return value === "yes" || value === "no";
}

export function leadershipStatusForAnswer(
  answer: LeadershipAnswer
): ChurchLeadershipStatus {
  return answer === "yes" ? "planter_confirmed" : "no_planter";
}

/**
 * The inverse, for re-entry: the nudge sends a planter back to this step and
 * the radio group must open on the answer they actually gave, not on the
 * default they are trying to change.
 */
export function leadershipAnswerForStatus(
  status: ChurchLeadershipStatus | null | undefined
): LeadershipAnswer {
  if (status === "no_planter") return "no";
  if (status === "planter_confirmed") return "yes";
  return DEFAULT_LEADERSHIP_ANSWER;
}

/** Has the question been answered at all? Drives step resumption. */
export function leadershipAnswered(church: ChurchLeadership): boolean {
  return (
    church.leadershipStatus === "planter_confirmed" ||
    church.leadershipStatus === "no_planter"
  );
}

/**
 * The explicit no-planter state — the one that lights the dashboard nudge and
 * that the task-assignment path treats as "there is nobody to assign to".
 *
 * Deliberately narrow: only an explicit No counts. A church that was never
 * asked (`null`) keeps the pre-OB-004 behaviour of inferring the planter from
 * the role, which is what stops this change from retro-orphaning every church
 * created before it.
 */
export function churchHasNoPlanter(church: ChurchLeadership): boolean {
  return church.leadershipStatus === "no_planter";
}

// ============================================================================
// OB-010 — the one-time pastor confirmation for churches that predate the step
// ============================================================================

/**
 * The signed-in user, as far as the leadership question is concerned. Structural
 * (not `User`) so the rules below are unit testable without building rows, and
 * minted from the session by every caller — never accepted from a request
 * (`memory/invariants.md` → Authentication).
 */
export type LeadershipViewer = {
  role: string | null | undefined;
  churchId: string | null | undefined;
};

/**
 * What a church's leadership actually is, both ways it can be known.
 *
 * `leadershipStatus` is the EXPLICIT answer (OB-004's column). `hasPlanterUser`
 * is the IMPLICIT assignment that predates it and is still the real one — a
 * `users` row with the `planter` role pointing at this church. The two are
 * separate inputs because the whole of OB-010 turns on their disagreement: a
 * church can have a planter and no recorded answer (every church created before
 * the question shipped), and that is the state the prompt must NOT fire on.
 */
export type ChurchLeadershipState = ChurchLeadership & {
  churchId: string;
  hasPlanterUser: boolean;
};

/** In-church roles. Coaches and oversight admins lead nobody's plant. */
function isInChurchRole(role: string | null | undefined): boolean {
  return role === "planter" || role === "team_member";
}

function viewerBelongsTo(
  viewer: LeadershipViewer,
  church: ChurchLeadershipState
): boolean {
  return !!viewer.churchId && viewer.churchId === church.churchId;
}

/**
 * OB-010's ruling (FRD open question 3, answered: no) expressed as a fact:
 * **an implicit planter counts as a confirmed one — for the purpose of being
 * ASKED.**
 *
 * A church whose `users.church_id` + `planter` role already names somebody is
 * led, whatever the column says, so it is never prompted again: that is what
 * `shouldPromptPastorConfirmation` reads, and it is unchanged. What comes back
 * is *derived and never written back* — the column stays null, because writing
 * `planter_confirmed` would record an answer nobody gave and would be
 * indistinguishable from one later.
 *
 * It does NOT follow that such a church is finished with the question, and the
 * incomplete-onboarding indicator deliberately says so: it reads the RAW column
 * (`dashboard/plant-dashboard.tsx` → `onboardingFacts`), so leadership stays on
 * its list
 * until an EXPLICIT answer is recorded, implicit planter or not. The two
 * surfaces disagree on purpose — a prompt that fires at somebody is a demand
 * and must not nag a plant that is plainly led, whereas the indicator is a
 * standing list of facts the product would still like to have, and the recorded
 * answer is worth something in itself. Ruled 2026-08-08 (Sebastian, PR #335)
 * after the two behaviours were observed side by side; do not "fix" the
 * indicator to call this function without re-opening that ruling.
 */
export function resolvedLeadershipStatus(
  church: ChurchLeadershipState
): ChurchLeadershipStatus | null {
  if (leadershipAnswered(church)) {
    return church.leadershipStatus as ChurchLeadershipStatus;
  }
  return church.hasPlanterUser ? "planter_confirmed" : null;
}

/**
 * May this viewer answer the leadership question for this church?
 *
 * Two ways in, and the second is deliberately narrow:
 *
 * - the plant's **planter** — OB-004's path, the person the question is about;
 * - a **team member of a plant with no planter at all** — OB-010's path. The
 *   seat is empty, there is nobody above them to ask, and the FRD sends the
 *   prompt to the church's user(s). Answering Yes therefore *assigns* them,
 *   which is a role change, so the permission exists only while the seat is
 *   empty: the moment anyone holds it, this returns false again for everyone
 *   but the planter.
 *
 * Coaches and oversight admins are never in scope — they do not lead the plant,
 * and `getAccessibleChurchIds` is how they reach it at all.
 */
export function canAnswerLeadershipQuestion(
  viewer: LeadershipViewer,
  church: ChurchLeadershipState
): boolean {
  if (!viewerBelongsTo(viewer, church)) return false;
  if (!isInChurchRole(viewer.role)) return false;
  if (viewer.role === "planter") return true;
  return !church.hasPlanterUser;
}

/**
 * OB-010 — show the one-time pastor-confirmation prompt?
 *
 * True only for a church that has **no planter at all and no recorded answer**:
 * the pre-OB-004 hole. A church with a planter never sees it (the implicit
 * assignment is treated as confirmed), and a church that has answered — either
 * way — never sees it again, which is most of what "one-time" means. The rest of
 * "one-time" is the dismissal, which is the component's job.
 */
export function shouldPromptPastorConfirmation(
  viewer: LeadershipViewer,
  church: ChurchLeadershipState
): boolean {
  if (!canAnswerLeadershipQuestion(viewer, church)) return false;
  return resolvedLeadershipStatus(church) === null;
}

/**
 * OB-004 / OB-010 — show the standing no-planter nudge?
 *
 * Reads the EXPLICIT column (`churchHasNoPlanter`), never the resolved one: the
 * nudge is the consequence of an answered No, and a church that was simply never
 * asked has not said No. Gated on being able to answer, so the nudge is only
 * ever shown to somebody its "Change this answer" link actually works for —
 * including the team member who reached the question through OB-010 and said
 * No, which is the same No path OB-004 specced.
 */
export function shouldShowNoPlanterNudge(
  viewer: LeadershipViewer,
  church: ChurchLeadershipState
): boolean {
  return (
    canAnswerLeadershipQuestion(viewer, church) && churchHasNoPlanter(church)
  );
}

/**
 * What the answer WRITES, decided before any statement is built.
 *
 * - `confirm` — the answerer already holds the planter role; Yes only records
 *   the answer. This is OB-004's Yes and touches no `users` row.
 * - `claim` — Yes from a team member of a planterless plant (OB-010): the
 *   assignment has to be made, not just recorded, so this plan writes the role
 *   too and is the only one that can be lost to a race.
 * - `decline` — No, from either. Records `no_planter`; nobody's role changes.
 */
export type LeadershipWritePlan = "confirm" | "claim" | "decline";

/**
 * Is the planter seat already this viewer's? — the one question that decides
 * whether an answer is settling something or competing for it.
 *
 * Exported because the write path needs the same fact for a DECLINE that
 * `leadershipWritePlan` needs for a Yes: a planter answering about their own
 * seat races nobody (only the planter may answer once the seat is filled), so
 * their write needs no guard, while anyone else's decline is competing with
 * every Yes in flight and must be guarded like one. One definition, so the two
 * cannot drift into disagreeing about who is settled.
 */
export function viewerHoldsPlanterSeat(
  viewer: LeadershipViewer,
  church: ChurchLeadershipState
): boolean {
  return viewer.role === "planter" && church.hasPlanterUser;
}

export function leadershipWritePlan(
  viewer: LeadershipViewer,
  church: ChurchLeadershipState,
  answer: LeadershipAnswer
): LeadershipWritePlan {
  if (answer === "no") return "decline";
  return viewerHoldsPlanterSeat(viewer, church) ? "confirm" : "claim";
}

/**
 * What answering No actually costs. Shown on the step (so the answer is
 * informed, not just recorded) and echoed by the dashboard nudge.
 */
export const NO_PLANTER_LIMITS: readonly string[] = [
  "Follow-up and evaluation tasks created after a meeting have nobody to assign to, so they are not created at all.",
  "Guidance, reminders and nudges written for the lead pastor have no one to reach.",
  "Inviting the actual pastor is not part of this release yet — until then, changing this answer is how a plant gets a planter.",
];

/** Where the dashboard nudge sends a planter to change the answer. */
export const LEADERSHIP_STEP_HREF = "/dashboard?step=leadership";
