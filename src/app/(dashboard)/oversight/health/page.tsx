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
// ============================================================================

import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlantHealthCard } from "@/components/phase-engine/plant-health-card";
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

  const isNetwork = user.role === "network_admin";
  const scopeLabel = isNetwork ? "network" : "sending church";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Plant Health</h1>
        <p className="text-muted-foreground mt-1">
          A conservative, share-gated read of each plant in your {scopeLabel}.
          These are observations from each plant&apos;s latest assessment — not
          verdicts — and only reflect what planters have chosen to share.
        </p>
      </div>

      {plants.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No church plants yet</CardTitle>
            <CardDescription>
              Once plants are associated with your {scopeLabel}, their health
              observations will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <PortfolioSummary plants={plants} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plants.map((plant) => (
              <PlantHealthCard key={plant.churchId} plant={plant} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PortfolioSummary({
  plants,
}: {
  plants: Awaited<ReturnType<typeof getOversightPlantHealth>>;
}) {
  const counts = {
    "on-track": plants.filter((p) => p.classification === "on-track").length,
    watch: plants.filter((p) => p.classification === "watch").length,
    readiness: plants.filter((p) => p.classification === "readiness").length,
  };

  const items: { label: string; description: string; value: number }[] = [
    {
      label: "On track",
      description: "No elevated observations this cycle",
      value: counts["on-track"],
    },
    {
      label: "Worth a look",
      description: "Has a medium-urgency observation",
      value: counts.watch,
    },
    {
      label: "Readiness focus",
      description: "Launch nearing or an elevated observation",
      value: counts.readiness,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-4xl">{item.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">{item.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
