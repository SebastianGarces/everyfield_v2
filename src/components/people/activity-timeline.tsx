import { verifySession } from "@/lib/auth/session";
import { getActivities } from "@/lib/people/activity";
import { ActivityTimelineClient } from "./activity-timeline-client";

interface ActivityTimelineProps {
  churchId: string;
  personId: string;
}

/**
 * Server component that fetches activity data and renders the client wrapper.
 * The client wrapper uses useOptimistic for instant UI updates when adding/deleting notes.
 * Server actions call refresh() to reconcile optimistic state with actual server state.
 */
export async function ActivityTimeline({
  churchId,
  personId,
}: ActivityTimelineProps) {
  const { user } = await verifySession();
  const { activities, nextCursor } = await getActivities(churchId, personId, {
    limit: 10,
  });

  return (
    <ActivityTimelineClient
      activities={activities}
      nextCursor={nextCursor}
      personId={personId}
      currentUserId={user.id}
    />
  );
}
