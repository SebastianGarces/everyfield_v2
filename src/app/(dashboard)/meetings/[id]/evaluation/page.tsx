import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting, getEvaluation } from "@/lib/meetings/service";
import { notFound } from "next/navigation";
import { EvaluationForm } from "@/components/meetings/evaluation-form";
import { EvaluationSummary } from "@/components/meetings/evaluation-summary";

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
          meetingNumber={meeting.meetingNumber ?? 0}
        />
      ) : (
        <EvaluationForm
          meetingId={meeting.id}
          meetingNumber={meeting.meetingNumber ?? 0}
        />
      )}
    </div>
  );
}
