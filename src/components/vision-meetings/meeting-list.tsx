"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MeetingWithCounts } from "@/lib/vision-meetings/types";
import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MeetingCard } from "./meeting-card";

interface MeetingListProps {
  upcomingMeetings: MeetingWithCounts[];
  pastMeetings: MeetingWithCounts[];
  initialView: "upcoming" | "past" | "all";
}

export function MeetingList({
  upcomingMeetings,
  pastMeetings,
  initialView,
}: MeetingListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view =
    (searchParams.get("view") as "upcoming" | "past" | "all") || initialView;

  const showUpcoming = view === "upcoming" || view === "all";
  const showPast = view === "past" || view === "all";
  const hasAny = upcomingMeetings.length > 0 || pastMeetings.length > 0;

  function handleViewChange(newView: "upcoming" | "past" | "all") {
    const params = new URLSearchParams(searchParams.toString());
    if (newView === "upcoming") {
      params.delete("view");
    } else {
      params.set("view", newView);
    }
    const query = params.toString();
    router.push(query ? `/vision-meetings?${query}` : "/vision-meetings");
  }

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="bg-muted flex w-fit gap-1 rounded-lg p-1">
        {(["upcoming", "past", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => handleViewChange(v)}
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
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
          <CalendarCheck className="text-muted-foreground/50 h-12 w-12" />
          <h3 className="mt-4 font-semibold">No Vision Meetings yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Schedule your first Vision Meeting to start tracking attendance and
            growth.
          </p>
          <Button asChild className="mt-4 cursor-pointer">
            <Link href="/vision-meetings/new">Schedule Meeting</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Upcoming section */}
          {showUpcoming && (
            <div className="space-y-4">
              <h2 className="text-foreground/80 text-lg font-semibold">
                Upcoming ({upcomingMeetings.length})
              </h2>
              {upcomingMeetings.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">
                  No upcoming meetings scheduled.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {upcomingMeetings.map((meeting) => (
                    <MeetingCard key={meeting.id} meeting={meeting} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Past section */}
          {showPast && (
            <div className="space-y-4">
              <h2 className="text-foreground/80 text-lg font-semibold">
                Past ({pastMeetings.length})
              </h2>
              {pastMeetings.length === 0 ? (
                <p className="text-muted-foreground py-4 text-sm">
                  No past meetings recorded.
                </p>
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
