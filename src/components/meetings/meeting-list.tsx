"use client";

import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { MeetingCard } from "./meeting-card";
import { Button } from "@/components/ui/button";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import {
  DEFAULT_LIST_MEETING_TYPE,
  MEETING_TYPE_FILTERS,
  type MeetingTypeFilter,
} from "@/lib/meetings/analytics-filter";

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
  const activeType =
    (searchParams.get("type") as MeetingTypeFilter | null) ||
    DEFAULT_LIST_MEETING_TYPE;

  const showUpcoming = view === "upcoming" || view === "all";
  const showPast = view === "past" || view === "all";
  const hasAny = upcomingMeetings.length > 0 || pastMeetings.length > 0;

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (
        value === null ||
        (key === "view" && value === "upcoming") ||
        (key === "type" && value === DEFAULT_LIST_MEETING_TYPE)
      ) {
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
      {/*
        Type filter. The offered filters come from `MEETING_TYPE_FILTERS` —
        the same array the analytics view renders — so the two surfaces cannot
        drift apart in values, labels or order. The DEFAULTS still differ on
        purpose: this browse surface starts on "all", analytics starts on
        vision meetings. See lib/meetings/analytics-filter.ts.
      */}
      <div
        aria-label="Filter meetings by type"
        className="bg-muted flex w-fit gap-1 rounded-lg p-1"
        role="group"
      >
        {MEETING_TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => updateParams({ type: f.value })}
            aria-current={activeType === f.value ? "true" : undefined}
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
      <div className="bg-muted flex w-fit gap-1 rounded-lg p-1">
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
