import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema";

/** The stored church phase is authoritative; readiness and scheduled launches do not advance it. */
export async function readEvryPlantPhase(plantId: string): Promise<number> {
  const [plant] = await db
    .select({ currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, plantId))
    .limit(1);
  if (!plant) throw new Error("Plant unavailable");
  return plant.currentPhase;
}
