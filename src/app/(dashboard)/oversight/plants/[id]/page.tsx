// ============================================================================
// Oversight plant detail — `/oversight/plants/[id]` (OV-002).
//
// The one surface on this feature that takes an id from the URL, so it is the
// one that has to prove the id is the caller's. `getOversightPlantDetail`
// answers `null` for anything that is not — a plant in another org, a plant
// that does not exist, a string that is not even a uuid — and all three become
// the SAME 404 here. That symmetry is the point: a distinguishable refusal
// ("exists, but not yours") would answer a question about another org's
// portfolio, which is the leak the 404 exists to prevent.
//
// The privacy gate lives in the read too: a section the plant has not shared
// arrives with no numbers attached, having never been queried. This page's job
// is the role guard, the breadcrumb trail and handing the result to the view.
// ============================================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas } from "@/components/layout/page-frame";
import { PlantDetail } from "@/components/oversight/plant-detail";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getAssociationHistoryForOrg } from "@/lib/invitations/history";
import { scopeLabelForOrgType } from "@/lib/oversight/org-label";
import { getOversightPlantDetail } from "@/lib/oversight/read";
import { requireOversightUser } from "@/lib/oversight/session";

export const metadata: Metadata = {
  // Static on purpose: a title generated from the plant's name would need a
  // second privacy-scoped read to produce a string that is only ever shown to
  // someone already looking at the page.
  title: "Church plant",
};

interface OversightPlantPageProps {
  params: Promise<{ id: string }>;
}

export default async function OversightPlantPage({
  params,
}: OversightPlantPageProps) {
  // Oversight-only surface — one guard, shared by every /oversight route.
  const { user, org: callerOrg } = await requireOversightUser();

  const { id } = await params;
  const detail = await getOversightPlantDetail(user, id);

  if (!detail) {
    notFound();
  }

  // OV-011 — the audit trail, scoped to the CALLER'S OWN org in the WHERE clause
  // (`memory/invariants.md` → Hierarchical Access Control: reaching a plant is
  // not permission to name the orgs behind it). The org comes from the session,
  // never from the URL, and it is the same derivation the sever is guarded by, so
  // what this page shows and what its Remove action can touch cannot disagree.
  //
  // The org comes from the guard, which resolved it from the session's tenancy
  // FK — so it is non-null by construction and there is no second derivation to
  // disagree with the first. `getAssociationHistoryForOrg` takes the
  // invitations domain's `{ orgType, orgId }` spelling of the same fact.
  const history = await getAssociationHistoryForOrg(
    { orgType: callerOrg.type, orgId: callerOrg.id },
    id
  );
  const breadcrumbs = [
    { label: "Church plants", href: "/oversight/plants" },
    { label: detail.plant.name },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        frameClassName="mx-auto w-full max-w-6xl"
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="flow"
      >
        <PlantDetail
          detail={detail}
          scopeLabel={scopeLabelForOrgType(callerOrg.type)}
          history={history}
          attachedContext
          // THE SEVER IS OWNER-ONLY AND THE PAGE IS NOT (#500). Every seat in the
          // org reads this plant; only the Owner may remove it from the portfolio
          // (`org.association.sever`, ruling 185 (1)). Asked of the capability
          // table so the button and `severAssociationAction` cannot disagree.
          canSever={holdsSeatFor(user, "org.association.sever")}
        />
      </PageCanvas>
    </>
  );
}
