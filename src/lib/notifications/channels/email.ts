import { notificationBatchEmail } from "@/lib/email/templates/notification-batch";

import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "../categories";
import { mintUnsubscribeToken } from "./unsubscribe-token";

// ============================================================================
// The email channel (N-007, N-012, and the email half of N-003).
//
// Everything about how a dispatched notification LOOKS lives here or in the
// template it calls; everything about whether it may be sent, and how many
// times, lives in `../dispatch.ts`. The seam between them is
// `composeBatchEmail` — the dispatcher hands over a group and gets back one
// `OutboundEmail`, and it never learns what an unsubscribe token is.
//
// One group becomes ONE email. That is a correctness requirement, not a saving:
// twenty task notifications for one planter are twenty feed rows and one
// message, because twenty messages is the failure mode notifications are
// famous for (N-012).
//
// Every email carries an unsubscribe link, in the body AND in the
// `List-Unsubscribe` header. The header is what gives Gmail and Apple Mail
// their native unsubscribe control, which is both a compliance and a
// deliverability property: a reader who cannot find the link marks the message
// as spam instead, and that is far more expensive than the opt-out.
// ============================================================================

/** Where the unauthenticated opt-out mutation lives. */
export const UNSUBSCRIBE_PATH = "/api/notifications/unsubscribe";

/** Where that mutation sends the browser afterwards. */
export const UNSUBSCRIBE_CONFIRMATION_PATH = "/unsubscribe";

/** The full preference screen (N-006), linked from every email and the page. */
export const NOTIFICATION_PREFERENCES_PATH = "/settings";

/**
 * Absolute base for links that have to work from an inbox.
 *
 * A relative href is meaningless in an email, so this is not a nicety. The
 * localhost fallback matches `src/lib/communication/service.ts`, which builds
 * RSVP links the same way.
 */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

export function unsubscribeUrl(token: string, baseUrl?: string): string {
  return `${baseUrl ?? appBaseUrl()}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

export function notificationPreferencesUrl(baseUrl?: string): string {
  return `${baseUrl ?? appBaseUrl()}${NOTIFICATION_PREFERENCES_PATH}`;
}

// ----------------------------------------------------------------------------
// The provider seam
// ----------------------------------------------------------------------------

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Provider-side idempotency. Belt to the delivery index's braces: if the
   * function is killed after the provider accepted but before we settled the
   * row, the next attempt presents the same key and the provider dedupes.
   */
  idempotencyKey: string;
  /** Extra RFC headers — `List-Unsubscribe` today. */
  headers?: Record<string, string>;
}

export interface NotificationEmailRecipient {
  id: string;
  email: string;
  name: string | null;
}

/** The rendered copy of one notification. Written by its owning feature. */
export interface NotificationEmailItem {
  title: string;
  body: string;
}

// ----------------------------------------------------------------------------
// Subject
// ----------------------------------------------------------------------------

/**
 * The subject line for a group. One notification keeps its own title verbatim —
 * the caller wrote it and it is the most specific thing we could possibly say.
 * Several become a count, because "3 task updates" is what stops the inbox
 * looking like three separate events (N-012).
 */
export function batchSubject(
  category: NotificationCategory,
  items: readonly NotificationEmailItem[]
): string {
  if (items.length === 1) return items[0].title;
  const label = NOTIFICATION_CATEGORIES[category]?.label ?? category;
  return `${items.length} ${label.toLowerCase()} updates`;
}

// ----------------------------------------------------------------------------
// Composition
// ----------------------------------------------------------------------------

export interface ComposeBatchEmailOptions {
  /** Clock for the token's expiry. Injectable so the link is assertable. */
  now?: Date;
  /** Token secret override. Tests pass one; production reads the env. */
  secret?: string;
  /** Absolute base override. Tests pass one; production reads the env. */
  baseUrl?: string;
}

/**
 * Compose the one email a group becomes.
 *
 * It THROWS when a working unsubscribe link cannot be minted — which today
 * means `UNSUBSCRIBE_TOKEN_SECRET` is unset. That is deliberate and it is the
 * reason the dispatcher wraps this call: an email with a dead unsubscribe link
 * is a compliance failure that is invisible until someone complains, whereas a
 * failed delivery is visible in `notification_deliveries` the moment it
 * happens and retries itself once the variable is set.
 *
 * Escaping is React's, not ours. Caller-rendered `title`/`body` reach the
 * template as text nodes, so `<script>` is inert in the HTML part and verbatim
 * in the plain-text part, which is what each part wants.
 */
export async function composeBatchEmail(
  recipient: NotificationEmailRecipient,
  category: NotificationCategory,
  items: readonly NotificationEmailItem[],
  idempotencyKey: string,
  options: ComposeBatchEmailOptions = {}
): Promise<OutboundEmail> {
  const baseUrl = options.baseUrl ?? appBaseUrl();

  const token = mintUnsubscribeToken({
    userId: recipient.id,
    category,
    now: options.now,
    secret: options.secret,
  });
  const optOutUrl = unsubscribeUrl(token, baseUrl);

  const { html, text } = await notificationBatchEmail({
    recipientName: recipient.name,
    categoryLabel: NOTIFICATION_CATEGORIES[category]?.label ?? category,
    items: items.map((item) => ({ title: item.title, body: item.body })),
    unsubscribeUrl: optOutUrl,
    preferencesUrl: notificationPreferencesUrl(baseUrl),
  });

  return {
    to: recipient.email,
    subject: batchSubject(category, items),
    html,
    text,
    idempotencyKey,
    headers: {
      // No `List-Unsubscribe-Post`: RFC 8058 one-click is a cross-origin POST
      // with no `Origin` header, which `src/proxy.ts` rejects as CSRF. Offering
      // a one-click control that always fails is worse than offering the link
      // alone, so mail clients get the URL and use a GET.
      "List-Unsubscribe": `<${optOutUrl}>`,
    },
  };
}
