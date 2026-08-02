import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type NotificationPreference } from "@/db/schema";

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
import {
  mintUnsubscribeToken,
  type UnsubscribeTokenRejection,
} from "./unsubscribe-token";

// ============================================================================
// The unauthenticated opt-out (N-007, FRD Workflow 4).
//
// This is the highest-risk surface in F11 and the shape of the module reflects
// it. Four properties, each enforced structurally rather than by care:
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
// 3. WHICH DIRECTION (ruled 2026-08-01). `enabled` is no longer a parameter.
//    `applyEmailOptOut` writes `false` and can only open a `disable` token;
//    `applyEmailOptIn` writes `true` and can only open an `enable` token. The
//    two directions are two functions over two token families with two keys, so
//    "the emailed link can only ever opt you out" is not a check a caller could
//    forget to pass — there is no argument to pass.
//
// 4. WHAT LEAKS. Every refusal — forged token, edited token, expired token, a
//    token for a user who has since been deleted, a token for the wrong
//    direction — returns the SAME shape with no account detail in it. A
//    stranger who guesses at tokens learns nothing about whether an address
//    exists here. The `reason` is carried for logs and is deliberately not
//    something the page renders.
//
// The UNDO writes `enabled: true` explicitly rather than deleting the row and
// falling back to the coded default. Both are "on" today, but only the explicit
// write is guaranteed to be: a category whose default was later reconsidered
// would make a delete-based undo silently do nothing. The user pressed a button
// that says "keep sending these", and that is a choice worth recording.
//
// ----------------------------------------------------------------------------
// Why storage is injected
// ----------------------------------------------------------------------------
//
// `UnsubscribeStore` exists so a test can prove the negative that matters most
// on this surface: that a READ path performs no write. A fake store records
// every write attempt, so "rendering the confirmation page touched nothing" is
// an assertion about executed code rather than a claim about which functions
// someone remembered not to call. Production always uses `liveUnsubscribeStore`
// — no route or page passes one.
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

/** The three things this module does to storage, and nothing else. */
export interface UnsubscribeStore {
  /** Exactly the column the confirmation page is allowed to name. */
  loadRecipientEmail(owner: PreferenceOwner): Promise<string | null>;
  loadPreferences(owner: PreferenceOwner): Promise<NotificationPreference[]>;
  writeEmailPreference(
    owner: PreferenceOwner,
    category: NotificationCategory,
    enabled: boolean
  ): Promise<void>;
}

export const liveUnsubscribeStore: UnsubscribeStore = {
  async loadRecipientEmail(owner) {
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, owner))
      .limit(1);
    return row?.email ?? null;
  },
  loadPreferences(owner) {
    return loadUserPreferences(owner);
  },
  async writeEmailPreference(owner, category, enabled) {
    await unsubscribeWriteQuery(owner, category, enabled);
  },
};

/** What a caller may safely show a stranger about the affected account. */
export interface UnsubscribeSubjectView {
  category: NotificationCategory;
  /** Plain-language label from the code registry — "Tasks", "Meetings". */
  categoryLabel: string;
  /** The address the email went to. The FRD requires naming it. */
  email: string;
  /** Whether this category's email is currently ON for this user. */
  enabled: boolean;
  /**
   * A freshly minted, short-lived `enable` token — present ONLY on the result
   * of a successful opt-out, i.e. minted by the ACT of disabling and never by
   * rendering. A page describing an already-off category gets `null`: if a
   * render could mint, any holder of the 180-day emailed link could refresh
   * the page into a fresh re-enable capability for the link's whole lifetime,
   * which is exactly the consent defect the 2026-08-01 ruling closed. The
   * caller threads this token through its redirect into one confirmation
   * render; it never travels in an email. Also `null` when the environment
   * cannot mint one, so the page drops the undo button rather than 500-ing in
   * front of a stranger.
   */
  undoToken: string | null;
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
  /** Storage seam. Tests pass a recorder; production leaves it alone. */
  store?: UnsubscribeStore;
}

function labelFor(category: NotificationCategory): string {
  return NOTIFICATION_CATEGORIES[category]?.label ?? category;
}

/**
 * Mint the undo capability, or give up quietly.
 *
 * Minting throws when the deployment has no secret. Unreachable from here
 * TODAY — the same secret already opened the emailed token a few lines up, and
 * a secret that can open one can mint one — but the caller serves a stranger
 * who just opted out, and the cost of the guard is a `try`. If the two
 * directions ever take separate secrets, this is the difference between losing
 * the undo BUTTON and returning a 500.
 */
