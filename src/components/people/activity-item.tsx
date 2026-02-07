"use client";

import { Button } from "@/components/ui/button";
import {
  type ActivityWithPerformer,
  formatActivityMessage,
  isStatusChangeBackward,
} from "@/lib/people/activity.shared";
import { formatDistanceToNow } from "date-fns";
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

interface ActivityItemProps {
  activity: ActivityWithPerformer;
  onDelete?: (activityId: string) => void;
  canDelete?: boolean;
}

export function ActivityItem({
  activity,
  onDelete,
  canDelete,
}: ActivityItemProps) {
  const metadata = activity.metadata as Record<string, unknown> | null;
  const isNote = activity.activityType === "note_added";
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
            {formatDistanceToNow(new Date(activity.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>

        {isNote && metadata && typeof metadata.note === "string" && (
          <div className="bg-muted/50 group relative rounded-md px-3 py-2 text-sm">
            <p className="whitespace-pre-wrap">{metadata.note}</p>
            {canDelete && onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive absolute top-1 right-1 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onDelete(activity.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Delete note</span>
              </Button>
            )}
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
