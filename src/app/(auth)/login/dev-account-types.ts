// ============================================================================
// LOCAL DEVELOPMENT ONLY — shared shapes for the dev account switcher.
//
// Deliberately free of any DB or server import. The client combobox needs the
// group ordering as a VALUE, and importing a value from `dev-accounts.ts` would
// pull `@/db` into the client bundle, where `neon()` throws on a missing
// DATABASE_URL. Keep this module dependency-free.
// ============================================================================

/** Grouping shown as section headers in the combobox. */
export type DevAccountGroup =
  | "Phase Engine eval"
  | "Oversight"
  | "Planters"
  | "Other";

export interface DevAccount {
  id: string;
  name: string;
  email: string;
  /** What this account is, as one phrase — see `standingLabel`. */
  standing: string;
  churchName: string | null;
  group: DevAccountGroup;
}

/** Order groups appear in the list — most-used first. */
export const DEV_ACCOUNT_GROUP_ORDER: DevAccountGroup[] = [
  "Phase Engine eval",
  "Oversight",
  "Planters",
  "Other",
];
