import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/meetings/service";
import { getGuestList } from "@/lib/meetings/guest-list";
import { getMeetingTrackingByPerson } from "@/lib/communication/service";
import { GuestList } from "@/components/meetings/guest-list";

export const dynamic = "force-dynamic";

interface GuestListPageProps {
  params: Promise<{ id: string }>;
}

export default async function GuestListPage({ params }: GuestListPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, guests, emailTracking] = await Promise.all([
    getMeeting(user.churchId, id),
    getGuestList(user.churchId, id),
    getMeetingTrackingByPerson(id),
  ]);

  if (!meeting) notFound();

  // Convert Map to a serializable object for the client component
  const emailTrackingData: Record<
    string,
    { status: string; deliveredAt: string | null; openedAt: string | null }
  > = {};
  for (const [personId, data] of emailTracking) {
    emailTrackingData[personId] = {
      status: data.status,
      deliveredAt: data.deliveredAt?.toISOString() ?? null,
      openedAt: data.openedAt?.toISOString() ?? null,
    };
  }

  return (
    <GuestList
      meetingId={meeting.id}
      guests={guests}
      emailTracking={emailTrackingData}
    />
  );
}
