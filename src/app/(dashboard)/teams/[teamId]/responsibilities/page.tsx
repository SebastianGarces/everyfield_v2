import { notFound, redirect } from "next/navigation";

import { ResponsibilitiesTab } from "@/components/ministry-teams/responsibilities-tab";
import { verifySession } from "@/lib/auth/session";
import { getTeam } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamResponsibilitiesPage({
  params,
}: {
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

  return <ResponsibilitiesTab teamName={team.name} />;
}
