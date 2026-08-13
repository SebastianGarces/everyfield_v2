// ============================================================================
// The role POLICY constants — one declaration each, in an import-free leaf.
//
// WHY A LEAF AND NOT `./access.ts`. `access.ts` opens with `import { db } from
// "@/db"`, whose module scope calls `neon(process.env.DATABASE_URL!)`. So any
// module that only wants to know WHICH ROLES a rule names — the `/oversight`
// route guard (`@/lib/oversight/session`), a test asserting a two-element list
// — paid a database connection for it, and the oversight domain's
// no-DATABASE_URL seam (`src/lib/oversight/read-imports.test.ts`) could not
// reach through `access.ts` at all. That is what produced a SECOND declaration
// of the oversight pair in `session.ts`, reconciled by a regex over this file's
// source text: a drift guard coupled to one literal declaration form, which the
// fix below would itself have broken.
//
// `import type` only — nothing here may gain a value import, or the seam that
// makes this file useful is gone (the same rule
// `src/lib/invitations/register-path.ts` lives by, and
// `roles.test.ts` enforces it).
//
// `as const satisfies readonly UserRole[]` rather than `: UserRole[]`: the
// annotation checks the members against the union AND keeps the literal types,
// so `isOversightRole` in the oversight guard can be a type predicate over the
// one declaration instead of over a copy of it.
// ============================================================================

import type { UserRole } from "@/db/schema";

/** Roles that operate at the church-plant level. */
export const CHURCH_LEVEL_ROLES = [
  "planter",
  "coach",
  "team_member",
] as const satisfies readonly UserRole[];

/** Roles that have oversight access — the two an `/oversight` route serves. */
export const OVERSIGHT_ROLES = [
  "sending_church_admin",
  "network_admin",
] as const satisfies readonly UserRole[];

/** A role known to be one of the two oversight roles. */
export type OversightRole = (typeof OVERSIGHT_ROLES)[number];

/** A role known to operate inside a single church plant. */
export type ChurchLevelRole = (typeof CHURCH_LEVEL_ROLES)[number];

/** Whether `role` is one of the two oversight roles, as a type predicate. */
export function isOversightRole(role: UserRole): role is OversightRole {
  return (OVERSIGHT_ROLES as readonly UserRole[]).includes(role);
}
