import { ActivityTimeline } from "@/components/people/activity-timeline";
import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import { verifySession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

interface ActivityPageProps {
  params: Promise<{ id: string }>;
}

export default async function ActivityPage({ params }: ActivityPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/login");
  }

  const { id } = await params;

  return (
    <PersonProfileWrapper personId={id} activeTab="activity">
      <ActivityTimeline churchId={user.churchId} personId={id} />
    </PersonProfileWrapper>
  );
}
