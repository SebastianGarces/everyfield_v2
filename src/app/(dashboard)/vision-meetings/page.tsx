import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { Button } from "@/components/ui/button";
import { MeetingList } from "@/components/vision-meetings/meeting-list";
import { verifySession } from "@/lib/auth/session";
import { listMeetings } from "@/lib/vision-meetings/service";

export const dynamic = "force-dynamic";

interface VisionMeetingsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VisionMeetingsPage({
  searchParams,
}: VisionMeetingsPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const view = (
    params.view === "past" ? "past" : params.view === "all" ? "all" : "upcoming"
  ) as "upcoming" | "past" | "all";

  // Fetch meetings based on view
  const [upcomingResult, pastResult] = await Promise.all([
    view !== "past"
      ? listMeetings(user.churchId, { status: "upcoming", limit: 50 })
      : Promise.resolve({ meetings: [], total: 0 }),
    view !== "upcoming"
      ? listMeetings(user.churchId, { status: "past", limit: 50 })
      : Promise.resolve({ meetings: [], total: 0 }),
  ]);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Vision Meetings" }]} />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Vision Meetings
              </h1>
              <p className="text-foreground/50">
                Schedule, track, and analyze your Vision Meetings
              </p>
            </div>
            <Button asChild className="cursor-pointer">
              <Link href="/vision-meetings/new">
                <Plus className="mr-2 h-4 w-4" />
                Schedule Meeting
              </Link>
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <MeetingList
            upcomingMeetings={upcomingResult.meetings}
            pastMeetings={pastResult.meetings}
            initialView={view}
          />
        </div>
      </div>
    </>
  );
}
