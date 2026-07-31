"use server";

import { db } from "@/db";
import { churches, churchPrivacySettings, users } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { linkUserToChurchFilter } from "@/lib/churches/link-user";
import { churchBasicsFromFormData } from "@/lib/validations/onboarding";
import { extractFieldErrors } from "@/lib/validations/utils";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ChurchBasicsFieldErrors = {
  name?: string;
  city?: string;
  stateRegion?: string;
  country?: string;
};

export type ChurchBasicsState =
  | { status: "created" }
  | { status: "error"; error?: string; fieldErrors?: ChurchBasicsFieldErrors };

/**
 * F12 / OB-001 + OB-002 — step 1 of onboarding: create the church.
 *
 * The church is created HERE, at the first step, not at the end of the flow.
 * That is the point of OB-001: a planter who closes the tab after typing a
 * name owns a real, valid church and comes back to the remaining steps rather
 * than to nothing. Everything steps 2-4 will capture is an UPDATE to this row.
 *
 * Deliberately does NOT redirect — the flow advances to step 2 in place, and
 * only `completeOnboarding` leaves the flow.
 */
export async function createChurchBasics(
  formData: FormData
): Promise<ChurchBasicsState> {
  const { user } = await verifySession();

  // Only planters without a church can create one
  if (user.role !== "planter") {
    return {
      status: "error",
      error: "Only church planters can create a church",
    };
  }

  if (user.churchId) {
    return { status: "error", error: "You already have a church" };
  }

  const parsed = churchBasicsFromFormData(formData);

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: extractFieldErrors<ChurchBasicsFieldErrors>(parsed.error),
    };
  }

  const { name, city, stateRegion, country } = parsed.data;

  // Create church, link user, and create privacy settings.
  const [church] = await db
    .insert(churches)
    .values({ name, city, stateRegion, country })
    .returning();

  const [updated] = await db
    .update(users)
    .set({ churchId: church.id })
    .where(linkUserToChurchFilter(user.id))
    .returning();

  if (!updated) {
    // Another request already linked a church — clean up the orphan
    await db.delete(churches).where(eq(churches.id, church.id));
    return { status: "error", error: "Church already created" };
  }

  await db.insert(churchPrivacySettings).values({
    churchId: church.id,
    updatedBy: user.id,
  });

  revalidatePath("/", "layout");

  return { status: "created" };
}

export type CompleteOnboardingState = { status: "error"; error: string };

/**
 * F12 / OB-001 — leave the onboarding flow and hand the dashboard back.
 *
 * Stamping `onboarding_completed_at` is what stops the flow owning
 * `/dashboard`. It records "the planter is done answering", not "every step
 * was answered": skipping straight through from step 1 is a legitimate way to
 * get here (AC 4) and leaves exactly today's outcome — a named church at phase
 * 0 with no launch date. Which facts are still missing stays derivable from the
 * columns themselves, which is what the incomplete-onboarding nudge (OB-011)
 * will read.
 *
 * The `IS NULL` guard makes this idempotent: a double submit, or a second tab,
 * cannot move a completion timestamp that is already set.
 *
 * On success this redirects and never returns.
 */
export async function completeOnboarding(): Promise<CompleteOnboardingState> {
  const { user } = await verifySession();

  if (user.role !== "planter") {
    return { status: "error", error: "Only church planters can onboard" };
  }

  if (!user.churchId) {
    return {
      status: "error",
      error: "Create your church plant before finishing setup",
    };
  }

  await db
    .update(churches)
    .set({ onboardingCompletedAt: new Date() })
    .where(
      and(
        eq(churches.id, user.churchId),
        isNull(churches.onboardingCompletedAt)
      )
    );

  revalidatePath("/", "layout");
  redirect("/dashboard?churchCreated=true");
}
