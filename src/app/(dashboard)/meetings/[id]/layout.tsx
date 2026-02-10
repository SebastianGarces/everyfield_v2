import { HeaderBreadcrumbs } from "@/components/header";
import { verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/meetings/service";
import { notFound, redirect } from "next/navigation";
import { MeetingHeader } from "@/components/meetings/meeting-header";
import { MeetingTabs } from "@/components/meetings/meeting-tabs";

interface MeetingLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

const meetingTypeLabels = {
  vision_meeting: "Vision Meeting",
  orientation: "Orientation",
  team_meeting: "Team Meeting",
} as const;

export default async function MeetingLayout({ children, params }: MeetingLayoutProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const meeting = await getMeeting(user.churchId, id);

  if (!meeting) {
    notFound();
  }

  const meetingLabel = meeting.type === "vision_meeting" && meeting.meetingNumber
    ? `Vision Meeting #${meeting.meetingNumber}`
    : meeting.title || meetingTypeLabels[meeting.type];

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: meetingLabel },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card shadow-sm">
          <div className="p-6 pb-0">
            <MeetingHeader meeting={meeting} />
          </div>
          <div className="px-6">
            <MeetingTabs meetingId={meeting.id} meetingType={meeting.type} meetingStatus={meeting.status} />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </div>
    </>
  );
}