function mintUndoToken(
  owner: PreferenceOwner,
  category: NotificationCategory,
  options: UnsubscribeOptions
): string | null {
  try {
    return mintUnsubscribeToken({
      userId: owner,
      category,
      purpose: "enable",
      now: options.now,
      secret: options.secret,
    });
  } catch {
    return null;
  }
}

async function describeSubject(
  owner: PreferenceOwner,
  category: NotificationCategory,
  options: UnsubscribeOptions
): Promise<UnsubscribeSubjectView | null> {
  const store = options.store ?? liveUnsubscribeStore;

  const email = await store.loadRecipientEmail(owner);
  if (!email) return null;

  const rows = await store.loadPreferences(owner);
  const enabled = resolvePreference(
    rows,
    category,
    UNSUBSCRIBE_CHANNEL
  ).enabled;

  return {
    category,
    categoryLabel: labelFor(category),
    email,
    enabled,
    // NEVER minted here. This runs on every GET — including a GET with a
    // months-old emailed token whose category was switched off elsewhere —
    // and a read must not manufacture a write capability. The undo token is
    // minted only where the opt-out happens: `applyEmailPreference`'s
    // disable branch.
    undoToken: null,
  };
}

/**
 * Read the token's subject WITHOUT changing anything.
 *
 * This is what the confirmation page calls, on the GET that the emailed link
 * lands on. It performs NO write — that is the whole ruling of 2026-08-01: mail
 * scanners fetch every URL in a delivered message, so a GET that mutated would
 * opt people out who never saw the page. The mutation is on the page's button.
 *
 * It opens the token as a `disable` capability, because the emailed link is the
 * only thing that reaches this page.
 */
export async function describeUnsubscribeSubject(
  token: string,
  options: UnsubscribeOptions = {}
): Promise<UnsubscribeResult> {
  // Only the three things verification is entitled to. The storage seam is
  // deliberately not spread in here.
  const resolved = preferenceOwnerFromUnsubscribeToken(token, {
    purpose: "disable",
    now: options.now,
    secret: options.secret,
  });
  if (!resolved.ok) {
    return { status: "rejected", reason: resolved.reason };
  }

  const subject = await describeSubject(
    resolved.owner,
    resolved.category,
    options
  );
  if (!subject) {
    return { status: "rejected", reason: "unknown_recipient" };
  }

  return { status: "ok", subject };
}

/**
 * The two directions, as two functions.
 *
 * Both are idempotent, so a double-click or a retried POST ends in the same
 * place, and both prove the recipient still exists BEFORE writing: a preference
 * row for a deleted user is harmless but pointless, and reading first means the
 * rejection path and the success path agree on what "this user" means.
 */
async function applyEmailPreference(
  token: string,
  purpose: "disable" | "enable",
  enabled: boolean,
  options: UnsubscribeOptions
): Promise<UnsubscribeResult> {
  const store = options.store ?? liveUnsubscribeStore;

  const resolved = preferenceOwnerFromUnsubscribeToken(token, {
    purpose,
    now: options.now,
    secret: options.secret,
  });
  if (!resolved.ok) {
    return { status: "rejected", reason: resolved.reason };
  }

  const email = await store.loadRecipientEmail(resolved.owner);
  if (!email) {
    return { status: "rejected", reason: "unknown_recipient" };
  }

  await store.writeEmailPreference(resolved.owner, resolved.category, enabled);

  return {
    status: "ok",
    subject: {
      category: resolved.category,
      categoryLabel: labelFor(resolved.category),
      email,
      enabled,
      // The undo exists because THIS request just turned the category off —
      // the one moment a re-enable is owed to the reader. The caller threads
      // it through its redirect into one confirmation render. Re-enabling
      // mints nothing: there is no "undo the undo" capability.
      undoToken:
        purpose === "disable"
          ? mintUndoToken(resolved.owner, resolved.category, options)
          : null,
    },
  };
}

/**
 * Turn one category's email OFF. The emailed link's capability, and the only
 * thing it can do.
 *
 * Reached from the confirmation page's button (a same-origin Server Action) and
 * from RFC 8058 one-click (a mail client's POST to the same URL the header
 * carries). Never from a GET.
 */
export function applyEmailOptOut(
  token: string,
  options: UnsubscribeOptions = {}
): Promise<UnsubscribeResult> {
  return applyEmailPreference(token, "disable", false, options);
}

/**
 * Turn one category's email back ON — the undo.
 *
 * Only an `enable` token opens here, and those are minted server-side when the
 * confirmation page renders after an opt-out, with a one-hour life. An emailed
 * link, however fresh, cannot re-subscribe anyone.
 */
export function applyEmailOptIn(
  token: string,
  options: UnsubscribeOptions = {}
): Promise<UnsubscribeResult> {
  return applyEmailPreference(token, "enable", true, options);
}
