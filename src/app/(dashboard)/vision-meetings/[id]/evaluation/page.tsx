import { EvaluationForm } from "@/components/vision-meetings/evaluation-form";
import { EvaluationSummary } from "@/components/vision-meetings/evaluation-summary";
import { verifySession } from "@/lib/auth/session";
import { getEvaluation, getMeeting } from "@/lib/vision-meetings/service";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface EvaluationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluationPage({ params }: EvaluationPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, evaluation] = await Promise.all([
    getMeeting(user.churchId, id),
    getEvaluation(user.churchId, id),
  ]);

  if (!meeting) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      {evaluation ? (
        <EvaluationSummary
          evaluation={evaluation}
          meetingNumber={meeting.meetingNumber}
        />
      ) : (
        <EvaluationForm
          meetingId={meeting.id}
          meetingNumber={meeting.meetingNumber}
        />
      )}
    </div>
  );
}
