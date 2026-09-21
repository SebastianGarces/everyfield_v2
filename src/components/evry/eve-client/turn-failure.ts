import type { MessageStreamEvent } from "eve/client";

export const EVE_TURN_FAILURE_MESSAGE =
  "Evry couldn't finish this response. Your message is saved. Try again.";
export const EVE_RETRY_MESSAGE = "Please try my last request again.";

/** A failed turn remains failed when its session parks; a later turn supersedes it. */
export function latestEveTurnFailure(events: readonly MessageStreamEvent[]) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.type === "turn.failed") return { turnId: event.data.turnId };
    if (
      event.type === "turn.started" ||
      event.type === "turn.completed" ||
      event.type === "turn.cancelled" ||
      event.type === "session.completed" ||
      event.type === "session.failed"
    )
      return null;
  }
  return null;
}
