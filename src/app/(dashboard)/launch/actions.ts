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
// LS-007's SPLIT, which is why the role check is not uniform below:
//   scheduling / postponing / recording the outcome  → the PLANTER's alone.
//   milestone and task completion                    → normal task rules, so a
//                                                      team member may do it.
// The UI hides what a role may not do; these are the checks that make it true.
// ============================================================================

import { refresh, revalidatePath } from "next/cache";

import { verifySession } from "@/lib/auth/session";
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
 * The session's user and church, or a refusal.
 *
 * A planter with no church cannot have a launch, and every read and write below
 * is church-scoped, so this is the one place the missing-church case is
 * answered — in a sentence, rather than by a `null` that becomes a crash three
 * frames later.
 */
async function requireChurchSession() {
  const { user } = await verifySession();
  if (!user.churchId) {
    return { user: null, churchId: null } as const;
  }
  return { user, churchId: user.churchId } as const;
}

const NO_CHURCH_MESSAGE =
  "You need a church plant before you can work on a launch.";

/**
 * Turn a thrown error into a sentence, without telling the caller which guard
 * refused them. `requireRole` and `requireChurchAccess` throw `Forbidden: …`
 * strings that name roles and ids; those belong in the server log, not in a
 * response.
 */
function toActionError(error: unknown, verb: string): ActionResult<never> {
  console.error(`launch action failed while ${verb}:`, error);

  if (error instanceof Error) {
    if (error.message === "Unauthorized") {
      return { success: false, error: `You must be logged in to ${verb}.` };
    }
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
 * idempotent by unique index (`seedLaunchMilestonesStatement`), so the retry —
 * the planter saving again, or scheduling later — completes it. Seeding also
 * runs on an UNCHANGED save for exactly that reason: it is the cheap repair
 * path for a launch whose seed failed, and it inserts nothing when there is
 * nothing to insert.
 */
export async function scheduleLaunchAction(
  input: ScheduleLaunchActionInput
): Promise<ActionResult<ScheduleLaunchActionResult>> {
  try {
    const { user, churchId } = await requireChurchSession();
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const result = await setLaunchDate(user, churchId, input.targetDate, {
      postpone: input.postpone ?? false,
      note: input.note?.trim() || null,
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
    const { user, churchId } = await requireChurchSession();
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
    const { user, churchId } = await requireChurchSession();
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    const result = await reopenLaunchMilestone(user, churchId, milestoneId);

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
    const { user, churchId } = await requireChurchSession();
    if (!user) return { success: false, error: NO_CHURCH_MESSAGE };

    if (!(await isLaunchTask(churchId, taskId))) {
      return {
        success: false,
        error: "That task is not part of this launch's readiness list.",
      };
    }

    if (complete) {
      await completeTask(churchId, taskId, user.id);
    } else {
      await reopenTask(churchId, taskId);
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
    const { user, churchId } = await requireChurchSession();
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
    const { user, churchId } = await requireChurchSession();
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
