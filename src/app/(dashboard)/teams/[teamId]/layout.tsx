import { notFound, redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
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

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Ministry Teams", href: "/teams" },
          { label: team.name },
        ]}
      />
      <div className="flex h-full flex-col">
        <TeamDetailHeader team={team} />
        <div className="px-6 pt-0">
          <TeamTabs teamId={teamId} />
        </div>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </>
  );
}
