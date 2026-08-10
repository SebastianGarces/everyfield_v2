import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { verifySession } from "@/lib/auth/session";
import {
  getMeeting,
  parseAgenda,
  setMeetingAgenda,
  VISION_MEETING_DEFAULT_AGENDA,
  type AgendaSection,
} from "@/lib/meetings/service";
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
  const [meeting, locations, comms, churchRows] = await Promise.all([
    getMeeting(user.churchId, id),
    listLocations(user.churchId),
    getMeetingCommunications(user.churchId, id),
    db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1),
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
