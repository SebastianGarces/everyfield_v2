"use server";

// ============================================================================
// /launch — the "use server" boundary (LS-003/004/006/007).
//
// EVERY EXPORT OF THIS FILE IS A PUBLIC POST ENDPOINT. Nothing below trusts an
// argument for authority (memory/invariants.md → Authentication):
//
//   * the CHURCH is the session's, never the client's. No action here takes a
//     church id — a forged one is not merely rejected, it is unrepresentable.
//   * the ACTOR is `verifySession()`'s user, handed to a service that
//     re-derives authority from it. `setLaunchDate`, `recordLaunchOutcome` and
//     `completeLaunchMilestone` all THROW on a role they do not accept, so an
//     action cannot proceed by ignoring a return value.
//   * NO SQL LIVES HERE. Every write goes through `src/lib/launch/*`, which is
//     where the guards (the row lock, the compare-and-set, the "no open tasks"
//     predicate, the journal insert) live. An action that wrote its own SQL
//     would be a second write path with none of them.
//
// LS-007's SPLIT, which is why the capability is not uniform below:
//   scheduling / postponing / recording the outcome  → `launch.schedule`, the
//                                                      plant OWNER's alone.
//   milestone and task completion                    → `launch.milestone`,
//                                                      normal task rules, so a
//                                                      Member may do it.
// The UI hides what a seat may not do; these are the checks that make it true.
// ============================================================================

import { requireSeat } from "@/lib/auth/seats";
import { type Capability } from "@/lib/auth/seat-rules";
import { rethrowUnauthorized } from "@/lib/auth/unauthorized";
import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";

import {
  launchNoteSchema,
  launchTargetDateSchema,
} from "@/lib/launch/validation";
import { getLaunchForChurch } from "@/lib/launch/queries";
import { setLaunchDate } from "@/lib/launch/service";
import {
  completeLaunchMilestone,
  isLaunchTask,
  reopenLaunchMilestone,
  seedLaunchMilestones,
} from "@/lib/launch/milestones";
import {
  recordLaunchOutcome,
  updateLaunchOutcome,
  type LaunchOutcomeInput,
} from "@/lib/launch/outcome";
import { completeTask, reopenTask } from "@/lib/tasks/service";
import type { ActionResult } from "@/lib/tasks/types";

// ----------------------------------------------------------------------------
// Shared plumbing
// ----------------------------------------------------------------------------

/**
 * The session's user and church, or a refusal — and the seat guard (#498).
 *
 * A planter with no church cannot have a launch, and every read and write below
 * is church-scoped, so this is the one place the missing-church case is
 * answered — in a sentence, rather than by a `null` that becomes a crash three
 * frames later.
 *
 * THE CAPABILITY IS AN ARGUMENT because LS-007's split is exactly the two
 * capabilities: `launch.schedule` is the Owner's (setting, moving and recording
 * the outcome of a date), `launch.milestone` follows normal task rules and a
 * Member may do it. Threading it here rather than adding a second statement to
 * each export keeps the guard on line one, ahead of every parse.
 */
async function requireChurchSession(capability: Capability) {
  const { user } = await requireSeat(capability);
  if (!user.churchId) {
    return { user: null, churchId: null } as const;
  }
  return { user, churchId: user.churchId } as const;
}

const NO_CHURCH_MESSAGE =
  "You need a church plant before you can work on a launch.";

/**
 * Turn a thrown error into a sentence, without telling the caller which guard
 * refused them. `requireSeat` / `assertSeatFor` throw `Forbidden: <capability>
 * …` and `requireChurchAccess` throws one naming a church id; both belong in
 * the server log, not in a response.
 *
 * EXCEPT THE SESSIONLESS ONE, which is not a sentence at all: it leaves as a
 * throw (#508). Every export here mints inside its `try`, so this helper is the
 * one place all six catches funnel through, and `rethrowUnauthorized` is the
 * first thing it does — before the log, because an anonymous POST is not a
 * launch failure. It used to answer `"You must be logged in to <verb>."`, which
 * is the well-formed answer an endpoint should never give a caller with no
 * session (`memory/invariants.md` → Authentication).
 */
function toActionError(error: unknown, verb: string): ActionResult<never> {
  rethrowUnauthorized(error);

  console.error(`launch action failed while ${verb}:`, error);

  if (error instanceof Error) {
    if (error.message.startsWith("Forbidden")) {
      return {
        success: false,
        error: `You do not have permission to ${verb}.`,
      };
    }
  }

  return { success: false, error: `Something went wrong while ${verb}.` };
}

