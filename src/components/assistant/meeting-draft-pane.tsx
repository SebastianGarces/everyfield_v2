"use client";

import type { ReactNode } from "react";
import { ExternalLink, Loader2, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getMeetingDraftArtifactPayload,
  getMeetingDraftTitle,
  getMeetingSubtypeLabel,
  getMeetingTypeLabel,
  type MeetingDraftArtifactPayload,
} from "@/lib/assistant/meeting-draft";
import type { AssistantArtifactRecord } from "@/lib/assistant/types";

function renderValue(
  value: string | number | null | undefined,
  emptyLabel = "Not set"
) {
  if (value == null || value === "") {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }

  return <span>{value}</span>;
}

function MeetingDraftRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
        {label}
      </p>
      <div className="text-sm leading-6">{value}</div>
    </div>
  );
}

function MissingFieldBadge({ field }: { field: string }) {
  const labels: Record<string, string> = {
    meetingType: "Meeting type",
    datetime: "Date & time",
    location: "Location",
    team: "Team",
  };

  return (
    <Badge variant="secondary" className="rounded-full">
      {labels[field] ?? field}
    </Badge>
  );
}

function renderMeetingStatusBadge(payload: MeetingDraftArtifactPayload) {
  if (payload.status === "created") {
    return (
      <Badge variant="secondary" className="rounded-full">
        Meeting created
      </Badge>
    );
  }

  if (payload.status === "ready") {
    return (
      <Badge
        variant="secondary"
        className="rounded-full bg-emerald-100 text-emerald-800"
      >
        Ready to create
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="rounded-full">
      Draft in progress
    </Badge>
  );
}

export function AssistantMeetingDraftPane({
  artifacts,
  isCreatingMeeting,
  onCreateMeeting,
}: {
  artifacts: AssistantArtifactRecord[];
  isCreatingMeeting: boolean;
  onCreateMeeting: () => void;
}) {
  const payload = getMeetingDraftArtifactPayload(artifacts);

  if (!payload) {
    return null;
  }

  const displayDateTime =
    payload.interpretation?.datetimeLabel ?? payload.interpretation?.dateLabel;
  const displayLocation = payload.interpretation?.locationLabel;
  const displayTeam = payload.interpretation?.teamLabel;
  const canCreate = payload.status === "ready" && !payload.createdMeetingId;

  return (
    <div className="sticky top-6 rounded-[28px] border bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Badge variant="outline" className="rounded-full">
            Meeting draft
          </Badge>
          <div className="space-y-1">
            <p className="text-lg font-semibold tracking-tight">
              {getMeetingDraftTitle(payload.draft)}
            </p>
            <p className="text-muted-foreground text-sm">
              {getMeetingTypeLabel(payload.draft.type)}
            </p>
          </div>
        </div>

        {renderMeetingStatusBadge(payload)}
      </div>

      <Separator className="my-5" />

      <div className="space-y-5">
        <MeetingDraftRow
          label="Date & Time"
          value={renderValue(displayDateTime)}
        />

        <MeetingDraftRow
          label="Location"
          value={
            <div className="flex items-start gap-2">
              <MapPin className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
              <div>{renderValue(displayLocation)}</div>
            </div>
          }
        />

        {payload.draft.type === "team_meeting" ? (
          <>
            <MeetingDraftRow
              label="Team"
              value={
                <div className="flex items-start gap-2">
                  <Users className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
                  <div>{renderValue(displayTeam)}</div>
                </div>
              }
            />

            <MeetingDraftRow
              label="Subtype"
              value={renderValue(
                getMeetingSubtypeLabel(payload.draft.meetingSubtype)
              )}
            />
          </>
        ) : null}

        {payload.draft.durationMinutes != null ? (
          <MeetingDraftRow
            label="Duration"
            value={`${payload.draft.durationMinutes} minutes`}
          />
        ) : null}

        <MeetingDraftRow
          label="Estimated Attendance"
          value={renderValue(payload.draft.estimatedAttendance)}
        />

        <MeetingDraftRow
          label="Notes"
          value={
            payload.draft.notes ? (
              <p className="whitespace-pre-wrap">{payload.draft.notes}</p>
            ) : (
              renderValue(null)
            )
          }
        />
      </div>

      <Separator className="my-5" />

      {payload.missingFields.length > 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
            Still needed
          </p>
          <div className="flex flex-wrap gap-2">
            {payload.missingFields.map((field) => (
              <MissingFieldBadge key={field} field={field} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {payload.createdMeetingHref ? (
          <Button asChild className="cursor-pointer rounded-full">
            <a
              href={payload.createdMeetingHref}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              Open meeting
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onCreateMeeting}
            disabled={!canCreate || isCreatingMeeting}
            className="cursor-pointer rounded-full"
          >
            {isCreatingMeeting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create meeting"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
