import { verifySession } from "@/lib/auth/session";
import { listLocations } from "@/lib/vision-meetings/locations";
import { getMeeting } from "@/lib/vision-meetings/service";
import { notFound, redirect } from "next/navigation";
import { MeetingDetails } from "./meeting-details-client";

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
  const [meeting, locations] = await Promise.all([
    getMeeting(user.churchId, id),
    listLocations(user.churchId),
  ]);

  if (!meeting) {
    notFound();
  }

  return <MeetingDetails meeting={meeting} locations={locations} />;
}
