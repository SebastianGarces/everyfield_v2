import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import { PersonTeamAssignments } from "@/components/people/person-team-assignments";
import { PersonTrainingProgress } from "@/components/people/person-training-progress";
import { verifySession } from "@/lib/auth/session";
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
  const [assignments, training] = await Promise.all([
    getPersonTeams(user.churchId, id),
    getPersonTraining(user.churchId, id),
  ]);

  return (
    <PersonProfileWrapper personId={id} activeTab="teams">
      <div className="grid gap-6 md:grid-cols-2">
        <PersonTeamAssignments assignments={assignments} />
        <PersonTrainingProgress items={training} />
      </div>
    </PersonProfileWrapper>
  );
}
