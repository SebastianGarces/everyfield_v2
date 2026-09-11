import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema";

/** The authenticated plant owns the calendar, never a model-supplied zone. */
export async function readEvryPlantTimeZone(plantId: string): Promise<string> {
  const [plant] = await db
    .select({ timeZone: churches.timeZone })
    .from(churches)
    .where(eq(churches.id, plantId))
    .limit(1);
  if (!plant) throw new Error("Plant unavailable");
  return plant.timeZone;
}
