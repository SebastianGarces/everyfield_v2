// ============================================================================
// The permanence marker — an IMPORT-FREE LEAF (#263 item 2).
//
// WHAT IT IS. One prefix on `notification_deliveries.error`, written when a
// failure must never be retried and read by `channelEligibility` to refuse the
// retry. It is the durable record of permanence, kept in the error text rather
// than in a counter so the attempt count stays truthful about how many provider
// calls actually happened.
//
// WHY IT LIVES ALONE. It used to be declared in `./dispatch`, which opens with
// `@/db`, the schema barrel and the Resend client. `channels/delivery-events.ts`
// needed the string and nothing else, and `/api/webhooks/resend` imports that
// module — so a route whose whole job is to read a signed provider event pulled
// the entire dispatcher into its graph for one nine-character constant. The
// review of #251 flagged exactly that.
//
// This module therefore imports NOTHING, which is what makes it safe for the
// webhook route, the dispatcher and the test helpers alike to depend on. Keep
// it that way: the moment it needs a type from `@/db`, the edge it was created
// to cut comes back.
//
// It is also NOT re-exported from `./dispatch`. A leaf whose contents are also
// served from the trunk is not a leaf — callers keep reaching for the trunk and
// the graph closes over again. Import this module directly.
// ============================================================================

/**
 * Prefix on `notification_deliveries.error` marking a failure that must never
 * be retried.
 *
 * Changing the string re-arms every already-recorded permanent failure, because
 * the marker is matched by prefix (`startsWith`, and one `not like` in the
 * dispatcher's own SQL). That is a data migration, not an edit.
 */
export const PERMANENT_FAILURE_PREFIX = "permanent: ";
