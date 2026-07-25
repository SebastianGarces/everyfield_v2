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
// This route owns the guard and the read only. Everything visual lives in
// `PlantHealthPortfolio`, so the surface can be rendered and reviewed without a
// session or a database.
// ============================================================================

import { redirect } from "next/navigation";

import { PlantHealthPortfolio } from "@/components/phase-engine/plant-health-portfolio";
import { getCurrentSession } from "@/lib/auth";
import { getOversightPlantHealth } from "@/lib/phase-engine/oversight/read";

export default async function OversightHealthPage() {
  const { user } = await getCurrentSession();

  if (!user) {
    redirect("/login");
  }

  // Oversight-only surface. Church-level roles never reach the privacy-gated read.
  if (user.role !== "sending_church_admin" && user.role !== "network_admin") {
    redirect("/dashboard");
  }

  const plants = await getOversightPlantHealth(user);
  const scopeLabel =
    user.role === "network_admin" ? "network" : "sending church";

  return <PlantHealthPortfolio plants={plants} scopeLabel={scopeLabel} />;
}
