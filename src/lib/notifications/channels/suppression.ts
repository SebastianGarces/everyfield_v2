import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  emailSuppressions,
  type EmailSuppression,
  type EmailSuppressionReason,
} from "@/db/schema/notifications";

// ============================================================================
// Address-level bounce suppression (#324, from #262).
//
// WHAT THIS IS FOR. `notification_deliveries.error` carries
// `PERMANENT_FAILURE_PREFIX` and `channelEligibility` refuses to retry a row
// that has it — but that is ONE (notification, channel) pair. The next
// notification gets a fresh delivery row with a fresh attempt count and mails
// the same dead mailbox again. A digest is enqueued daily, so one dead address
// is one bounce a day against a sending domain that takes months to earn back.
// Suppression is therefore a fact about the ADDRESS, written once by the
// webhook and read by every later send.
//
// REAL EXPOSURE IS ZERO AT MERGE TIME — nothing calls `enqueueNotification` in
// production yet — and that is exactly the reason this lands first. Between
// #251 and the first enqueueing feature no alarm fires. The first production
// enqueuer is the planter digest (U135), which depends on this.
//
// ONE NORMALISED FORM. Every read and every write of `email_suppressions.email`
// goes through `normalizeEmailAddress`, which is the only reason a plain btree
// unique index can stand in for a case-insensitive one — a `lower(email)`
// expression index would make the `ON CONFLICT` target unspellable (the same
// reasoning that rejected a `coalesce` index in memory/invariants.md →
// Transactions).
// ============================================================================

/**
 * The one stored form of an address.
 *
 * Case and surrounding whitespace only. The local part of an address is
 * case-SENSITIVE per RFC 5321 and we lowercase it anyway, deliberately: no mail
 * provider in practice treats `Ada@` and `ada@` as two mailboxes, and the
 * failure mode of over-normalising (one suppression covers both spellings) is
 * strictly safer than the failure mode of under-normalising (a bounced address
 * keeps being mailed because the webhook spelled it differently from the
 * `users` row). No plus-address stripping and no dot-folding: those genuinely
 * ARE different mailboxes at some providers, and suppressing one address must
 * never silence another.
 */
export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export interface RecordSuppressionInput {
  email: string;
  reason: EmailSuppressionReason;
  /** The provider event that produced it, e.g. `email.bounced`. */
  source?: string | null;
  /** What the provider said, kept verbatim so a dispute has evidence. */
  detail?: string | null;
}

/**
 * Suppress an address, or leave an existing active suppression alone.
 *
 * ONE STATEMENT with `ON CONFLICT … DO NOTHING`, arbitrated by the partial
 * unique index. A SELECT-then-INSERT is not a concurrency guard
 * (memory/invariants.md → Transactions), and webhook retries genuinely do
 * arrive concurrently — the provider delivers the same bounce more than once by
 * design.
 *
 * An empty `returning()` is NOT an error: it means this address was already
 * suppressed, which is the outcome the caller wanted. The FIRST suppression's
 * reason and timestamp are kept rather than overwritten, so "when did this
 * start?" stays answerable.
 *
 * Returns the active row either way — the winner's, or the row that beat it.
 */
export async function recordAddressSuppression(
  input: RecordSuppressionInput
): Promise<EmailSuppression | null> {
  const email = normalizeEmailAddress(input.email);
  if (!email) return null;

  const [inserted] = await db
    .insert(emailSuppressions)
    .values({
      email,
      reason: input.reason,
      source: input.source ?? null,
      detail: input.detail ?? null,
    })
    // `where` on a DO NOTHING is the INDEX PREDICATE, not a row filter: it is
    // what names `email_suppressions_active_email_idx` (partial, on `email`
    // where `cleared_at is null`) as the arbiter. Without it Postgres cannot
    // pick a partial index and raises SQLSTATE 42P10 on every call.
    .onConflictDoNothing({
      target: emailSuppressions.email,
      where: isNull(emailSuppressions.clearedAt),
    })
    .returning();

  if (inserted) return inserted;

  // The loser re-reads the winner, so the caller always learns the live state
  // rather than "nothing happened".
  const [existing] = await db
    .select()
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.email, email),
        isNull(emailSuppressions.clearedAt)
      )
    )
    .limit(1);

  return existing ?? null;
}

export interface ClearSuppressionInput {
  email: string;
  /**
   * Why. REQUIRED, and `email_suppressions_cleared_check` enforces it in the
   * database: a clear that does not say why is indistinguishable from a bug
   * that cleared it.
   */
  reason: string;
  /**
   * The admin who cleared it. Null is the self-service path — the address
   * holder re-verified — which has no actor row to name, so this is never the
   * "was it cleared?" test. `cleared_at` is.
   */
  clearedByUserId?: string | null;
}

/**
 * Lift the suppression on an address. A bounce is not a life sentence.
 *
 * A compare-and-set on `cleared_at is null`, not a delete: the row stays as
 * history, so an address that bounces, clears and bounces again is three rows
 * and a legible story rather than one row overwritten twice. Clearing an
 * address that is not suppressed writes nothing and reports `0` — the caller's
 * intent ("this address should be mailable") already holds.
 */
export async function clearAddressSuppression(
  input: ClearSuppressionInput
): Promise<number> {
  const email = normalizeEmailAddress(input.email);
  if (!email) return 0;

  const cleared = await db
    .update(emailSuppressions)
    .set({
      clearedAt: sql`now()`,
      clearedByUserId: input.clearedByUserId ?? null,
      clearedReason: input.reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(emailSuppressions.email, email),
        isNull(emailSuppressions.clearedAt)
      )
    )
    .returning({ id: emailSuppressions.id });

  return cleared.length;
}

/**
 * Which of these addresses are suppressed, as normalised addresses.
 *
 * ONE query for a whole dispatch run, never one per recipient: this runs inside
 * a function with a hard timeout, and a per-notification read here would be an
 * N+1 in the hottest loop in F11.
 */
export async function loadSuppressedAddresses(
  emails: readonly string[]
): Promise<string[]> {
  const normalised = [
    ...new Set(emails.map(normalizeEmailAddress).filter(Boolean)),
  ];
  if (normalised.length === 0) return [];

  const rows = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(
      and(
        inArray(emailSuppressions.email, normalised),
        isNull(emailSuppressions.clearedAt)
      )
    );

  return rows.map((row) => row.email);
}

/** The single-address form, for a caller that has exactly one to ask about. */
export async function isAddressSuppressed(email: string): Promise<boolean> {
  const suppressed = await loadSuppressedAddresses([email]);
  return suppressed.length > 0;
}
