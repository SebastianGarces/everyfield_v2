// ============================================================================
// The reader's word for each kind of oversight org — ONE table, and the only
// place either word is spelled.
//
// ONE ENTRY POINT, KEYED ON THE ORG'S KIND. It used to have two: a page knew
// the caller's ROLE and asked `scopeLabelForRole(user.role)`, while a dialog
// rendered from association provenance knew the org's KIND. With the role
// column gone (#494) a page has no role to ask about — `requireOversightUser` resolves
// the caller's org from the tenancy FK and hands it back — so both callers now
// hold a kind and the role-keyed door is deleted rather than re-pointed. Before
// this module there were three declarations of a two-word vocabulary: a ternary
// in `presentation.ts`, the same ternary inline on `/oversight/health` and
// `/oversight/invitations`, and a private `Record<AssociationOrgType, string>`
// in `remove-plant-dialog.tsx`. The copy is always the one that misses the fix.
//
// AN IMPORT-FREE LEAF, and that is why it is not a section of
// `presentation.ts`. `remove-plant-dialog.tsx` is a `"use client"` component,
// and `presentation.ts` imports `STATUS_LABELS` from `@/lib/people/status.shared`,
// which imports the VALUE `personStatuses` from `@/db/schema` — so one import
// edge from the dialog would ship the drizzle schema barrel into that page's
// browser chunk. The two type imports below are erased at compile time and add
// no bundle edge.
//
// AND `presentation.ts` DOES NOT RE-EXPORT THESE (memory/invariants.md →
// Multi-Tenancy, the `register-path.ts` rule): a leaf whose contents are also
// served from the trunk is not a leaf, because `import { scopeLabelForRole }
// from "@/lib/oversight/presentation"` would type-check, work, and quietly put
// the heavy module one import away from any client component that wanted a
// label.
// ============================================================================

import type { OversightOrgType } from "@/lib/oversight/types";

const ORG_TYPE_LABEL: Record<OversightOrgType, string> = {
  network: "network",
  sending_church: "sending church",
};

/**
 * An org KIND in the reader's words. Used in the explain-why copy, so an
 * oversight account is told who the plant declined to share with in the same
 * words the rest of the oversight surface uses.
 */
export function scopeLabelForOrgType(orgType: OversightOrgType): string {
  return ORG_TYPE_LABEL[orgType];
}
