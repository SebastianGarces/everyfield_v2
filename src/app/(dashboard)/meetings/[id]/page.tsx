import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { verifySession } from "@/lib/auth/session";
import {
  getFollowUpCompletion,
  getMeeting,
  MEETING_EVALUATION_TASK_CARD_TITLE,
  parseAgenda,
  setMeetingAgenda,
  VISION_MEETING_DEFAULT_AGENDA,
  type AgendaSection,
} from "@/lib/meetings/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { listLocations } from "@/lib/meetings/locations";
import { getMeetingCommunications } from "@/lib/communication/service";
import { notFound } from "next/navigation";
import { MeetingDetails } from "./meeting-details-client";
import { ContextualTemplates } from "@/components/documents/contextual-templates";
import { MeetingCommunicationStatus } from "@/components/meetings/meeting-communication-status";
import {
  AgendaBuilder,
  type AgendaSaveResult,
} from "@/components/meetings/agenda-builder";
import { getMeetingContextualTemplates } from "@/lib/documents/contextual";
import { db } from "@/db";
import { churches } from "@/db/schema/church";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface MeetingPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Save this meeting's running order (VM-013).
 *
 * Inline rather than in `meetings/actions.ts` because it is the agenda card's
 * only write and nothing else calls it. Like every action it takes no actor:
 * the church comes from `verifySession()`, and the meeting id is only ever
 * matched inside that church's rows (`setMeetingAgenda` puts the church in the
 * `WHERE`), so a meeting id from another tenant matches nothing and is refused.
 *
 * `refresh()` rather than `revalidatePath` — the house rule for a mutation
 * whose only reader is the page the planter is already on
 * (memory/contracts/data-patterns.md).
 */
async function saveAgendaAction(
  meetingId: string,
  sections: AgendaSection[]
): Promise<AgendaSaveResult> {
  "use server";

  const { user } = await verifySession();

  if (!user.churchId) {
    return { success: false, error: "This account has no church yet." };
  }

  try {
    await setMeetingAgenda(user.churchId, meetingId, sections);
  } catch {
    return {
      success: false,
      error: "The agenda could not be saved. Try again.",
    };
  }

  refresh();
  return { success: true };
}

export default async function MeetingPage({ params }: MeetingPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [meeting, locations, comms, churchRows, followUp] = await Promise.all([
    getMeeting(user.churchId, id),
    listLocations(user.churchId),
    getMeetingCommunications(user.churchId, id),
    db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1),
    // VM-020. `null` until attendance is finalized — see `getFollowUpCompletion`.
    getFollowUpCompletion(user.churchId, id),
  ]);

  if (!meeting) {
    notFound();
  }

  const church = churchRows[0];

  // DOC-014: the documents this meeting type calls for, linked straight to the
  // template's generate dialog. `null` when there is no match — nothing renders.
  const documentSection = getMeetingContextualTemplates(meeting.type);

  // Serialize communications for the client component
  const serializedComms = comms.map((c) => ({
    id: c.id,
    subject: c.subject,
    body: c.body,
    sentAt: c.sentAt?.toISOString() ?? null,
    stats: c.stats,
  }));

  return (
    <div className="space-y-6">
      <MeetingDetails meeting={meeting} locations={locations} />

      {/*
        VM-020 — the tasks linked to this meeting.

        Titled "Evaluation task", not "Follow-up completion" — ruled 2026-08-12
        on #312 (decision 2, option A). The query counts only
        `related_type = 'meeting'` rows, and the one such task the product
        creates is the evaluation task; the per-attendee follow-ups are linked
        to the PERSON. The old title promised a follow-up metric over a figure
        that can only read "0 of 1" or "1 of 1". The ruling keeps the query
        narrow and shrinks the name to fit it — widening VM-020 at the task
        generator was considered and explicitly NOT ruled in.

        Rendered only when there is a figure. A meeting whose attendance was
        never finalized has no linked task yet, and showing it "0%" would
        report a failure that has not happened; the card is simply absent
        instead. Once finalized with no linked task, the card appears and says
        so in words rather than dividing by zero.
      */}
      {followUp && (
        <div className="mx-auto max-w-3xl">
          <Card data-testid="follow-up-completion">
            <CardHeader>
              <CardTitle className="text-base">
                {MEETING_EVALUATION_TASK_CARD_TITLE}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {followUp.percent === null ? (
                <p className="text-muted-foreground text-sm">
                  No task is linked to this meeting.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-sm font-medium">
                      {followUp.completed} of {followUp.total}{" "}
                      {followUp.total === 1 ? "task" : "tasks"} complete
                    </p>
                    <p className="text-2xl font-bold tabular-nums">
                      {followUp.percent}%
                    </p>
                  </div>
                  <Progress
                    value={followUp.percent}
                    aria-label={`${MEETING_EVALUATION_TASK_CARD_TITLE}: ${followUp.completed} of ${followUp.total} tasks complete`}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <AgendaBuilder
          meetingId={meeting.id}
          sections={parseAgenda(meeting.agenda)}
          defaultSections={
            meeting.type === "vision_meeting"
              ? VISION_MEETING_DEFAULT_AGENDA
              : undefined
          }
          saveAction={saveAgendaAction}
        />
      </div>

      {documentSection && (
        <div className="mx-auto max-w-3xl">
          <ContextualTemplates
            templates={documentSection.templates}
            title={documentSection.title}
            description="Print-ready materials for this meeting — pick a format when you generate."
          />
        </div>
      )}

      {church && (
        <div className="mx-auto max-w-3xl">
          <MeetingCommunicationStatus
            meetingId={meeting.id}
            communications={serializedComms}
            church={{ name: church.name }}
            meeting={{
              title: meeting.title,
              type: meeting.type,
              datetime: meeting.datetime.toISOString(),
              locationName: meeting.locationName,
              locationAddress: meeting.locationAddress,
            }}
          />
        </div>
      )}
    </div>
  );
}
