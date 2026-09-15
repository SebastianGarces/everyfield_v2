import Link from "next/link";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth";
import { invitationActorFromSession } from "@/lib/invitations/core";
import { getDiscoveryAssociations } from "@/lib/discovery/associations";
import { DiscoveryPlantForm } from "./discovery-plant-form";

export async function DiscoveryHome() {
  const associations = await getDiscoveryAssociations(
    invitationActorFromSession(await verifySession())
  );
  return (
    <PageCanvas context="none" contentFocusTarget scrollLayout="flow">
      <WorkspacePanel className="p-6 sm:p-10">
        <div className="max-w-xl space-y-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Explore church planting
          </h1>
          <p className="text-muted-foreground">
            Read the wiki, save useful articles, and keep track of what you have
            learned. Take the time you need to explore.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/wiki">Browse the wiki</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="#settings/account">Account settings</Link>
            </Button>
          </div>
          <Button asChild variant="outline">
            <Link href="#settings/association">Manage associations</Link>
          </Button>
          {associations && (
            <DiscoveryPlantForm
              associations={[
                ...(associations.sendingChurch
                  ? [
                      {
                        orgType: "sending_church" as const,
                        orgId: associations.sendingChurch.id,
                        orgName: associations.sendingChurch.name,
                      },
                    ]
                  : []),
                ...(associations.network
                  ? [
                      {
                        orgType: "network" as const,
                        orgId: associations.network.id,
                        orgName: associations.network.name,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </WorkspacePanel>
    </PageCanvas>
  );
}
