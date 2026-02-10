import { InvitationTracker } from "@/components/vision-meetings/invitation-tracker";
import { verifySession } from "@/lib/auth/session";
import { listPeople } from "@/lib/people/service";
import {
  getInvitationLeaderboard,
  getInvitationSummary,
  listInvitations,
} from "@/lib/vision-meetings/invitations";
import { getMeeting } from "@/lib/vision-meetings/service";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface InvitationsPageProps {
  params: Promise<{ id: string }>;
}

export default async function InvitationsPage({
  params,
}: InvitationsPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, invitationsList, leaderboard, summary, coreGroupResult] =
    await Promise.all([
      getMeeting(user.churchId, id),
      listInvitations(user.churchId, id),
      getInvitationLeaderboard(user.churchId, id),
      getInvitationSummary(user.churchId, id),
      listPeople(user.churchId, { status: ["core_group"], limit: 100 }),
    ]);

  if (!meeting) notFound();

  return (
    <InvitationTracker
      meetingId={meeting.id}
      invitations={invitationsList}
      leaderboard={leaderboard}
      summary={summary}
      coreGroupMembers={coreGroupResult.people}
    />
  );
}
