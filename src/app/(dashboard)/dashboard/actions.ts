"use server";

import { db } from "@/db";
import { churches, churchPrivacySettings, users } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { eq, isNull } from "drizzle-orm";
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

  // Create church, link user, and create privacy settings.
  // The isNull(users.churchId) guard prevents double-submit race conditions.
  const [church] = await db.insert(churches).values({ name }).returning();

  const [updated] = await db
    .update(users)
    .set({ churchId: church.id })
    .where(isNull(users.churchId))
    .returning();

  if (!updated) {
    // Another request already linked a church — clean up the orphan
    await db.delete(churches).where(eq(churches.id, church.id));
    return { error: "Church already created" };
  }

  await db.insert(churchPrivacySettings).values({
    churchId: church.id,
    updatedBy: user.id,
  });

  revalidatePath("/", "layout");
  redirect("/dashboard?churchCreated=true");
}
