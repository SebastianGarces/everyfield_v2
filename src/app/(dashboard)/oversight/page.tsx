import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { churches } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { getAccessibleChurchIds } from "@/lib/auth/access";
import { PHASES } from "@/lib/constants";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

export default async function OversightDashboardPage() {
  const { user } = await getCurrentSession();

  if (!user) {
    redirect("/login");
  }

  // Only oversight users can access this page
  if (user.role !== "sending_church_admin" && user.role !== "network_admin") {
    redirect("/dashboard");
  }

  const churchIds = await getAccessibleChurchIds(user);

  // Fetch church plants with their phase info
  const plants =
    churchIds.length > 0
      ? await db.select().from(churches).where(inArray(churches.id, churchIds))
      : [];

  // Aggregate stats
  const plantsByPhase = new Map<number, number>();
  for (const plant of plants) {
    const count = plantsByPhase.get(plant.currentPhase) ?? 0;
    plantsByPhase.set(plant.currentPhase, count + 1);
  }

  const isNetwork = user.role === "network_admin";
  const title = isNetwork ? "Network Overview" : "Sending Church Portfolio";
  const description = isNetwork
    ? "Aggregate view across all church plants in your network"
    : "Overview of church plants sent by your church";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Church Plants</CardDescription>
            <CardTitle className="text-4xl">{plants.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              {plants.length === 0
                ? "No church plants yet. Send invitations to get started."
                : `Across ${new Set(Array.from(plantsByPhase.keys())).size} phases`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pre-Launch</CardDescription>
            <CardTitle className="text-4xl">
              {plants.filter((p) => p.currentPhase < 5).length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              Plants in phases 0-4 (preparing to launch)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Launched</CardDescription>
            <CardTitle className="text-4xl">
              {plants.filter((p) => p.currentPhase >= 5).length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              Plants in phases 5-6 (launched or post-launch)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Plants by Phase */}
      <Card>
        <CardHeader>
          <CardTitle>Plants by Phase</CardTitle>
          <CardDescription>
            Distribution of church plants across the launch journey
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plants.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No church plants associated yet. Use the Invitations page to
              invite planters to join.
            </p>
          ) : (
            <div className="space-y-3">
              {Array.from({ length: 7 }, (_, phase) => {
                const count = plantsByPhase.get(phase) ?? 0;
                const percentage =
                  plants.length > 0
                    ? Math.round((count / plants.length) * 100)
                    : 0;
                return (
                  <div key={phase} className="flex items-center gap-4">
                    <div className="w-48 text-sm font-medium">
                      {PHASES[phase as keyof typeof PHASES]}
                    </div>
                    <div className="bg-muted flex-1 rounded-full">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      />
                    </div>
                    <Badge
                      variant="secondary"
                      className="min-w-12 justify-center"
                    >
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Church Plants List */}
      {plants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Church Plants</CardTitle>
            <CardDescription>
              All church plants in your{" "}
              {isNetwork ? "network" : "sending church"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {plants.map((plant) => (
                <div
                  key={plant.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{plant.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {PHASES[plant.currentPhase as keyof typeof PHASES]}
                    </p>
                  </div>
                  <Badge variant="outline">Phase {plant.currentPhase}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
