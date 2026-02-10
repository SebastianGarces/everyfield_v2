import { HeaderBreadcrumbs } from "@/components/header";
import { MeetingHeader } from "@/components/vision-meetings/meeting-header";
import { MeetingTabs } from "@/components/vision-meetings/meeting-tabs";
import { verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/vision-meetings/service";
import { notFound, redirect } from "next/navigation";

interface MeetingLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function MeetingLayout({
  children,
  params,
}: MeetingLayoutProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const meeting = await getMeeting(user.churchId, id);

  if (!meeting) {
    notFound();
  }

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Vision Meetings", href: "/vision-meetings" },
          { label: `Meeting #${meeting.meetingNumber}` },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card shadow-sm">
          <div className="p-6 pb-0">
            <MeetingHeader meeting={meeting} />
          </div>
          <div className="px-6">
            <MeetingTabs
              meetingId={meeting.id}
              meetingStatus={meeting.status}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </>
  );
}
