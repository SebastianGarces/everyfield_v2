import { db } from "@/db";
import { sql } from "drizzle-orm";

/** First statement for native leadership writes and plant seat removal.
 * Keep this separate from reads: the next READ COMMITTED statement must see
 * changes committed while this lock waited. Team/child locks come afterward.
 * Evry must use this same key before its effect statement when integrated.
 */
export function lockPlantLeadership(churchId: string) {
  return db.execute(sql`select pg_advisory_xact_lock(
    hashtextextended(${`team-leadership:${churchId}`}, 0)
  )`);
}
