// ============================================================================
// "THEIR OWN TASK" — `tasks.own`'s subject half, in terms both sides have.
//
// PURE AND CLIENT-SAFE, because the rule is asked in two places and one of them
// is a browser bundle. `service.ts` asks it with a `User` in hand; `TaskCard`
// has a capability answer from `useCan` and an id, and cannot import the
// service without dragging `@/db` across the boundary. So the rule lives here
// and both call it — `mayActOnTask` in the service delegates to this, and the
// card passes what it has.
//
// It was TWO SPELLINGS of one sentence until #660: the service said
// `task.assignedToId === actor.id || holdsSeatFor(actor, "tasks.write")` and
// the card said `useCan("tasks.write") || task.assignedToId === currentUserId`.
// Both were right, which is the dangerous kind of duplication — a rule with two
// homes drifts silently, and the whole of #660 was two halves of one contract
// disagreeing about the same string.
// ============================================================================

/**
 * May this viewer act on this row — complete it, reopen it, restatus it?
 *
 * `canWrite` is `tasks.write` already answered, because the two callers answer
 * it differently (a seat lookup on the server, the capability transport in the
 * browser) and neither answer belongs in this rule.
 *
 * `viewerId` is a plain `string`: both callers hold an identity — the actor's
 * row on the server, the threaded `currentUserId` in the card — so widening it
 * to nullable would be defending a state neither can produce, and an
 * unassigned row (`assignedToId: null`) then falls out as nobody's own without
 * a guard.
 */
export function mayActOnTaskRow(row: {
  canWrite: boolean;
  assignedToId: string | null;
  viewerId: string;
}): boolean {
  return row.canWrite || row.assignedToId === row.viewerId;
}
