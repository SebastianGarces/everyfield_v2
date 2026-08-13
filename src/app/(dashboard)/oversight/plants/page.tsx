// ============================================================================
// Oversight plants directory — `/oversight/plants` (OV-001).
//
// This route owns the three things a component cannot: the role guard, the
// org-scoped read, and its header breadcrumb (#261 — without a declared trail
// the shell falls back to naming a different page).
//
// SCOPING IS THE LEAK GUARD, exactly as on `/oversight/invitations`: the read
// starts from `getAccessibleChurchIds(user)`, which puts the session user's own
// org id in the WHERE, so there is no route param, query string or form field
// on this screen that names an organization. One org cannot read another's
// roster because there is nothing to ask with.
//
// The listing itself is NOT privacy-gated — the roster is visible to the
// associated org whatever its six `share_*` toggles say (memory/invariants.md →
// Hierarchical Access Control). The gate applies to the feature data on the
// per-plant page, not to the plant's existence.
// ============================================================================

import type { Metadata } from "next";

import { HeaderBreadcrumbs } from "@/components/header";
import { PlantsDirectory } from "@/components/oversight/plants-directory";
import { scopeLabelForRole } from "@/lib/oversight/org-label";
import { listOversightPlants } from "@/lib/oversight/read";
import { requireOversightUser } from "@/lib/oversight/session";

export const metadata: Metadata = {
  title: "Church plants",
};

export default async function OversightPlantsPage() {
  // Oversight-only surface. Church-level roles never reach the read — and
  // `listOversightPlants` refuses them a second time by resolving no org.
  const user = await requireOversightUser();

  const plants = await listOversightPlants(user);

  return (
    <>
      {/*
        One crumb: the sidebar lists Church plants as a SIBLING of the oversight
        index, not a child of it, and the label matches both the nav item and
        the page's own <h1>.
      */}
      <HeaderBreadcrumbs items={[{ label: "Church plants" }]} />
      <PlantsDirectory
        plants={plants}
        scopeLabel={scopeLabelForRole(user.role)}
      />
    </>
  );
}
