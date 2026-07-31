import { and, eq, ne, or, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { churches } from "@/db/schema";
import { announceLaunchDateChanged } from "@/lib/notifications/oversight";

// ============================================================================
// The launch date, and the one place it is written.
//
// `churches.launch_date` is a `date` column — a calendar day the plant is
// aiming at, not an instant — so it is stored and compared as `YYYY-MM-DD` and
// never round-tripped through a `Date` (memory/invariants.md → Date & Time
// Rendering: a naive day parsed in the runtime's zone is a different day on the
// server than in the browser).
//
// It exists as its own module because setting the launch date is a MILESTONE
// source (F11 N-025): oversight is told when a plant sets or changes it. Every
// surface that lets a planter pick the date — onboarding step 3 (#202-#210), a
// plant-settings screen later — goes through here, so "did anyone announce
// this?" has one answer instead of one per screen.
//
// The announcement is conditional on the value actually CHANGING. A form that
// re-submits the same date, a double click, a save that touched a different
// field: none of those are a milestone, and the compare-and-set below makes
// that a property of the write rather than a check a caller has to remember.
// ============================================================================

export const launchDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date, like 2026-09-13");

export type SetLaunchDateResult =
  | { status: "changed"; launchDate: string }
  | { status: "unchanged"; launchDate: string }
  | { status: "error"; error: string };

/**
 * Set (or move) a plant's launch date.
 *
 * Returns `unchanged` — successfully — when the stored date already equals the
 * one supplied, and writes nothing in that case. The `WHERE` clause carries
 * that condition, so two concurrent saves of the same date produce one update
 * and one no-op rather than two updates and two milestones; a SELECT-then-
 * UPDATE guard would let both through (memory/invariants.md → Atomicity).
 *
 * Announcing to oversight is best-effort and happens AFTER the durable write:
 * a notification must never be the reason a planter's date failed to save, and
 * an announcement for a date that was not stored would be a lie. Callers are
 * authorised by their own action layer — this module writes, it does not
 * authorise.
 */
export async function setChurchLaunchDate(
  churchId: string,
  launchDate: string
): Promise<SetLaunchDateResult> {
  const parsed = launchDateSchema.safeParse(launchDate);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0].message };
  }

  const [updated] = await db
    .update(churches)
    .set({ launchDate: parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(churches.id, churchId),
        // "Not already this date" — including the null case, which `<>` alone
        // would silently drop.
        or(isNull(churches.launchDate), ne(churches.launchDate, parsed.data))
      )
    )
    .returning({ id: churches.id, name: churches.name });

  if (!updated) {
    return { status: "unchanged", launchDate: parsed.data };
  }

  await announceLaunchDateChanged({
    churchId: updated.id,
    plantName: updated.name,
    launchDate: parsed.data,
  });

  return { status: "changed", launchDate: parsed.data };
}
