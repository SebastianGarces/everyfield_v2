import { db } from "@/db";
import { recordCorrections, users } from "@/db/schema";
import { and, eq, desc, getTableColumns } from "drizzle-orm";

/** Call only after the owning record's read capability has been checked. */
export async function listRecordCorrections(
  churchId: string,
  entityType: string,
  entityId: string
) {
  return db
    .select({
      ...getTableColumns(recordCorrections),
      correctedByName: users.name,
    })
    .from(recordCorrections)
    .leftJoin(users, eq(users.id, recordCorrections.correctedBy))
    .where(
      and(
        eq(recordCorrections.churchId, churchId),
        eq(recordCorrections.entityType, entityType),
        eq(recordCorrections.entityId, entityId)
      )
    )
    .orderBy(desc(recordCorrections.correctedAt));
}
