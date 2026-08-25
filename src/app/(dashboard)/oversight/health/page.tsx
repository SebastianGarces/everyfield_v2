// ============================================================================
// Oversight plant-health surface — /oversight/health (PE-007 / PE-013 / PE-017,
// AC-PE-7 / AC-PE-9).
//
// The network/sending-church portfolio health read. Reads the latest COMPLETE
// assessment snapshot per accessible plant (zero LLM on load, PE-011) and
// renders ONLY privacy-gated network-audience insights via the read layer.
// Access is gated by `getAccessibleChurchIds` + `canAccessFeatureData` inside
// `getOversightPlantHealth`; this page additionally hard-guards on the oversight
// role before any read runs.
//
// This route owns the guard, the read, and the one shell-level declaration a
// page cannot delegate — its header breadcrumb. Everything visual lives in
// `PlantHealthPortfolio`, so the surface can be rendered and reviewed without a
// session or a database.
// ============================================================================

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas } from "@/components/layout/page-frame";
import { PlantHealthPortfolio } from "@/components/phase-engine/plant-health-portfolio";
import { scopeLabelForOrgType } from "@/lib/oversight/org-label";
import { requireOversightUser } from "@/lib/oversight/session";
import { getOversightPlantHealth } from "@/lib/phase-engine/oversight/read";

export default async function OversightHealthPage() {
  // Oversight-only surface. A church-level tenancy never reaches the
  // privacy-gated read — one guard, shared by every /oversight route.
  const { user, org } = await requireOversightUser();

  const plants = await getOversightPlantHealth(user);
  // `scopeLabelForOrgType` is the ONE spelling of these two words; this page
  // used to re-derive them inline.
  const scopeLabel = scopeLabelForOrgType(org.type);

  return (
    <>
      {/*
        The header breadcrumb is opt-in per page, and without this the shell fell
        back to naming a different page ("Dashboard", #261). One crumb, not a
        trail under /oversight: the sidebar lists Plant Health as a SIBLING of
        the oversight index, not a child of it, and the label matches both the
        nav item and this page's own <h1>.
      */}
      <HeaderBreadcrumbs items={[{ label: "Plant Health" }]} />
      <PageCanvas className="p-0" context="none" contentFocusTarget>
        <PlantHealthPortfolio plants={plants} scopeLabel={scopeLabel} />
      </PageCanvas>
    </>
  );
}
