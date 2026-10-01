import { EVALUATION_QUALITY_FACTORS } from "@/lib/meetings/evaluation-factors";
import { listRecordCorrections } from "@/lib/corrections/history";
import { hasVisionFeature } from "@/lib/meetings/vision-features";
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
  EVALUATION_COMPARISON_WINDOW,
} from "@/lib/meetings/evaluation-comparison";
// The evaluation heading names the meeting THIS PAGE loaded, through the one
// derivation. The two children used to synthesise a vision meeting out of a
// number, and the route has no type gate. See src/lib/meetings/labels.ts.
import { meetingDisplayTitle } from "@/lib/meetings/labels";
import {
  getEvaluation,
  getEvaluationTrend,
  getMeeting,
  listAttendees,
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
  const meeting = await getMeeting(user.churchId, id);
  if (!meeting || !hasVisionFeature(meeting, "evaluation")) notFound();

  const [evaluation, allAttendees, trend] = await Promise.all([
    getEvaluation(user.churchId, id),
    listAttendees(user.churchId, id),
    // VM-016c: the history the comparison is drawn from. Church-scoped inside
    // the query, so this can never reach another church's scores.
    getEvaluationTrend(user.churchId, EVALUATION_COMPARISON_WINDOW),
  ]);

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

  const corrections = evaluation
    ? await listRecordCorrections(
        user.churchId,
        "meeting_evaluation",
        evaluation.id
      )
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {evaluation ? (
        <>
          <EvaluationSummary
            key={evaluation.updatedAt.toISOString()}
            evaluation={evaluation}
            meetingId={meeting.id}
            title={meetingDisplayTitle(meeting)}
          />
          <EvaluationComparisonCard comparison={comparison} />
          {corrections.length > 0 && (
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer">
                Correction history ({corrections.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {corrections.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      Corrected {entry.correctedAt.toISOString().slice(0, 10)}
                    </span>
                    <ul className="text-sm">
                      {EVALUATION_QUALITY_FACTORS.map((factor) => (
                        <li key={factor.key}>
                          {factor.label}:{" "}
                          {String(
                            (entry.before as Record<string, unknown>)[
                              factor.key.replace(
                                /[A-Z]/g,
                                (c) => `_${c.toLowerCase()}`
                              )
                            ] ?? "—"
                          )}{" "}
                          →{" "}
                          {String(
                            (entry.after as Record<string, unknown>)[
                              factor.key.replace(
                                /[A-Z]/g,
                                (c) => `_${c.toLowerCase()}`
                              )
                            ] ?? "—"
                          )}
                        </li>
                      ))}
                      <li>
                        Notes:{" "}
                        {String(
                          (entry.before as Record<string, unknown>).notes ??
                            "None"
                        )}{" "}
                        →{" "}
                        {String(
                          (entry.after as Record<string, unknown>).notes ??
                            "None"
                        )}
                      </li>
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          )}

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
            title={meetingDisplayTitle(meeting)}
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
