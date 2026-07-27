import { notFound, redirect } from "next/navigation";

import { ContextualTemplates } from "@/components/documents/contextual-templates";
import { MembersRolesTab } from "@/components/ministry-teams/members-roles-tab";
import { verifySession } from "@/lib/auth/session";
import { getTeamContextualTemplates } from "@/lib/documents/contextual";
import { getTeam } from "@/lib/ministry-teams/service";
import { listPeople } from "@/lib/people/service";

export const dynamic = "force-dynamic";

export default async function TeamMembersPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { user } = await verifySession();
  const { teamId } = await params;

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const [team, peopleResult] = await Promise.all([
    getTeam(user.churchId, teamId),
    listPeople(user.churchId, { limit: 100 }),
  ]);

  if (!team) {
    notFound();
  }

  // DOC-014: the launch-day checklist packet this team works from, linked
  // straight to the template's generate dialog.
  const contextualTemplates = getTeamContextualTemplates(team);

  return (
    <div className="space-y-6">
      <MembersRolesTab team={team} people={peopleResult.people} />

      <ContextualTemplates
        templates={contextualTemplates}
        title="Team Documents"
        description="Materials this team works from — pick a format when you generate."
      />
    </div>
  );
}
