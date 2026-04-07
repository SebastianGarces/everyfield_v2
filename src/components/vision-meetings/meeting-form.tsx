"use client";

import {
  createMeetingAction,
  updateMeetingAction,
} from "@/app/(dashboard)/vision-meetings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Location } from "@/db/schema";
import type { VisionMeeting } from "@/db/schema/vision-meetings";
import type { ActionResult } from "@/lib/vision-meetings/types";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { LocationPicker } from "./location-picker";

interface MeetingFormProps {
  meeting?: VisionMeeting;
  locations: Location[];
  mode?: "create" | "edit";
  onSuccess?: () => void;
}

export function MeetingForm({
  meeting,
  locations,
  mode = "create",
  onSuccess,
}: MeetingFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";

  // Pass server actions directly to useActionState.
  // Create action redirects server-side; update action uses bind for meetingId.
  const serverAction =
    isEdit && meeting
      ? updateMeetingAction.bind(null, meeting.id)
      : createMeetingAction;

  const [state, formAction, isPending] = useActionState(serverAction, null);

  // Close the dialog after a successful edit. Create mode is handled
  // server-side via redirect(), so no client-side navigation needed.
  const hasCalledSuccess = useRef(false);
  useEffect(() => {
    if (state?.success && isEdit && !hasCalledSuccess.current) {
      hasCalledSuccess.current = true;
      onSuccess?.();
    }
  }, [state, isEdit, onSuccess]);

  // Format datetime for input
  const defaultDatetime = meeting?.datetime
    ? new Date(meeting.datetime).toISOString().slice(0, 16)
    : "";

  return (
    <form action={formAction} className="min-w-0 space-y-6">
      {state && !state.success && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Date & Time */}
      <div className="space-y-2">
        <Label htmlFor="datetime">Date & Time *</Label>
        <Input
          id="datetime"
          name="datetime"
          type="datetime-local"
          defaultValue={defaultDatetime}
          required
          className="cursor-pointer"
        />
        {state && !state.success && state.fieldErrors?.datetime && (
          <p className="text-destructive text-sm">
            {state.fieldErrors.datetime[0]}
          </p>
        )}
      </div>

      {/* Location Picker */}
      <LocationPicker
        locations={locations}
        defaultLocationId={meeting?.locationId ?? undefined}
        defaultLocationName={meeting?.locationName ?? undefined}
        defaultLocationAddress={meeting?.locationAddress ?? undefined}
      />

      {/* Estimated Attendance */}
      <div className="space-y-2">
        <Label htmlFor="estimatedAttendance">Estimated Attendance</Label>
        <Input
          id="estimatedAttendance"
          name="estimatedAttendance"
          type="number"
          min={0}
          placeholder="e.g., 30"
          defaultValue={meeting?.estimatedAttendance ?? ""}
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          placeholder="Any special instructions or notes..."
          rows={3}
          defaultValue={meeting?.notes ?? ""}
        />
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          className="cursor-pointer"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending} className="cursor-pointer">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "edit" ? "Save Changes" : "Schedule Meeting"}
        </Button>
      </div>
    </form>
  );
}
