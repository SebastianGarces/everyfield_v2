import { notFound, redirect } from "next/navigation";

import { MembersRolesTab } from "@/components/ministry-teams/members-roles-tab";
import { verifySession } from "@/lib/auth/session";
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

  return <MembersRolesTab team={team} people={peopleResult.people} />;
}
