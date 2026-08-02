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
