import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { MeetingList } from "@/components/meetings/meeting-list";
import { Button } from "@/components/ui/button";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";
import { meetingsListSubtitle } from "@/lib/meetings/copy";
import { listMeetings } from "@/lib/meetings/service";
import {
  analyticsMeetingTypeArg,
  parseListMeetingTypeFilter,
} from "@/lib/meetings/meeting-type-filter";

export const dynamic = "force-dynamic";

interface MeetingsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MeetingsPage({
  searchParams,
}: MeetingsPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // AS-020: the header CTA is a write affordance, so a plant Member never sees
  // it. Asked of the same table `requireSeat("meetings.write")` refuses the
  // create action with — this is a server component holding the session, so it
  // reads `holdsSeatFor` directly rather than going through the client context.
  const canWrite = holdsSeatFor(user, "meetings.write");

  const params = await searchParams;
  const view = (
    params.view === "past" ? "past" : params.view === "all" ? "all" : "upcoming"
  ) as "upcoming" | "past" | "all";
  // Parsed, never cast. `?type=` reaches `churchMeetings.type`, the
  // `meeting_type` pg enum, so `?type=all` — the exact value the chip row
  // writes — used to reach Postgres as `type = 'all'` and 500 the route.
  // `MeetingList` derives its highlighted chip from the same parser.
  const typeFilter = analyticsMeetingTypeArg(
    parseListMeetingTypeFilter(params.type)
  );

  // One `now` per render: MeetingList is a client component, so the
  // relative-day badge cannot read the clock itself — that would stamp
  // different instants on SSR and hydration (React #418).
  // memory/invariants.md → Date & Time Rendering.
  const now = new Date();

  const [church, upcomingResult, pastResult] = await Promise.all([
    getCurrentUserChurch(),
    view !== "past"
      ? listMeetings(user.churchId, {
          status: "upcoming",
          type: typeFilter,
          limit: 50,
        })
      : Promise.resolve({ meetings: [], total: 0 }),
    view !== "upcoming"
      ? listMeetings(user.churchId, {
          status: "past",
          type: typeFilter,
          limit: 50,
        })
      : Promise.resolve({ meetings: [], total: 0 }),
  ]);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Meetings" }]} />
      <PageCanvas className="overflow-hidden">
        <WorkspacePanel className="flex h-full flex-col overflow-hidden">
          <div className="space-y-6 border-b p-4 sm:p-6 sm:pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Meetings
                </h1>
                <p className="text-muted-foreground">
                  {meetingsListSubtitle(canWrite)}
                </p>
              </div>
              {canWrite && (
                <Button asChild className="cursor-pointer sm:shrink-0">
                  <Link href="/meetings/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule Meeting
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <MeetingList
              upcomingMeetings={upcomingResult.meetings}
              pastMeetings={pastResult.meetings}
              initialView={view}
              timeZone={church?.timeZone ?? DEFAULT_CHURCH_TIME_ZONE}
              now={now}
            />
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
