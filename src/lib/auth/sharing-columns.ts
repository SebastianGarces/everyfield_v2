import { getTableColumns } from "drizzle-orm";

import { churchPrivacySettings } from "@/db/schema";
import type { ChurchPrivacySettings } from "@/db/schema";

// ============================================================================
// WHICH COLUMNS ARE SHARING TOGGLES — asked of the schema, never of a list.
//
// An IMPORT-FREE LEAF apart from the table it reads, like `@/lib/auth/tenancy`
// and for the same reason: both ends of CS-013 need it — `canAccessFeatureData`
// (`./access`, which reaches the coaching layer) and the invitation accept
// (`@/lib/invitations/core`, which reaches the notification layer) — and a home
// inside either would make the other import a graph it has no business in.
// ============================================================================

/**
 * The names of the boolean toggle columns on `church_privacy_settings` — the
 * mapped type rejects `id`, `churchId`, `updatedAt` etc. at compile time, so a
 * mapped column is a boolean by construction and needs no runtime cast.
 */
export type PrivacyColumn = {
  [K in keyof ChurchPrivacySettings]: ChurchPrivacySettings[K] extends boolean
    ? K
    : never;
}[keyof ChurchPrivacySettings];

/**
 * EVERY SHARING TOGGLE THE SCHEMA HAS, READ OFF THE TABLE (CS-013).
 *
 * The invite-origin default writes all of them on, and "all of them" has to
 * mean the column list at BUILD time rather than a list somebody typed: #62's
 * wiki toggle is one column away from existing, and a hand-kept array would
 * ship an invited plant sharing six things out of seven with nothing on any
 * screen to say so. The mapped type above already refuses a non-boolean key,
 * and this is its runtime twin — `getTableColumns` reads the same declaration
 * `drizzle-kit` generates the migration from, so the two cannot disagree and a
 * new toggle joins the default by being declared.
 *
 * `id`, `churchId`, `updatedAt` and `updatedBy` are not booleans and drop out on
 * their own. Nothing here denylists a column by name, which is what keeps the
 * rule true of columns nobody has written yet.
 */
export const SHARING_TOGGLE_COLUMNS: readonly PrivacyColumn[] = Object.entries(
  getTableColumns(churchPrivacySettings)
)
  .filter(([, column]) => column.dataType === "boolean")
  .map(([name]) => name as PrivacyColumn);

/**
 * `{ sharePeople: true, … }` over every toggle above — the value CS-013's
 * acceptance writes.
 *
 * Built fresh per call rather than frozen at module scope: it is spread into a
 * Drizzle `.set()` beside `updatedAt`, and a shared object handed to a query
 * builder is one careless mutation away from a partial default that no test
 * would see.
 */
export function allSharingOn(): Record<PrivacyColumn, true> {
  return Object.fromEntries(
    SHARING_TOGGLE_COLUMNS.map((column) => [column, true])
  ) as Record<PrivacyColumn, true>;
}
