"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocationPicker } from "./location-picker";
import { createMeetingAction, updateMeetingAction } from "@/app/(dashboard)/meetings/actions";
import type { ChurchMeeting, Location, MeetingType, MeetingSubtype } from "@/db/schema";
import type { MinistryTeam } from "@/db/schema";
import type { ActionResult } from "@/lib/meetings/types";

interface MeetingFormProps {
  meeting?: ChurchMeeting;
  locations: Location[];
  teams?: MinistryTeam[];
  mode?: "create" | "edit";
  defaultType?: MeetingType;
  defaultTeamId?: string;
}

const meetingTypeOptions: { value: MeetingType; label: string }[] = [
  { value: "vision_meeting", label: "Vision Meeting" },
  { value: "orientation", label: "Orientation" },
  { value: "team_meeting", label: "Team Meeting" },
];

const subtypeOptions: { value: MeetingSubtype; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "training", label: "Training" },
  { value: "planning", label: "Planning" },
  { value: "special", label: "Special" },
  { value: "rehearsal", label: "Rehearsal" },
];

export function MeetingForm({
  meeting,
  locations,
  teams = [],
  mode = "create",
  defaultType,
  defaultTeamId,
}: MeetingFormProps) {
  const router = useRouter();
  const [selectedLocationId, setSelectedLocationId] = useState<string | undefined>(
    meeting?.locationId ?? undefined
  );
  const [meetingType, setMeetingType] = useState<MeetingType>(
    meeting?.type ?? defaultType ?? "vision_meeting"
  );
  const [teamId, setTeamId] = useState<string>(
    meeting?.teamId ?? defaultTeamId ?? ""
  );
  const [subtype, setSubtype] = useState<string>(
    meeting?.meetingSubtype ?? "regular"
  );

  const action = async (
    _prevState: ActionResult<ChurchMeeting> | null,
    formData: FormData
  ) => {
    // Inject values that come from state
    formData.set("type", meetingType);
    if (meetingType === "team_meeting" && teamId) {
      formData.set("teamId", teamId);
      formData.set("meetingSubtype", subtype);
    }
    if (selectedLocationId) {
      formData.set("locationId", selectedLocationId);
    }

    if (mode === "edit" && meeting) {
      return updateMeetingAction(meeting.id, formData);
    }
    return createMeetingAction(formData);
  };

  const [state, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (state?.success) {
      if (mode === "create" && state.data) {
        router.push(`/meetings/${state.data.id}`);
      } else if (mode === "edit" && meeting) {
        router.push(`/meetings/${meeting.id}`);
      }
    }
  }, [state, router, mode, meeting]);

  const defaultDatetime = meeting?.datetime
    ? new Date(meeting.datetime).toISOString().slice(0, 16)
    : "";

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.success && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Meeting Type (only in create mode) */}
      {mode === "create" && (
        <div className="space-y-2">
          <Label>Meeting Type *</Label>
          <Select value={meetingType} onValueChange={(v) => setMeetingType(v as MeetingType)}>
            <SelectTrigger className="cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meetingTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="cursor-pointer">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Team selector (team meetings only) */}
      {meetingType === "team_meeting" && (
        <>
          <div className="space-y-2">
            <Label>Team *</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id} className="cursor-pointer">
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Meeting Subtype</Label>
            <Select value={subtype} onValueChange={setSubtype}>
              <SelectTrigger className="cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subtypeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="cursor-pointer">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Title (for non-vision meetings) */}
      {meetingType !== "vision_meeting" && (
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            placeholder="e.g., Weekly Planning Meeting"
            defaultValue={meeting?.title ?? ""}
          />
        </div>
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
          <p className="text-destructive text-sm">{state.fieldErrors.datetime[0]}</p>
        )}
      </div>

      {/* Location Picker */}
      <LocationPicker
        locations={locations}
        selectedLocationId={selectedLocationId}
        onLocationChange={setSelectedLocationId}
        defaultLocationName={meeting?.locationName ?? undefined}
        defaultLocationAddress={meeting?.locationAddress ?? undefined}
      />

      {/* Duration (team meetings and orientations) */}
      {meetingType !== "vision_meeting" && (
        <div className="space-y-2">
          <Label htmlFor="durationMinutes">Duration (minutes)</Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={1}
            max={1440}
            placeholder="e.g., 60"
            defaultValue={meeting?.durationMinutes ?? ""}
          />
        </div>
      )}

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
