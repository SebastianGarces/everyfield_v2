import { HeaderBreadcrumbs } from "@/components/header";
import { verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/meetings/service";
import { notFound, redirect } from "next/navigation";
import { MeetingHeader } from "@/components/meetings/meeting-header";
import { MeetingTabs } from "@/components/meetings/meeting-tabs";
// The breadcrumb names the meeting the same way the header directly under it
// does — one derivation, not two. See src/lib/meetings/labels.ts.
import { meetingDisplayTitle } from "@/lib/meetings/labels";

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
          { label: "Meetings", href: "/meetings" },
          { label: meetingDisplayTitle(meeting) },
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
              meetingType={meeting.type}
              meetingStatus={meeting.status}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </>
  );
}
