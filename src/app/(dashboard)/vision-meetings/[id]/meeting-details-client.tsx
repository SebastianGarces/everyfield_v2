"use client";

import {
  deleteMeetingAction,
  updateMeetingStatusAction,
} from "@/app/(dashboard)/vision-meetings/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MeetingForm } from "@/components/vision-meetings/meeting-form";
import type { Location, MeetingStatus } from "@/db/schema";
import type { MeetingWithCounts } from "@/lib/vision-meetings/types";
import {
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface MeetingDetailsProps {
  meeting: MeetingWithCounts;
  locations: Location[];
}

const statusTransitions: Record<
  MeetingStatus,
  { next: MeetingStatus; label: string } | null
> = {
  planning: { next: "ready", label: "Mark as Ready" },
  ready: { next: "in_progress", label: "Start Meeting" },
  in_progress: { next: "completed", label: "Mark Completed" },
  completed: null,
  cancelled: null,
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

export function MeetingDetails({ meeting, locations }: MeetingDetailsProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const status = meeting.status as MeetingStatus;
  const transition = statusTransitions[status];
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "Not set";
  const addressDisplay =
    meeting.locationAddress || meeting.location?.address || "";

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteMeetingAction(meeting.id);
    if (result.success) {
      router.push("/vision-meetings");
    }
    setIsDeleting(false);
  };

  const handleStatusTransition = async () => {
    if (!transition) return;
    setIsTransitioning(true);
    await updateMeetingStatusAction(meeting.id, transition.next);
    router.refresh();
    setIsTransitioning(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {transition && status !== "cancelled" && (
            <Button
              onClick={handleStatusTransition}
              disabled={isTransitioning}
              className="cursor-pointer"
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              {transition.label}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Edit Vision Meeting #{meeting.meetingNumber}
                </DialogTitle>
              </DialogHeader>
              <MeetingForm
                meeting={meeting}
                locations={locations}
                mode="edit"
              />
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive cursor-pointer"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete Vision Meeting #{meeting.meetingNumber}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this meeting and all associated
                  attendance records, evaluations, and checklist items. This
                  action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
                >
                  {isDeleting ? "Deleting..." : "Delete Meeting"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Meeting Info Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Date & Time</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="text-muted-foreground h-4 w-4" />
              <span>{formatDate(meeting.datetime)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="text-muted-foreground h-4 w-4" />
              <span>{formatTime(meeting.datetime)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="text-muted-foreground h-4 w-4" />
              <span>{locationDisplay}</span>
            </div>
            {addressDisplay && (
              <p className="text-muted-foreground pl-6 text-sm">
                {addressDisplay}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Users className="text-muted-foreground h-4 w-4" />
              {meeting.actualAttendance != null ? (
                <span>
                  <span className="font-medium">
                    {meeting.actualAttendance}
                  </span>{" "}
                  actual
                  {meeting.estimatedAttendance && (
                    <span className="text-muted-foreground">
                      {" "}
                      / {meeting.estimatedAttendance} estimated
                    </span>
                  )}
                </span>
              ) : (
                <span>
                  {meeting.estimatedAttendance ? (
                    <>
                      <span className="font-medium">
                        ~{meeting.estimatedAttendance}
                      </span>{" "}
                      estimated
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No estimate set
                    </span>
                  )}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {meeting.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{meeting.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
