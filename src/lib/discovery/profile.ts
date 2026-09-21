import { cache } from "react";
import { db } from "@/db";
import { readDiscoveryProfileStatement } from "./profile-repository";

/** Call with the authenticated account ID. This reads current standing too. */
export const hasDiscoveryProfile = cache(async (userId: string) => {
  const result = await db.execute(
    readDiscoveryProfileStatement({ id: userId })
  );
  return result.rows.length === 1;
});