/**
 * What every launch write revalidates.
 *
 * `refresh()` for the page the planter is on (the house rule —
 * `memory/contracts/data-patterns.md`), plus the OTHER surfaces that show the
 * same launch: the dashboard card (LS-005) reads the date, `/tasks` lists the
 * seeded `launch_prep` tasks, and `/phase` reads the countdown signal. Missing
 * one is how two surfaces come to disagree about the same day.
 */
function revalidateLaunchSurfaces() {
  refresh();
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/phase");
}

// ----------------------------------------------------------------------------
// Scheduling (LS-001/002/003/009)
// ----------------------------------------------------------------------------

export interface ScheduleLaunchActionInput {
  /** `YYYY-MM-DD`. Validated by `launchTargetDateSchema` inside the service. */
  targetDate: string;
  /** LS-009: a postponement, not a move. Only meaningful once a date exists. */
  postpone?: boolean;
  /** The planter's stated reason, journalled with the change. */
  note?: string | null;
}

/**
 * The POST body, as a schema rather than as a type assertion.
 *
 * NOT exported: an export of this module is an endpoint (see the header), and
 * this is a constant, not one. It exists because `input` arrives from the
 * network and `ScheduleLaunchActionInput` is erased at runtime — the interface
 * describes what a caller SHOULD send, and only the parse makes it true. The
 * note's bound in particular is the one that matters: it lands in the
 * append-only `launch_events.note`, and `maxLength` on a textarea is a courtesy
 * to the person typing, not a limit on what can be posted.
 */
const scheduleLaunchInputSchema = z.object({
  targetDate: launchTargetDateSchema,
  postpone: z.boolean().optional(),
  note: launchNoteSchema.optional(),
});

export interface ScheduleLaunchActionResult {
  targetDate: string;
  /** `false` when the submitted date was already the stored one. */
  changed: boolean;
  /** How many Playbook milestones this call seeded (LS-003); 0 on a re-save. */
  milestonesSeeded: number;
}

/**
 * Set, move, or postpone the plant's launch date, then seed the Playbook
 * readiness set (LS-001/002/003/009).
 *
 * SEEDING RUNS AFTER THE DURABLE DATE WRITE, and it is not part of it. The date
 * is what the oversight notification, the countdown and the journal are about;
 * a failure to seed must not lose it. That is safe because seeding is
 * idempotent by unique index (`seedLaunchMilestonesStatement`), so a retry
 * completes it.
 *
 * THE RETRY IS THE NEXT VISIT TO `/launch`, NOT A SECOND SAVE HERE (#614). This
 * comment used to call an unchanged save "the cheap repair path for a launch
 * whose seed failed" — which the form makes unreachable: `ScheduleLaunchForm`
 * disables both buttons until a DIFFERENT day is picked, so the only planter who
 * needed that path could not take it, and Riverside sat scheduled with zero
 * milestones for thirteen days. `convergeLaunchReadiness` is the repair now, and
 * it runs on the READ, where no planter has to know it exists. Seeding still
 * runs on an unchanged save, because a postponed launch may be re-committed to
 * the same Sunday and that is a real write; it inserts nothing when there is
 * nothing to insert.
 */
export async function scheduleLaunchAction(
  input: ScheduleLaunchActionInput
): Promise<ActionResult<ScheduleLaunchActionResult>> {
  try {
    const { user, churchId } = await requireChurchSession("launch.schedule");
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const parsed = scheduleLaunchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const result = await setLaunchDate(user, churchId, parsed.data.targetDate, {
      postpone: parsed.data.postpone ?? false,
      note: parsed.data.note?.trim() || null,
    });

    if (result.status === "error") {
      return { success: false, error: result.error };
    }

    const launch = await getLaunchForChurch(churchId);
    const seeded = launch
      ? await seedLaunchMilestones({
          launchId: launch.id,
          churchId,
          actorUserId: user.id,
        })
      : { milestonesCreated: 0, tasksCreated: 0 };

    revalidateLaunchSurfaces();

    return {
      success: true,
      data: {
        targetDate: result.targetDate,
        changed: result.status === "changed",
        milestonesSeeded: seeded.milestonesCreated,
      },
    };
  } catch (error) {
    return toActionError(error, "set the launch date");
  }
}

// ----------------------------------------------------------------------------
// Milestones (LS-003)
// ----------------------------------------------------------------------------

/**
 * Close a readiness milestone by hand — allowed only when it has no open tasks,
 * which the service enforces in the UPDATE's WHERE rather than trusting this
 * layer to have checked.
 */
export async function completeMilestoneAction(
  milestoneId: string
): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const { user, churchId } = await requireChurchSession("launch.milestone");
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const result = await completeLaunchMilestone(user, churchId, milestoneId);
    if (result.status === "error") {
      return { success: false, error: result.error };
    }

    revalidateLaunchSurfaces();
    return { success: true, data: { changed: result.status === "changed" } };
  } catch (error) {
    return toActionError(error, "complete this milestone");
  }
}

