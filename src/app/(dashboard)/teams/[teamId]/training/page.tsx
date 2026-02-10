import { notFound, redirect } from "next/navigation";

import { TrainingTab } from "@/components/ministry-teams/training-tab";
import { verifySession } from "@/lib/auth/session";
import {
  getTeam,
  getTrainingMatrix,
  listTrainingPrograms,
} from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamTrainingPage({
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

  const [programs, trainingMatrix] = await Promise.all([
    listTrainingPrograms(user.churchId, teamId),
    getTrainingMatrix(user.churchId, teamId),
  ]);

  return (
    <TrainingTab
      teamId={teamId}
      programs={programs}
      matrix={trainingMatrix.rows}
    />
  );
}
