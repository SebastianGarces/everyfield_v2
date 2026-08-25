import { redirect } from "next/navigation";
import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { listLocations } from "@/lib/meetings/locations";
import { listTeams } from "@/lib/ministry-teams/service";
// A `?type=` is untrusted input and is PARSED, never cast: `searchParams`
// hands back `string | string[] | undefined`, and a cast put an array or a
// non-member string into the form's `useState<MeetingType>`.
// memory/invariants.md → Meetings.
import { parseMeetingType } from "@/lib/meetings/labels";

interface NewMeetingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const BREADCRUMBS = [
  { label: "Meetings", href: "/meetings" },
  { label: "Schedule Meeting" },
];

export default async function NewMeetingPage({
  searchParams,
}: NewMeetingPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // AS-020, and the route half of it: this page exists only to CREATE a
  // meeting, so hiding the button that links here is not enough — a Member who
  // types the URL would otherwise fill a form that `requireSeat` refuses at
  // submit. Same verb, same table, refused one screen earlier.
  if (!holdsSeatFor(user, "meetings.write")) {
    redirect("/meetings");
  }

  const params = await searchParams;
  const defaultType = parseMeetingType(params.type);
  // Narrowed rather than cast, for the repeated-param half of the same reason:
  // `?teamId=a&teamId=b` is an array, and the form would have put it in a
  // `<Select>` value.
  const defaultTeamId =
    typeof params.teamId === "string" ? params.teamId : undefined;

  const [locations, teams] = await Promise.all([
    listLocations(user.churchId),
    listTeams(user.churchId),
  ]);

  return (
    <>
      <HeaderBreadcrumbs items={BREADCRUMBS} />
      <PageCanvas
        frameClassName="mx-auto w-full max-w-2xl"
        contextAttachment="attached"
        contextItems={BREADCRUMBS}
      >
        <WorkspacePanel className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Schedule Meeting
            </h1>
            <p className="text-muted-foreground mt-1">
              Set a date, time, and location for your next meeting.
            </p>
          </div>
          <MeetingForm
            locations={locations}
            teams={teams}
            defaultType={defaultType}
            defaultTeamId={defaultTeamId}
          />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
