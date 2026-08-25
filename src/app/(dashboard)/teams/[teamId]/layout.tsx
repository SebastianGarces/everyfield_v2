import { notFound, redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TeamDetailHeader } from "@/components/ministry-teams/team-detail-header";
import { TeamTabs } from "@/components/ministry-teams/team-tabs";
import { verifySession } from "@/lib/auth/session";
import { getTeam } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ teamId: string }>;
}) {
  const { user } = await verifySession();
  const { teamId } = await params;

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const team = await getTeam(user.churchId, teamId);

  if (!team) {
    notFound();
  }

  const breadcrumbs = [
    { label: "Ministry Teams", href: "/teams" },
    { label: team.name },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="flow"
      >
        <WorkspacePanel className="min-h-full">
          <TeamDetailHeader team={team} />
          <div className="px-4 pt-0 sm:px-6">
            <TeamTabs teamId={teamId} />
          </div>
          <div className="p-4 sm:p-6">{children}</div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
