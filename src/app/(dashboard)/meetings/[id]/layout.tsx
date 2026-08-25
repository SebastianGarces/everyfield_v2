import { HeaderBreadcrumbs } from "@/components/header";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { getMeeting } from "@/lib/meetings/service";
import { notFound, redirect } from "next/navigation";
import { MeetingHeader } from "@/components/meetings/meeting-header";
import { MeetingTabs } from "@/components/meetings/meeting-tabs";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";
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
  const [meeting, church] = await Promise.all([
    getMeeting(user.churchId, id),
    getCurrentUserChurch(),
  ]);

  if (!meeting) {
    notFound();
  }

  const breadcrumbs = [
    { label: "Meetings", href: "/meetings" },
    { label: meetingDisplayTitle(meeting) },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas contextAttachment="attached" contextItems={breadcrumbs}>
        <WorkspacePanel className="min-h-full">
          <div className="border-b">
            <div className="p-4 pb-0 sm:p-6 sm:pb-0">
              <MeetingHeader
                meeting={meeting}
                timeZone={church?.timeZone ?? DEFAULT_CHURCH_TIME_ZONE}
              />
            </div>
            <div className="px-4 sm:px-6">
              <MeetingTabs
                meetingId={meeting.id}
                meetingType={meeting.type}
                meetingStatus={meeting.status}
              />
            </div>
          </div>
          {/* CSS alone could not make the old sibling header and route body
              share one rounded boundary. This wrapper changes presentation
              only; the route pages still own every read and action. */}
          <div className="p-4 sm:p-6">{children}</div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
