"use client";

import {
  addAttendeeAction,
  finalizeAttendanceAction,
  removeAttendeeAction,
} from "@/app/(dashboard)/vision-meetings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AttendanceType, Person } from "@/db/schema";
import type {
  AttendanceSummary,
  AttendanceWithPerson,
  MeetingWithCounts,
} from "@/lib/vision-meetings/types";
import { CheckCircle, Search, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AttendeeQuickAdd } from "./attendee-quick-add";
import { AttendeeRow } from "./attendee-row";

interface AttendanceCaptureProps {
  meeting: MeetingWithCounts;
  attendees: AttendanceWithPerson[];
  summary: AttendanceSummary;
  availablePeople: Person[];
}

export function AttendanceCapture({
  meeting,
  attendees,
  summary,
  availablePeople,
}: AttendanceCaptureProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Filter out people who are already attending
  const attendeePersonIds = new Set(attendees.map((a) => a.personId));
  const filteredPeople = availablePeople
    .filter((p) => !attendeePersonIds.has(p.id))
    .filter(
      (p) =>
        !search ||
        `${p.firstName} ${p.lastName}`
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        p.email?.toLowerCase().includes(search.toLowerCase())
    );

  const handleAddExisting = (
    personId: string,
    attendanceType: AttendanceType
  ) => {
    const formData = new FormData();
    formData.set("personId", personId);
    formData.set("attendanceType", attendanceType);
    startTransition(async () => {
      await addAttendeeAction(meeting.id, formData);
      router.refresh();
    });
  };

  const handleRemove = (personId: string) => {
    startTransition(async () => {
      await removeAttendeeAction(meeting.id, personId);
      router.refresh();
    });
  };

  const handleFinalize = () => {
    startTransition(async () => {
      await finalizeAttendanceAction(meeting.id);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold">{summary.total}</p>
            <p className="text-muted-foreground text-sm">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-green-600">
              {summary.firstTime}
            </p>
            <p className="text-muted-foreground text-sm">First Time</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {summary.returning}
            </p>
            <p className="text-muted-foreground text-sm">Returning</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-purple-600">
              {summary.coreGroup}
            </p>
            <p className="text-muted-foreground text-sm">Core Group</p>
          </CardContent>
        </Card>
      </div>

      {/* Add Attendee Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Add Attendee</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQuickAdd(!showQuickAdd)}
              className="cursor-pointer"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Quick Add New Person
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showQuickAdd && (
            <AttendeeQuickAdd
              meetingId={meeting.id}
              onClose={() => setShowQuickAdd(false)}
            />
          )}

          {/* Search Existing People */}
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search existing contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {search && filteredPeople.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {filteredPeople.slice(0, 10).map((person) => (
                <div
                  key={person.id}
                  className="flex items-center justify-between border-b px-4 py-2 last:border-0"
                >
                  <span className="text-sm">
                    {person.firstName} {person.lastName}
                    {person.email && (
                      <span className="text-muted-foreground ml-2">
                        {person.email}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-1">
                    {(["first_time", "returning", "core_group"] as const).map(
                      (type) => (
                        <Button
                          key={type}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddExisting(person.id, type)}
                          disabled={isPending}
                          className="cursor-pointer text-xs"
                        >
                          {type === "first_time"
                            ? "New"
                            : type === "returning"
                              ? "Return"
                              : "Core"}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Attendees */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Attendees ({attendees.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attendees.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No attendees recorded yet. Use the search or quick add above to
              add attendees.
            </p>
          ) : (
            <div className="divide-y">
              {attendees.map((attendee) => (
                <AttendeeRow
                  key={attendee.id}
                  attendee={attendee}
                  onRemove={() => handleRemove(attendee.personId)}
                  disabled={isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Finalize Button */}
      {attendees.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={handleFinalize}
            disabled={isPending}
            size="lg"
            className="cursor-pointer"
          >
            <CheckCircle className="mr-2 h-5 w-5" />
            Finalize Attendance ({attendees.length})
          </Button>
        </div>
      )}
    </div>
  );
}