/** Reopen a milestone that was closed too early. */
export async function reopenMilestoneAction(
  milestoneId: string
): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const { user, churchId } = await requireChurchSession("launch.milestone");
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const result = await reopenLaunchMilestone(user, churchId, milestoneId);
    // The same guard `completeMilestoneAction` has, for the same reason: this
    // function's declared return type includes the error arm, and a result the
    // caller never reads is a refusal reported to the planter as a success.
    // `reopenLaunchMilestone` has no error path TODAY — dropping the check
    // would mean the first one added is silently swallowed.
    if (result.status === "error") {
      return { success: false, error: result.error };
    }

    revalidateLaunchSurfaces();
    return { success: true, data: { changed: result.status === "changed" } };
  } catch (error) {
    return toActionError(error, "reopen this milestone");
  }
}

/**
 * Tick (or untick) one of a milestone's linked tasks from the launch page.
 *
 * It goes through the ORDINARY task service — completion semantics belong to
 * the task system (FRD, "Integration points"), including the `task.completed`
 * event that marks the plant dirty. The extra `isLaunchTask` predicate is what
 * keeps this from becoming a general "complete any task in my church"
 * endpoint: this action exists for the launch page's checkboxes, so it answers
 * only for tasks actually linked to this plant's milestones. `/tasks` owns the
 * general case, with its own action and its own UI.
 */
export async function setLaunchTaskCompleteAction(
  taskId: string,
  complete: boolean
): Promise<ActionResult<{ complete: boolean }>> {
  try {
    const { user, churchId } = await requireChurchSession("launch.milestone");
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    if (!(await isLaunchTask(churchId, taskId))) {
      return {
        success: false,
        error: "That task is not part of this launch's readiness list.",
      };
    }

    if (complete) {
      await completeTask(churchId, taskId, user);
    } else {
      await reopenTask(churchId, taskId, user);
    }

    revalidateLaunchSurfaces();
    return { success: true, data: { complete } };
  } catch (error) {
    // "Task is already complete" is the task service's own message and is a
    // true statement about the world, so it is passed through rather than
    // flattened into "something went wrong".
    if (error instanceof Error && error.message.startsWith("Task ")) {
      return { success: false, error: error.message };
    }
    return toActionError(error, "update this task");
  }
}

// ----------------------------------------------------------------------------
// Outcome (LS-006)
// ----------------------------------------------------------------------------

/**
 * Record what happened on Launch Sunday (LS-006). Planter-only, once, and only
 * from the day itself onward — all three enforced by `recordLaunchOutcome`.
 */
export async function recordLaunchOutcomeAction(
  input: LaunchOutcomeInput
): Promise<ActionResult<{ targetDate: string }>> {
  try {
    const { user, churchId } = await requireChurchSession("launch.schedule");
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const result = await recordLaunchOutcome(user, churchId, input);
    if (result.status === "error") {
      return { success: false, error: result.error };
    }

    revalidateLaunchSurfaces();
    return { success: true, data: { targetDate: result.targetDate } };
  } catch (error) {
    return toActionError(error, "record the launch outcome");
  }
}

/**
 * Correct a recorded outcome (LS-006, ruled 2026-08-04). Planter-only, and every
 * correction is journaled — `updateLaunchOutcome` enforces both, and writes the
 * `launch_events` row in the same statement as the correction so a change can
 * never exist without its history.
 *
 * A SEPARATE ACTION FROM RECORDING, deliberately, because the two are different
 * writes with different guards: recording completes a launch and may happen only
 * once, from the target date onward; correcting requires a launch that is
 * ALREADY completed and has no deadline. One action switching on stored state
 * would have to decide which it is from data the client cannot be trusted for.
 */
export async function updateLaunchOutcomeAction(
  input: LaunchOutcomeInput
): Promise<ActionResult<{ targetDate: string; changed: boolean }>> {
  try {
    const { user, churchId } = await requireChurchSession("launch.schedule");
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const result = await updateLaunchOutcome(user, churchId, input);
    if (result.status === "error") {
      return { success: false, error: result.error };
    }

    revalidateLaunchSurfaces();
    return {
      success: true,
      data: {
        targetDate: result.targetDate,
        // `false` when the form was saved without changing anything: the write
        // is a no-op by compare-and-set, so no correction reached the journal
        // and the planter should not be told one did.
        changed: result.status === "updated",
      },
    };
  } catch (error) {
    return toActionError(error, "update the launch outcome");
  }
}
