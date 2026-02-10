import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/meetings/service";
import { listLocations } from "@/lib/meetings/locations";
import { getMeetingCommunications } from "@/lib/communication/service";
import { notFound } from "next/navigation";
import { MeetingDetails } from "./meeting-details-client";
import { MeetingCommunicationStatus } from "@/components/meetings/meeting-communication-status";
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
