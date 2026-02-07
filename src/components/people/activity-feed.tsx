"use client";

import {
  deleteNoteAction,
  getMoreActivitiesAction,
} from "@/app/(dashboard)/people/actions";
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
  nextCursor?: Date;
  personId: string;
  currentUserId: string;
}

type OptimisticAction = { type: "delete"; activityId: string };

export function ActivityFeed({
  activities,
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
            onDelete={handleDeleteNote}
            canDelete={
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
