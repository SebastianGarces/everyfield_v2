import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "../categories";
import {
  loadUserPreferences,
  preferenceOwnerFromUnsubscribeToken,
  resolvePreference,
  setPreferenceQuery,
  type PreferenceOwner,
} from "../preferences";
import type { UnsubscribeTokenRejection } from "./unsubscribe-token";

// ============================================================================
// The unauthenticated opt-out (N-007, FRD Workflow 4).
//
// This is the highest-risk surface in F11 and the shape of the module reflects
// it. Three properties, each enforced structurally rather than by care:
//
// 1. SCOPE OF EFFECT. Every write goes through `unsubscribeWriteQuery`, which
//    is `setPreferenceQuery` with the channel PINNED to `"email"` and the
//    category taken from the token. There is no parameter through which a
//    caller could reach another user, another channel, or another category, so
//    "exactly one category's email channel for exactly one user" is a property
//    of the function signature and not of the route that calls it.
//
// 2. WHOSE. The user id is never a request input. It comes out of a sealed,
//    authenticated token via `preferenceOwnerFromUnsubscribeToken`, which is
//    the only place outside a session that can mint a `PreferenceOwner`.
//
// 3. WHAT LEAKS. Every refusal — forged token, edited token, expired token, a
//    token for a user who has since been deleted — returns the SAME shape with
//    no account detail in it. A stranger who guesses at tokens learns nothing
//    about whether an address exists here. The `reason` is carried for logs and
//    is deliberately not something the page renders.
//
// The UNDO writes `enabled: true` explicitly rather than deleting the row and
// falling back to the coded default. Both are "on" today, but only the explicit
// write is guaranteed to be: a category whose default was later reconsidered
// would make a delete-based undo silently do nothing. The user pressed a button
// that says "keep sending these", and that is a choice worth recording.
// ============================================================================

/** The channel this token family can ever touch. Fixed, never a parameter. */
const UNSUBSCRIBE_CHANNEL = "email" as const;

/**
 * The write, as a builder — exported so a test can `.toSQL()` it and assert the
 * scope of effect without a live Postgres. See `setPreferenceQuery` for the
 * upsert's semantics.
 */
export function unsubscribeWriteQuery(
  owner: PreferenceOwner,
  category: NotificationCategory,
  enabled: boolean
) {
  return setPreferenceQuery(owner, {
    category,
    channel: UNSUBSCRIBE_CHANNEL,
    enabled,
  });
}

/** What a caller may safely show a stranger about the affected account. */
export interface UnsubscribeSubjectView {
  category: NotificationCategory;
  /** Plain-language label from the code registry — "Tasks", "Meetings". */
  categoryLabel: string;
  /** The address the email went to. The FRD requires naming it. */
  email: string;
  /** Whether this category's email is currently ON for this user. */
  enabled: boolean;
}

export type UnsubscribeResult =
  | { status: "ok"; subject: UnsubscribeSubjectView }
  | { status: "rejected"; reason: UnsubscribeRejection };

/**
 * `unknown_recipient` covers a token that opened cleanly for a user who no
 * longer exists. It is grouped with the token rejections on purpose: the
 * caller must render all of them identically, and a separate type would invite
 * a page that says "that account is gone" — which is an account oracle.
 */
export type UnsubscribeRejection =
  | UnsubscribeTokenRejection
  | "unknown_recipient";

export interface UnsubscribeOptions {
  now?: Date;
  secret?: string;
}

/** Exactly the column the confirmation page is allowed to name. */
async function loadRecipientEmail(
  owner: PreferenceOwner
): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, owner))
    .limit(1);
  return row?.email ?? null;
}

async function describeSubject(
  owner: PreferenceOwner,
  category: NotificationCategory
): Promise<UnsubscribeSubjectView | null> {
  const email = await loadRecipientEmail(owner);
  if (!email) return null;

  const rows = await loadUserPreferences(owner);

  return {
    category,
    categoryLabel: NOTIFICATION_CATEGORIES[category]?.label ?? category,
    email,
    enabled: resolvePreference(rows, category, UNSUBSCRIBE_CHANNEL).enabled,
  };
}

/**
 * Read the token's subject WITHOUT changing anything.
 *
 * The confirmation page uses this: the mutation already happened in the route
 * that redirected here, and re-applying it on every render would make a
 * refresh after an undo silently undo the undo.
 */
export async function describeUnsubscribeSubject(
  token: string,
  options: UnsubscribeOptions = {}
): Promise<UnsubscribeResult> {
  const resolved = preferenceOwnerFromUnsubscribeToken(token, options);
  if (!resolved.ok) {
    return { status: "rejected", reason: resolved.reason };
  }

  const subject = await describeSubject(resolved.owner, resolved.category);
  if (!subject) {
    return { status: "rejected", reason: "unknown_recipient" };
  }

  return { status: "ok", subject };
}

/**
 * Apply the opt-out (or its undo).
 *
 * `enabled: false` is the unsubscribe; `enabled: true` is the one-click undo.
 * Both are the same capability — this token authorises writes to exactly one
 * (user, category, email) cell, in either direction — and both are idempotent,
 * so a mail client that pre-fetches the link, or a user who clicks twice, ends
 * up in the same place.
 */
export async function applyEmailUnsubscribe(
  token: string,
  enabled: boolean,
  options: UnsubscribeOptions = {}
): Promise<UnsubscribeResult> {
  const resolved = preferenceOwnerFromUnsubscribeToken(token, options);
  if (!resolved.ok) {
    return { status: "rejected", reason: resolved.reason };
  }

  // Prove the recipient still exists BEFORE writing. A preference row for a
  // deleted user is harmless but pointless, and reading first means the
  // rejection path and the success path agree on what "this user" means.
  const email = await loadRecipientEmail(resolved.owner);
  if (!email) {
    return { status: "rejected", reason: "unknown_recipient" };
  }

  await unsubscribeWriteQuery(resolved.owner, resolved.category, enabled);

  return {
    status: "ok",
    subject: {
      category: resolved.category,
      categoryLabel:
        NOTIFICATION_CATEGORIES[resolved.category]?.label ?? resolved.category,
      email,
      enabled,
    },
  };
}
