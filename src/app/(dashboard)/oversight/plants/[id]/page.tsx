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
import { notFound, redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PlantDetail } from "@/components/oversight/plant-detail";
import { getCurrentSession } from "@/lib/auth";
import { oversightOrgOfUser } from "@/lib/invitations/core";
import { getAssociationHistoryForOrg } from "@/lib/invitations/history";
import { scopeLabelForRole } from "@/lib/oversight/presentation";
import { getOversightPlantDetail } from "@/lib/oversight/read";

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
  const { user } = await getCurrentSession();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "sending_church_admin" && user.role !== "network_admin") {
    redirect("/dashboard");
  }

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
  // `oversightOrgOfUser` cannot be null here — the role guard above admits only
  // the two oversight roles, and `getOversightPlantDetail` already answered null
  // for an admin with no org (they reach no plants at all). The empty history is
  // the fail-closed answer rather than an unscoped read.
  const org = oversightOrgOfUser(user);
  const history = org ? await getAssociationHistoryForOrg(org, id) : [];

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Church plants", href: "/oversight/plants" },
          { label: detail.plant.name },
        ]}
      />
      <PlantDetail
        detail={detail}
        scopeLabel={scopeLabelForRole(user.role)}
        history={history}
      />
    </>
  );
}
