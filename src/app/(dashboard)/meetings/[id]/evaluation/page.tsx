import { notFound, redirect } from "next/navigation";

import {
  AttendeeNotes,
  type AttendeeForNotes,
} from "@/components/meetings/attendee-notes";
import { EvaluationForm } from "@/components/meetings/evaluation-form";
import { EvaluationSummary } from "@/components/meetings/evaluation-summary";
import { verifySession } from "@/lib/auth/session";
import {
  compareEvaluationToHistory,
  getEvaluation,
  getEvaluationTrend,
  getMeeting,
  listAttendees,
  EVALUATION_COMPARISON_WINDOW,
} from "@/lib/meetings/service";

import { EvaluationComparisonCard } from "./evaluation-comparison";

export const dynamic = "force-dynamic";

interface EvaluationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluationPage({ params }: EvaluationPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, evaluation, allAttendees, trend] = await Promise.all([
    getMeeting(user.churchId, id),
    getEvaluation(user.churchId, id),
    listAttendees(user.churchId, id),
    // VM-016c: the history the comparison is drawn from. Church-scoped inside
    // the query, so this can never reach another church's scores.
    getEvaluationTrend(user.churchId, EVALUATION_COMPARISON_WINDOW),
  ]);

  if (!meeting) notFound();

  // Filter to only people who actually attended
  const attendedPeople: AttendeeForNotes[] = allAttendees
    .filter((a) => a.status === "attended")
    .map((a) => ({
      personId: a.person.id,
      firstName: a.person.firstName,
      lastName: a.person.lastName,
    }));

  // `null` when nothing in the fetched window is earlier than this meeting —
  // the card renders its empty state rather than a delta against a history it
  // does not have. See the ruling note in `service.ts`.
  const comparison = evaluation
    ? compareEvaluationToHistory(trend, {
        meetingId: meeting.id,
        datetime: meeting.datetime,
        totalScore: parseFloat(evaluation.totalScore),
      })
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {evaluation ? (
        <>
          <EvaluationSummary
            evaluation={evaluation}
            meetingNumber={meeting.meetingNumber ?? 0}
          />
          <EvaluationComparisonCard comparison={comparison} />
          {/* Show attendee notes after evaluation is saved */}
          <AttendeeNotes
            meetingId={meeting.id}
            meetingType={meeting.type}
            attendees={attendedPeople}
          />
        </>
      ) : (
        <>
          <EvaluationForm
            meetingId={meeting.id}
            meetingNumber={meeting.meetingNumber ?? 0}
          />
          {/* Show attendee notes alongside form as well */}
          <AttendeeNotes
            meetingId={meeting.id}
            meetingType={meeting.type}
            attendees={attendedPeople}
          />
        </>
      )}
    </div>
  );
}
