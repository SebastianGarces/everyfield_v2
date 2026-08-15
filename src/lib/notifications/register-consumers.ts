import { registerMeetingStillLivePredicates } from "@/lib/meetings/notifications";
import { registerTaskStillLivePredicates } from "@/lib/tasks/notifications";

// ============================================================================
// N-014 — arming the still-live re-check in the runtime that dispatches.
//
// THE BUG THIS FILE EXISTS TO CLOSE. Registration used to be a module-load side
// effect in each feature (`registerTaskStillLivePredicates()` at the bottom of
// `src/lib/tasks/notifications.ts`, the meeting one at the bottom of its
// sibling), on the theory that "importing the module arms the check". The
// dispatcher's only production entrypoint —
// `src/app/api/notifications/dispatch/route.ts` — imports NO feature module, so
// in the cron runtime all six types were unregistered. `resolveLiveness` treats
// an unregistered type as LIVE by design, so the second line of defence was
// inert exactly where it was needed: a task completed on a path the cancel
// cannot reach, or a meeting cancelled after its row was claimed, was emailed
// and logged as delivered. The feature suites passed throughout, because each
// calls its registrar by hand first.
//
// SO REGISTRATION IS A CALL, AND THIS IS THE ONE PLACE THAT MAKES IT. A bare
// side-effect `import "@/lib/tasks/notifications"` would work today and is the
// fragile form — it reads as an unused import to every linter and to anyone
// tidying the file. `registerStillLivePredicate` REPLACES rather than stacks, so
// this is idempotent and may be called on every tick.
//
// A CONSUMER REGISTERS ITSELF HERE, and nowhere else. That is the whole cost of
// the coupling: this module is the one edge from `src/lib/notifications/` back
// into the features, and it buys a third consumer never having to discover that
// the entrypoint has to be edited too.
// ============================================================================

/**
 * Arm every feature's still-live predicate.
 *
 * Called at module scope by the dispatch route, so importing that route is what
 * proves the check is armed — which is exactly what
 * `src/app/api/notifications/dispatch/route.test.ts` asserts, over the ROUTE's
 * own module graph rather than over the feature modules.
 */
export function registerNotificationConsumers(): void {
  registerTaskStillLivePredicates();
  registerMeetingStillLivePredicates();
}
