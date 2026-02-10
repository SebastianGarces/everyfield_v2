import { redirect, notFound } from "next/navigation";

import { MeetingsTab } from "@/components/ministry-teams/meetings-tab";
import { verifySession } from "@/lib/auth/session";
import { getTeam } from "@/lib/ministry-teams/service";
import { listMeetings } from "@/lib/meetings/service";

export const dynamic = "force-dynamic";

export default async function TeamMeetingsPage({
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

  const { meetings } = await listMeetings(user.churchId, { teamId });

  return <MeetingsTab teamId={teamId} meetings={meetings} />;
}
