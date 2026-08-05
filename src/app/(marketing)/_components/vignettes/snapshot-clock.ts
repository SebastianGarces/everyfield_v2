// ============================================================================
// snapshot-clock — fixture timestamps, re-anchored to the render.
//
// Some of the app components the landing page embeds render RELATIVE time from
// a Date: the activity feed says "6h ago" / "4d ago"
// (components/dashboard/activity-feed.tsx), and the oversight cards say
// "Assessed yesterday" (lib/phase-engine/oversight/health-presentation.ts).
// A fixture that froze those Dates absolutely would keep every other number
// frozen with it — and the two would drift apart into a picture the product
// could never render: an assessment "assessed 8 months ago" sitting next to
// the launch countdown that same assessment computed ("launches in 27 days").
//
// So the fixture freezes the OFFSETS, not the instants. Every timestamp keeps
// its exact distance from the moment the snapshot was taken; only the anchor
// moves, to whenever the page was rendered. The story the snapshot recorded —
// three evaluations closed the same evening, a note four days back, six Sunday
// gatherings a week apart — is preserved to the millisecond; what changes is
// that it is always told as of now instead of as of a date in the past.
//
// The raw ISO strings stay verbatim in each fixture, so the record of what was
// actually read is still in the file. Evaluated once per build (these are
// server components on a statically rendered page), so a page rebuild is what
// refreshes the labels.
// ============================================================================

/**
 * Build a clock anchored to one snapshot instant.
 *
 * @param snapshotIso when the fixture below it was read from the database
 * @returns `since(iso)` — that verbatim timestamp, moved forward so its
 *          distance from "now" equals its distance from the snapshot
 */
export function snapshotClock(snapshotIso: string): (iso: string) => Date {
  const snapshotAt = Date.parse(snapshotIso);
  const renderedAt = Date.now();

  return (iso: string) => new Date(renderedAt - (snapshotAt - Date.parse(iso)));
}
