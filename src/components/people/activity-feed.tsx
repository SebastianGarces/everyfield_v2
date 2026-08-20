"use client";

import {
  deleteNoteAction,
  editNoteAction,
  getMoreActivitiesAction,
} from "@/app/(dashboard)/people/activity-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { type ActivityWithPerformer } from "@/lib/people/activity.shared";
import { Loader2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { ActivityItem } from "./activity-item";

interface ActivityFeedProps {
  /** Activities from server - this is the source of truth */
  activities: ActivityWithPerformer[];
  /** One instant for the whole render, threaded from the server component. */
  now: Date;
  nextCursor?: Date;
  personId: string;
  currentUserId: string;
}

type OptimisticAction =
  | { type: "delete"; activityId: string }
  | { type: "edit"; activityId: string; note: string; editedAt: string };

export function ActivityFeed({
  activities,
  now,
  nextCursor: initialNextCursor,
  personId,
  currentUserId,
}: ActivityFeedProps) {
  // Pagination state - legitimate client state for "load more" functionality
  // These are additional activities loaded via pagination, stored in useState
  const [loadedMoreActivities, setLoadedMoreActivities] = useState<
    ActivityWithPerformer[]
  >([]);
  const [nextCursor, setNextCursor] = useState<Date | undefined>(
    initialNextCursor
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Combine server activities with client-loaded pagination activities
  const allActivities = [...activities, ...loadedMoreActivities];

  // useOptimistic only for delete operations (which are actual mutations)
  const [optimisticActivities, updateOptimistic] = useOptimistic(
    allActivities,
    (state, action: OptimisticAction) => {
      if (action.type === "delete") {
        return state.filter((a) => a.id !== action.activityId);
      }
      if (action.type === "edit") {
        // MAPPED IN PLACE, never re-sorted: the timeline's order is the
        // person's history, and an edit is a correction to one entry, not a
        // new event (P-010e).
        return state.map((a) =>
          a.id === action.activityId
            ? {
                ...a,
                metadata: {
                  ...((a.metadata as Record<string, unknown> | null) ?? {}),
                  note: action.note,
                  editedAt: action.editedAt,
                },
              }
            : a
        );
      }
      return state;
    }
  );

  const handleLoadMore = async () => {
    if (!nextCursor) return;

    setIsLoadingMore(true);
    try {
      const { activities: newActivities, nextCursor: newNextCursor } =
        await getMoreActivitiesAction(personId, nextCursor);

      // Append to client state - this persists across renders
      setLoadedMoreActivities((prev) => [...prev, ...newActivities]);
      setNextCursor(newNextCursor);
    } catch (error) {
      console.error("Failed to load more activities:", error);
      toast.error("Failed to load more activities");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleDeleteNote = (activityId: string) => {
    setDeleteTarget(activityId);
  };

  const handleEditNote = (activityId: string, note: string) => {
    const editedAt = new Date().toISOString();

    startTransition(async () => {
      updateOptimistic({ type: "edit", activityId, note, editedAt });

      const result = await editNoteAction(personId, activityId, note);
      if (result.success) {
        toast.success("Note updated");
        // A note loaded by pagination lives in this component's own state, not
        // in the server props `refresh()` reconciles — so it is corrected here
        // too, or it would snap back to the old body on the next render.
        setLoadedMoreActivities((prev) =>
          prev.map((a) =>
            a.id === activityId
              ? {
                  ...a,
                  metadata: {
                    ...((a.metadata as Record<string, unknown> | null) ?? {}),
                    note,
                    editedAt,
                  },
                }
              : a
          )
        );
      } else {
        toast.error("Failed to edit note", { description: result.error });
      }
    });
  };

  const confirmDeleteNote = async () => {
    if (!deleteTarget) return;

    const activityId = deleteTarget;
    setDeleteTarget(null);

    // Optimistic delete - UI updates immediately
    startTransition(async () => {
      updateOptimistic({ type: "delete", activityId });

      const result = await deleteNoteAction(personId, activityId);
      if (result.success) {
        toast.success("Note deleted");
        // Also remove from loadedMoreActivities if it was a paginated item
        setLoadedMoreActivities((prev) =>
          prev.filter((a) => a.id !== activityId)
        );
        // Server action calls refresh() internally, UI will reconcile for server activities
      } else {
        toast.error("Failed to delete note", {
          description: result.error,
        });
        // On error, the optimistic update will be reverted when server state refreshes
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-0">
        {optimisticActivities.map((activity) => (
          <ActivityItem
            key={activity.id}
            activity={activity}
            now={now}
            onDelete={handleDeleteNote}
            canDelete={
              activity.activityType === "note_added" &&
              activity.performedBy === currentUserId
            }
            onEdit={handleEditNote}
            // A note's AUTHOR edits it — the same test the delete control uses,
            // and the same one `editNoteAction` re-asserts in SQL.
            canEdit={
              activity.activityType === "note_added" &&
              activity.performedBy === currentUserId
            }
          />
        ))}
      </div>

      {nextCursor && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load More
          </Button>
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The note will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteNote}
              disabled={isPending}
              variant="destructive"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
