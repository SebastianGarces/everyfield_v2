"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatRelativeTimestamp } from "@/lib/datetime";
import {
  type ActivityWithPerformer,
  formatActivityMessage,
  isStatusChangeBackward,
} from "@/lib/people/activity.shared";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ClipboardCheck,
  FileCheck,
  Pencil,
  Star,
  StickyNote,
  Tag,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useState } from "react";

interface ActivityItemProps {
  activity: ActivityWithPerformer;
  /**
   * The one instant the whole feed is rendered against, threaded down from the
   * server component — never a clock read here, which would make SSR and
   * hydration disagree (memory/invariants.md → Date & Time Rendering).
   */
  now: Date;
  onDelete?: (activityId: string) => void;
  canDelete?: boolean;
  onEdit?: (activityId: string, note: string) => void;
  canEdit?: boolean;
}

export function ActivityItem({
  activity,
  now,
  onDelete,
  canDelete,
  onEdit,
  canEdit,
}: ActivityItemProps) {
  const metadata = activity.metadata as Record<string, unknown> | null;
  const isNote = activity.activityType === "note_added";
  const noteBody =
    metadata && typeof metadata.note === "string" ? metadata.note : null;
  const editedAt =
    metadata && typeof metadata.editedAt === "string"
      ? metadata.editedAt
      : null;

  const [draft, setDraft] = useState<string | null>(null);
  const isEditing = draft !== null;
  const isStatusChange = activity.activityType === "status_changed";
  const isBackwardChange = isStatusChange && isStatusChangeBackward(metadata);
  const hasReason = isStatusChange && !!metadata?.reason;

  const getIcon = () => {
    switch (activity.activityType) {
      case "status_changed":
        if (isBackwardChange) {
          return <ArrowDown className="h-4 w-4 text-amber-500" />;
        }
        return <ArrowRight className="h-4 w-4" />;
      case "note_added":
        return <StickyNote className="h-4 w-4" />;
      case "person_created":
        return <UserPlus className="h-4 w-4" />;
      case "person_updated":
        return <Pencil className="h-4 w-4" />;
      case "interview_completed":
        return <ClipboardCheck className="h-4 w-4" />;
      case "assessment_completed":
        return <Star className="h-4 w-4" />;
      case "commitment_recorded":
        return <FileCheck className="h-4 w-4" />;
      case "tag_added":
        return <Tag className="h-4 w-4" />;
      case "tag_removed":
        return <XCircle className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const message = formatActivityMessage(activity);

  return (
    <div className="relative flex gap-4 pb-8 last:pb-0">
      {/* Vertical connector line */}
      <div className="bg-border absolute top-8 bottom-0 left-[19px] w-px last:hidden" />

      <div
        className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
          isBackwardChange
            ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30"
            : "bg-background text-muted-foreground"
        }`}
      >
        {getIcon()}
      </div>

      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground font-medium">
              {activity.performer?.name || "System"}
            </span>
            <span className="text-muted-foreground">{message}</span>
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatRelativeTimestamp(new Date(activity.createdAt), now)}
          </span>
        </div>

        {isNote && noteBody !== null && !isEditing && (
          <div
            className="bg-muted/50 group relative rounded-md px-3 py-2 text-sm"
            data-testid="note-body"
          >
            <p className="whitespace-pre-wrap">{noteBody}</p>
            {editedAt && (
              <p
                className="text-muted-foreground mt-1 text-xs"
                data-testid="note-edited-marker"
              >
                Edited {formatRelativeTimestamp(new Date(editedAt), now)}
              </p>
            )}
            <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {canEdit && onEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground h-7 w-7 cursor-pointer"
                  onClick={() => setDraft(noteBody)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">Edit note</span>
                </Button>
              )}
              {canDelete && onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-7 w-7 cursor-pointer"
                  onClick={() => onDelete(activity.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Delete note</span>
                </Button>
              )}
            </div>
          </div>
        )}

        {isNote && isEditing && onEdit && (
          <div className="bg-muted/50 space-y-2 rounded-md px-3 py-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              aria-label="Edit note"
              data-testid="note-edit-input"
              className="min-h-0 resize-none bg-transparent text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="cursor-pointer"
                disabled={draft.trim().length === 0}
                onClick={() => {
                  onEdit(activity.id, draft.trim());
                  setDraft(null);
                }}
              >
                Save note
              </Button>
            </div>
          </div>
        )}

        {/* Show reason for status changes */}
        {hasReason && typeof metadata?.reason === "string" && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              isBackwardChange
                ? "border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20"
                : "bg-muted/50"
            }`}
          >
            <p className="text-muted-foreground mb-0.5 text-xs font-medium tracking-wide uppercase">
              Reason
            </p>
            <p className="whitespace-pre-wrap">{String(metadata.reason)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
