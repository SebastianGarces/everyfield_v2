import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting, getAttendanceSummary } from "@/lib/meetings/service";
import { listMeetingResponses } from "@/lib/meetings/response-queries";
import { getGuestList } from "@/lib/meetings/guest-list";
import { AttendanceCapture } from "@/components/meetings/attendance-capture";
import type { ResponseCardType } from "@/db/schema/meetings";

export const dynamic = "force-dynamic";

interface AttendancePageProps {
  params: Promise<{ id: string }>;
}

export default async function AttendancePage({ params }: AttendancePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, guests, summary, responses] = await Promise.all([
    getMeeting(user.churchId, id),
    getGuestList(user.churchId, id),
    getAttendanceSummary(user.churchId, id),
    // VM-014. Read unconditionally rather than behind the meeting's type: the
    // type is only known after `getMeeting` resolves, and a fourth query in the
    // same round trip costs less than a second round trip. A non-vision meeting
    // has no rows, so this is an empty list rather than a wasted join.
    listMeetingResponses(user.churchId, id),
  ]);

  if (!meeting) notFound();

  const responseCards: Record<string, ResponseCardType> = {};
  for (const response of responses) {
    responseCards[response.personId] = response.responseType;
  }

  return (
    <AttendanceCapture
      meetingId={meeting.id}
      guests={guests}
      summary={summary}
      showResponseCards={meeting.type === "vision_meeting"}
      responseCards={responseCards}
    />
  );
}
