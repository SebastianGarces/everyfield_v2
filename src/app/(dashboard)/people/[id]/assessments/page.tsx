import { AssessmentsTabs } from "@/components/people/assessments-tabs";
import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import { verifySession } from "@/lib/auth/session";
import { getAssessments, getInterviews } from "@/lib/people/assessments";
import { getCommitments } from "@/lib/people/commitments";
import { redirect } from "next/navigation";
import { Suspense } from "react";

interface AssessmentsPageProps {
  params: Promise<{ id: string }>;
}

export default async function AssessmentsPage({
  params,
}: AssessmentsPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/login");
  }

  const { id } = await params;

  // Fetch assessments, interviews, and commitments in parallel
  const [assessments, interviews, commitments] = await Promise.all([
    getAssessments(user.churchId, id),
    getInterviews(user.churchId, id),
    getCommitments(user.churchId, id),
  ]);

  return (
    <PersonProfileWrapper personId={id} activeTab="assessments">
      <Suspense fallback={null}>
        <AssessmentsTabs
          personId={id}
          assessments={assessments}
          interviews={interviews}
          commitments={commitments}
        />
      </Suspense>
    </PersonProfileWrapper>
  );
}
