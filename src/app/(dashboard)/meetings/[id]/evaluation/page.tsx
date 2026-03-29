import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting, getEvaluation, listAttendees } from "@/lib/meetings/service";
import { notFound } from "next/navigation";
import { EvaluationForm } from "@/components/meetings/evaluation-form";
import { EvaluationSummary } from "@/components/meetings/evaluation-summary";
import { AttendeeNotes, type AttendeeForNotes } from "@/components/meetings/attendee-notes";

export const dynamic = "force-dynamic";

interface EvaluationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluationPage({ params }: EvaluationPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, evaluation, allAttendees] = await Promise.all([
    getMeeting(user.churchId, id),
    getEvaluation(user.churchId, id),
    listAttendees(user.churchId, id),
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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {evaluation ? (
        <>
          <EvaluationSummary
            evaluation={evaluation}
            meetingNumber={meeting.meetingNumber ?? 0}
          />
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
