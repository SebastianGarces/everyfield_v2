"use client";

import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { MeetingCard } from "./meeting-card";
import { Button } from "@/components/ui/button";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { MeetingType } from "@/db/schema";

interface MeetingListProps {
  upcomingMeetings: MeetingWithCounts[];
  pastMeetings: MeetingWithCounts[];
  initialView: "upcoming" | "past" | "all";
  initialTypeFilter?: MeetingType;
}

const typeFilters: { value: MeetingType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "vision_meeting", label: "Vision Meetings" },
  { value: "orientation", label: "Orientations" },
  { value: "team_meeting", label: "Team Meetings" },
];

export function MeetingList({
  upcomingMeetings,
  pastMeetings,
  initialView,
  initialTypeFilter,
}: MeetingListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = (searchParams.get("view") as "upcoming" | "past" | "all") || initialView;
  const activeType = (searchParams.get("type") as MeetingType | null) || "all";

  const showUpcoming = view === "upcoming" || view === "all";
  const showPast = view === "past" || view === "all";
  const hasAny = upcomingMeetings.length > 0 || pastMeetings.length > 0;

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || (key === "view" && value === "upcoming") || (key === "type" && value === "all")) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.push(query ? `/meetings?${query}` : "/meetings");
  }

  return (
    <div className="space-y-6">
      {/* Type Filter */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {typeFilters.map((f) => (
          <button
            key={f.value}
            onClick={() => updateParams({ type: f.value })}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activeType === f.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* View Toggle */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["upcoming", "past", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => updateParams({ view: v })}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              view === v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {!hasAny ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
          <CalendarCheck className="text-muted-foreground/50 h-12 w-12" />
          <h3 className="mt-4 font-semibold">No meetings yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Schedule your first meeting to start tracking attendance and growth.
          </p>
          <Button asChild className="mt-4 cursor-pointer">
            <Link href="/meetings/new">Schedule Meeting</Link>
          </Button>
        </div>
      ) : (
        <>
          {showUpcoming && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground/80">
                Upcoming ({upcomingMeetings.length})
              </h2>
              {upcomingMeetings.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">No upcoming meetings scheduled.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {upcomingMeetings.map((meeting) => (
                    <MeetingCard key={meeting.id} meeting={meeting} />
                  ))}
                </div>
              )}
            </div>
          )}
          {showPast && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground/80">
                Past ({pastMeetings.length})
              </h2>
              {pastMeetings.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">No past meetings recorded.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {pastMeetings.map((meeting) => (
                    <MeetingCard key={meeting.id} meeting={meeting} isPast />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
