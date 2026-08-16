import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import { PersonTeamAssignments } from "@/components/people/person-team-assignments";
import { PersonTrainingProgress } from "@/components/people/person-training-progress";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";
import {
  getPersonTeams,
  getPersonTraining,
} from "@/lib/ministry-teams/service";
import { redirect } from "next/navigation";

interface TeamsPageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;

  // Both reads are scoped to the session's church and neither depends on the
  // other, so fetch them together rather than in a waterfall.
  const [assignments, training, church] = await Promise.all([
    getPersonTeams(user.churchId, id),
    getPersonTraining(user.churchId, id),
    getCurrentUserChurch(),
  ]);

  const timeZone = church?.timeZone ?? DEFAULT_CHURCH_TIME_ZONE;

  return (
    <PersonProfileWrapper personId={id} activeTab="teams">
      <div className="grid gap-6 md:grid-cols-2">
        <PersonTeamAssignments assignments={assignments} timeZone={timeZone} />
        <PersonTrainingProgress items={training} timeZone={timeZone} />
      </div>
    </PersonProfileWrapper>
  );
}
