import { redirect } from "next/navigation";
import { HeaderBreadcrumbs } from "@/components/header";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { verifySession } from "@/lib/auth/session";
import { listLocations } from "@/lib/meetings/locations";
import { listTeams } from "@/lib/ministry-teams/service";
import type { MeetingType } from "@/db/schema";

interface NewMeetingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NewMeetingPage({ searchParams }: NewMeetingPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const defaultType = (params.type as MeetingType) || undefined;
  const defaultTeamId = params.teamId as string | undefined;

  const [locations, teams] = await Promise.all([
    listLocations(user.churchId),
    listTeams(user.churchId),
  ]);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Meetings", href: "/meetings" },
          { label: "Schedule Meeting" },
        ]}
      />
      <div className="mx-auto max-w-2xl p-6">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
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
        </div>
      </div>
    </>
  );
}
