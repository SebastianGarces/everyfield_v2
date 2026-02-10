import { AttendanceCapture } from "@/components/vision-meetings/attendance-capture";
import { verifySession } from "@/lib/auth/session";
import { listPeople } from "@/lib/people/service";
import {
  getAttendanceSummary,
  getMeeting,
  listAttendees,
} from "@/lib/vision-meetings/service";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface AttendancePageProps {
  params: Promise<{ id: string }>;
}

export default async function AttendancePage({ params }: AttendancePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, attendees, summary, peopleResult] = await Promise.all([
    getMeeting(user.churchId, id),
    listAttendees(user.churchId, id),
    getAttendanceSummary(user.churchId, id),
    listPeople(user.churchId, { limit: 100 }),
  ]);

  if (!meeting) notFound();

  return (
    <AttendanceCapture
      meeting={meeting}
      attendees={attendees}
      summary={summary}
      availablePeople={peopleResult.people}
    />
  );
}
