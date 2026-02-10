"use server";

import { db } from "@/db";
import { churches, churchPrivacySettings, users } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type CreateChurchState = {
  error?: string;
  fieldErrors?: {
    name?: string;
  };
};

/**
 * Server action for planters to create their church from the dashboard.
 * This is the post-signup flow — planters register for free (Phase 0 + Wiki),
 * then create their church when ready.
 */
export async function createChurch(
  _prevState: CreateChurchState,
  formData: FormData
): Promise<CreateChurchState> {
  const { user } = await verifySession();

  // Only planters without a church can create one
  if (user.role !== "planter") {
    return { error: "Only church planters can create a church" };
  }

  if (user.churchId) {
    return { error: "You already have a church" };
  }

  const name = (formData.get("name") as string)?.trim();

  if (!name || name.length === 0) {
    return {
      fieldErrors: { name: "Please enter a name for your church plant" },
    };
  }

  if (name.length > 255) {
    return {
      fieldErrors: { name: "Church name must be 255 characters or less" },
    };
  }

  // Create church + link user + privacy settings in a transaction
  // The WHERE clause guards against double-submit race conditions
  const church = await db.transaction(async (tx) => {
    const [newChurch] = await tx
      .insert(churches)
      .values({ name })
      .returning();

    // Guard: only link if user still has no church (prevents double-submit)
    const [updated] = await tx
      .update(users)
      .set({ churchId: newChurch.id })
      .where(
        and(eq(users.id, user.id), isNull(users.churchId))
      )
      .returning();

    if (!updated) {
      // Another request already created a church — rollback
      throw new Error("Church already created");
    }

    await tx.insert(churchPrivacySettings).values({
      churchId: newChurch.id,
      updatedBy: user.id,
    });

    return newChurch;
  });

  revalidatePath("/", "layout");
  redirect("/dashboard?churchCreated=true");
}
