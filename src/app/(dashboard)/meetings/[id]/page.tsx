import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { saveAgendaAction } from "../actions";
import { getFollowUpCompletion, getMeeting } from "@/lib/meetings/service";
import {
  defaultAgendaTemplatesForType,
  parseAgenda,
} from "@/lib/meetings/agenda";
import {
  meetingLinkedTaskProgressCopy,
  MEETING_EVALUATION_TASK_CARD_TITLE,
} from "@/lib/meetings/copy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { listLocations } from "@/lib/meetings/locations";
import { getGuestList } from "@/lib/meetings/guest-list";
import { meetingComposeUrl } from "@/lib/communication/meeting-compose";
import { getMeetingCommunications } from "@/lib/communication/service";
import { notFound } from "next/navigation";
import { MeetingDetails } from "./meeting-details-client";
import { ContextualTemplates } from "@/components/documents/contextual-templates";
import { MeetingCommunicationStatus } from "@/components/meetings/meeting-communication-status";
import { AgendaBuilder } from "@/components/meetings/agenda-builder";
import { getMeetingContextualTemplates } from "@/lib/documents/contextual";
import { db } from "@/db";
import { churches } from "@/db/schema/church";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface MeetingPageProps {
  params: Promise<{ id: string }>;
}

export default async function MeetingPage({ params }: MeetingPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [meeting, locations, comms, churchRows, followUp, guests] =
    await Promise.all([
      getMeeting(user.churchId, id),
      listLocations(user.churchId),
      getMeetingCommunications(user.churchId, id),
      db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1),
      // VM-020. `null` until attendance is finalized — see `getFollowUpCompletion`.
      getFollowUpCompletion(user.churchId, id),
      // Read for the Send Email link alone: the card preloads the meeting's
      // guests as recipients, the same way the Invitations tab's own button
      // does (#612).
      getGuestList(user.churchId, id),
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

      {/* VM-020. Ruled 2026-08-12 on #312 (decision 2, option A) — rationale in copy.ts.
          `null` until attendance is finalized, so the card is absent rather than 0%. */}
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
                    {/* The bar's accessible name, not a second copy of it — the
                        `Progress` below points at this id. Sentence in copy.ts. */}
                    <p
                      id="meeting-evaluation-task-progress-label"
                      className="text-sm font-medium"
                    >
                      {meetingLinkedTaskProgressCopy(
                        followUp.completed,
                        followUp.total
                      )}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">
                      {followUp.percent}%
                    </p>
                  </div>
                  <Progress
                    value={followUp.percent}
                    aria-labelledby="meeting-evaluation-task-progress-label"
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
          defaultSections={defaultAgendaTemplatesForType(meeting.type)}
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
            communications={serializedComms}
            church={{ name: church.name }}
            timeZone={church.timeZone}
            meeting={{
              title: meeting.title,
              type: meeting.type,
              datetime: meeting.datetime.toISOString(),
              locationName: meeting.locationName,
              locationAddress: meeting.locationAddress,
              agenda: meeting.agenda,
            }}
            composeUrl={meetingComposeUrl(meeting.id, guests)}
          />
        </div>
      )}
    </div>
  );
}
