"use client";

import { addNoteAction } from "@/app/(dashboard)/people/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ActivityWithPerformer } from "@/lib/people/activity.shared";
import { useOptimistic, useTransition } from "react";
import { ActivityFeed } from "./activity-feed";
import { NoteForm } from "./note-form";

interface ActivityTimelineClientProps {
  activities: ActivityWithPerformer[];
  nextCursor?: Date;
  personId: string;
  currentUserId: string;
}

type OptimisticAction = { type: "add"; activity: ActivityWithPerformer };

/**
 * Client wrapper that owns optimistic state for the activity timeline.
 * Uses useOptimistic for instant UI updates when adding notes.
 * The server action calls refresh() to reconcile with actual server state.
 */
export function ActivityTimelineClient({
  activities,
  nextCursor,
  personId,
  currentUserId,
}: ActivityTimelineClientProps) {
  const [isPending, startTransition] = useTransition();

  // Optimistic state for adding new activities
  const [optimisticActivities, updateOptimistic] = useOptimistic(
    activities,
    (state, action: OptimisticAction) => {
      if (action.type === "add") {
        return [action.activity, ...state];
      }
      return state;
    }
  );

  // Handle note submission with optimistic update
  const handleAddNote = async (
    note: string,
    optimisticActivity: ActivityWithPerformer
  ) => {
    startTransition(async () => {
      // Optimistic update - shows immediately
      updateOptimistic({ type: "add", activity: optimisticActivity });

      // Server action - calls refresh() internally to sync state
      await addNoteAction(personId, note);
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Note</CardTitle>
        </CardHeader>
        <CardContent>
          <NoteForm
            personId={personId}
            currentUserId={currentUserId}
            onAddNote={handleAddNote}
            isPending={isPending}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityFeed
            activities={optimisticActivities}
            nextCursor={nextCursor}
            personId={personId}
            currentUserId={currentUserId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
