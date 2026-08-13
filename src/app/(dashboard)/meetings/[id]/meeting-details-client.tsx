"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteMeetingAction,
  updateMeetingStatusAction,
} from "@/app/(dashboard)/meetings/actions";
import { MeetingForm } from "@/components/meetings/meeting-form";
import { MeetingSummaryCards } from "./meeting-summary-cards";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { Location, MeetingStatus } from "@/db/schema";

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

function getMeetingTitle(meeting: MeetingWithCounts): string {
  if (meeting.type === "vision_meeting" && meeting.meetingNumber) {
    return `Vision Meeting #${meeting.meetingNumber}`;
  }
  return meeting.title || "Meeting";
}

export function MeetingDetails({ meeting, locations }: MeetingDetailsProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const status = meeting.status as MeetingStatus;
  const transition = statusTransitions[status];

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteMeetingAction(meeting.id);
    if (result.success) {
      router.push("/meetings");
    }
    setIsDeleting(false);
  };

  const handleStatusTransition = async () => {
    if (!transition) return;
    setIsTransitioning(true);
    await updateMeetingStatusAction(meeting.id, transition.next);
    setIsTransitioning(false);
  };

  const title = getMeetingTitle(meeting);

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
                <DialogTitle>Edit {title}</DialogTitle>
              </DialogHeader>
              <MeetingForm
                meeting={meeting}
                locations={locations}
                mode="edit"
                onSuccess={() => setIsEditOpen(false)}
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
                <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
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
                  variant="destructive"
                  className="cursor-pointer"
                >
                  {isDeleting ? "Deleting..." : "Delete Meeting"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Meeting Info Cards */}
      <MeetingSummaryCards meeting={meeting} />
    </div>
  );
}
