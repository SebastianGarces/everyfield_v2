"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addAttendeeNoteAction } from "@/app/(dashboard)/meetings/actions";
import { useCan } from "@/components/shared/viewer-capabilities";
import { toast } from "sonner";
import { CheckCircle2, MessageSquarePlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface AttendeeForNotes {
  personId: string;
  firstName: string;
  lastName: string;
}

interface AttendeeNotesProps {
  meetingId: string;
  meetingType: string;
  attendees: AttendeeForNotes[];
}

// ============================================================================
// Single Attendee Row
// ============================================================================

function AttendeeNoteRow({
  attendee,
  meetingId,
  meetingType,
}: {
  attendee: AttendeeForNotes;
  meetingId: string;
  meetingType: string;
}) {
  const [showInput, setShowInput] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  // AS-020 (#499): the note is `addAttendeeNoteAction` — `meetings.write`.
  //
  // GATED ON THE TRIGGER ALONE, and that is sufficient rather than lazy: the
  // textarea below is revealed by `showInput`, which nothing but this button
  // sets, so a viewer who never gets the button can never reach the form. The
  // attendee's NAME is a read and stays — this tab is how a Member sees who
  // came.
  const canWrite = useCan("meetings.write");

  const handleSave = () => {
    if (!note.trim()) return;

    startTransition(async () => {
      const result = await addAttendeeNoteAction(
        attendee.personId,
        meetingId,
        meetingType,
        note.trim()
      );

      if (result.success) {
        toast.success(`Note saved for ${attendee.firstName}`);
        setSaved(true);
        setShowInput(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div
      className={cn(
        "bg-background flex flex-col gap-2 rounded-lg border p-3",
        saved &&
          "border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {attendee.firstName} {attendee.lastName}
        </span>
        {saved ? (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Saved
          </span>
        ) : !showInput && canWrite ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowInput(true)}
            className="h-7 cursor-pointer gap-1 text-xs"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Add Note
          </Button>
        ) : null}
      </div>

      {showInput && !saved && (
        <div className="space-y-2">
          <Textarea
            placeholder={`Notes about ${attendee.firstName}...`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-sm"
            disabled={isPending}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowInput(false);
                setNote("");
              }}
              disabled={isPending}
              className="h-7 cursor-pointer text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending || !note.trim()}
              className="h-7 cursor-pointer text-xs"
            >
              {isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Save Note
            </Button>
          </div>
        </div>
      )}

      {saved && note && (
        <p className="text-muted-foreground text-xs italic">
          &ldquo;{note}&rdquo;
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AttendeeNotes({
  meetingId,
  meetingType,
  attendees,
}: AttendeeNotesProps) {
  if (attendees.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Attendee Notes</h3>
        <p className="text-muted-foreground text-sm">
          Add individual notes for attendees. These will be saved to each
          person&apos;s activity timeline and linked to this meeting.
        </p>
      </div>
      <div className="space-y-2">
        {attendees.map((attendee) => (
          <AttendeeNoteRow
            key={attendee.personId}
            attendee={attendee}
            meetingId={meetingId}
            meetingType={meetingType}
          />
        ))}
      </div>
    </div>
  );
}
