import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema";

/**
 * Reset one scratch plant's dirty marker between the owning-interface and Evry
 * create-person assertions. This is test setup, never a production writer.
 */
export async function resetEvryPeopleEffectProofDirtyMarker(
  churchId: string
): Promise<void> {
  if (process.env.LIVE_DB_TESTS !== "1") {
    throw new Error("People effect proof seeding requires LIVE_DB_TESTS=1");
  }
  await db
    .update(churches)
    .set({ lastMaterialEventAt: null })
    .where(eq(churches.id, churchId));
}
