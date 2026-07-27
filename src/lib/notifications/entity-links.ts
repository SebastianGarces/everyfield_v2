import type { NotificationEntityType } from "@/db/schema";

// ============================================================================
// Where a feed row points (N-008, Screen 1).
//
// "A link to the referenced entity WHERE ONE EXISTS" is two facts, not one:
//
//   1. the notification names an entity at all (`entity_type` + `entity_id`
//      are nullable and are written together or not at all — see the enqueue
//      schema's refine), and
//   2. that entity type has a route in this app today.
//
// (2) is why this is a lookup with `null` arms rather than a template string.
// `notificationEntityTypes` is deliberately ahead of the product: `facility`
// and `financial_entry` are real notification subjects with no screens yet, and
// `document` has a library page but no per-document route. Interpolating a path
// for those would ship a row whose link 404s — a dead link is worse than no
// link, because the user cannot tell "this went nowhere" from "I clicked wrong".
// A type with no route renders as plain text; the title, body and timestamp
// still say what happened.
//
// Adding a route later is a one-line change here, and the exhaustive `Record`
// means adding an ENTITY TYPE without deciding this question is a compile
// error, not a silent `undefined` that renders as `/undefined/<id>`.
// ============================================================================

/**
 * Path template per entity type, or `null` where this app has no screen for it.
 * `:id` is the only placeholder.
 */
const ENTITY_ROUTE: Record<NotificationEntityType, string | null> = {
  task: "/tasks/:id",
  meeting: "/meetings/:id",
  person: "/people/:id",
  message: "/communication/:id",
  ministry_team: "/teams/:id",
  // A training completion belongs to a program under a team; the notification
  // carries the program id, not the team id, so there is no route to build.
  training: null,
  // Assessments are a single latest-snapshot screen, not one page per run.
  phase_assessment: "/phase",
  // `/documents` is a library, not a per-document route.
  document: null,
  facility: null,
  financial_entry: null,
};

/**
 * The href for a notification's referenced entity, or `null` when there is
 * nothing to link to.
 *
 * Returns null — never a half-built path — when the pair is incomplete, so a
 * row whose `entity_id` is missing cannot render a link to `/tasks/`.
 *
 * `encodeURIComponent` on the id is belt-and-braces: ids are uuids from the
 * database (the column is `uuid`), so there is nothing to escape today, but
 * this is the one place a stored value becomes an href and the escaping costs
 * nothing.
 */
export function notificationEntityHref(
  entityType: NotificationEntityType | null,
  entityId: string | null
): string | null {
  if (!entityType || !entityId) return null;

  const template = ENTITY_ROUTE[entityType];
  if (!template) return null;

  return template.replace(":id", encodeURIComponent(entityId));
}
