import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting, getAttendanceSummary } from "@/lib/meetings/service";
import { getGuestList } from "@/lib/meetings/guest-list";
import { AttendanceCapture } from "@/components/meetings/attendance-capture";

export const dynamic = "force-dynamic";

interface AttendancePageProps {
  params: Promise<{ id: string }>;
}

export default async function AttendancePage({ params }: AttendancePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, guests, summary] = await Promise.all([
    getMeeting(user.churchId, id),
    getGuestList(user.churchId, id),
    getAttendanceSummary(user.churchId, id),
  ]);

  if (!meeting) notFound();

  return (
    <AttendanceCapture
      meetingId={meeting.id}
      guests={guests}
      summary={summary}
    />
  );
}
