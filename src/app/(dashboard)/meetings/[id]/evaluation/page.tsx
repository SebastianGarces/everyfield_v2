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

import { PrototypeSwitcher } from "@/components/prototype-switcher";

import { EvaluationComparisonCard } from "./evaluation-comparison";

/**
 * PROTOTYPE (2026-08-10, #312) — the comparison empty state's sentence has
 * four competing candidates on this branch. Deleted when it is ruled.
 *
 * The init script is INLINED rather than built with `prototypeInitScript`:
 * that helper is exported from a "use client" module, so a Server Component
 * cannot call it (it is a client reference here, not a function). It
 * re-applies the stored choice before first paint, so a reload does not flash
 * option A over the option being judged.
 */
const COMPARISON_PROTO_INIT = `try{var p=localStorage.getItem("cmp-proto");document.documentElement.setAttribute("data-cmp-proto",["a","b","c","d"].includes(p)?p:"a")}catch(e){document.documentElement.setAttribute("data-cmp-proto","a")}`;

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
      {/* PROTOTYPE (#312) — delete with the losing variants. */}
      <script dangerouslySetInnerHTML={{ __html: COMPARISON_PROTO_INIT }} />
      <PrototypeSwitcher
        attribute="data-cmp-proto"
        storageKey="cmp-proto"
        label="Empty state"
        options={[
          {
            id: "a",
            label: "A · As built",
            hint: "One sentence that explains the card and names the window",
          },
          {
            id: "b",
            label: "B · Situational",
            hint: "One short line about this meeting, no number",
          },
          {
            id: "c",
            label: "C · By cause",
            hint: "Names the window only when the window could be the cause",
          },
          {
            id: "d",
            label: "D · Line + note",
            hint: "Plain lead line, mechanism demoted to small print",
          },
        ]}
      />
      {evaluation ? (
        <>
          <EvaluationSummary
            evaluation={evaluation}
            meetingNumber={meeting.meetingNumber ?? 0}
          />
          <EvaluationComparisonCard
            comparison={comparison}
            windowFull={trend.length >= EVALUATION_COMPARISON_WINDOW}
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
