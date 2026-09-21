import Link from "next/link";
import { SettingsLink } from "@/components/settings/settings-link";
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
        <div className="flex max-w-xl flex-col items-start gap-5">
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
              <SettingsLink section="account">Account settings</SettingsLink>
            </Button>
          </div>
          <Button asChild variant="outline">
            <SettingsLink section="association">
              Manage associations
            </SettingsLink>
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
