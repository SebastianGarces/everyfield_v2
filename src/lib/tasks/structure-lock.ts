import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * First statement in every transaction that can change Task hierarchy or
 * prerequisites. Keeping the lock in its own statement matters under
 * READ COMMITTED: a writer that waited for another plant writer gets a fresh
 * snapshot for the mutation statement that follows.
 */
export function taskStructureLockStatement(churchId: string) {
  return db.execute(sql`select lock_task_structure(${churchId}::uuid)`);
}
