import { notificationBatchEmail } from "@/lib/email/templates/notification-batch";
import { settingsSectionUrl } from "@/lib/settings/sections";

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
//
// It also carries `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC
// 8058, ruled 2026-08-01). The two headers are a pair and the pair is the whole
// point of the ruling: the URL's GET now only RENDERS a confirmation page, so a
// mail scanner that fetches every link in a message cannot opt anyone out — and
// a real mail client keeps its frictionless one-click by POSTing to the same
// URL instead. Deliverability and consent integrity in one move.
// ============================================================================

/**
 * The unsubscribe endpoint. One URL, two methods, as RFC 8058 requires:
 * GET renders the confirmation page (no mutation, ever), POST is one-click.
 */
export const UNSUBSCRIBE_PATH = "/api/notifications/unsubscribe";

/** The confirmation page the GET renders — and where the button posts from. */
export const UNSUBSCRIBE_CONFIRMATION_PATH = "/unsubscribe";

/**
 * The full preference screen (N-006), linked from every email and from
 * /unsubscribe.
 *
 * A PATH AND A FRAGMENT NAMING THE SECTION (#657, ruled 2026-08-22, which
 * reverses the "real paths, never a hash" half of 2026-08-21 §187). Settings is
 * client state over the current screen, so the section is named where the client
 * can read it and the path is the screen it opens over.
 *
 * It is NOT the `/settings#notification-preferences` of #467, which pointed a
 * browser at an `<h2 id>` to scroll to on a long page. Nothing here scrolls to
 * anything: the modal parses this fragment and opens on the section, so there is
 * still no heading anchor in the product to keep in step with a link.
 *
 * Mail already in the wild carries `/settings/notifications`, which
 * `src/app/(dashboard)/settings/[section]/page.tsx` permanently redirects
 * straight here. Older mail still carries #467's fragment, which resolves to
 * `/settings` and lands one section off, on Account — never a dead link.
 */
export const NOTIFICATION_PREFERENCES_PATH =
  settingsSectionUrl("notifications");

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
 * Several become a count, because one line naming three things is what stops
 * the inbox looking like three separate events (N-012).
 *
 * The shape is `Tasks — 3 updates` (ruled 2026-08-01). The obvious
 * `${count} ${label} updates` reads "3 tasks updates", because the registry's
 * labels are already plural, and the fix is not to add a singular form per
 * category: leading with the label sidesteps pluralisation entirely and forever
 * — a seventh category needs no grammar. It also scans better in a crowded
 * inbox, where the first word is the only one a reader is guaranteed to see.
 */
export function batchSubject(
  category: NotificationCategory,
  items: readonly NotificationEmailItem[]
): string {
  if (items.length === 1) return items[0].title;
  const label = NOTIFICATION_CATEGORIES[category]?.label ?? category;
  return `${label} — ${items.length} updates`;
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

  // DISABLE-only, explicitly. What goes in an inbox can never re-subscribe
  // anyone — the undo is minted on the confirmation page instead.
  const token = mintUnsubscribeToken({
    userId: recipient.id,
    category,
    purpose: "disable",
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
      // RFC 8058. The two headers only mean anything together: the first names
      // the URL, the second promises that POSTing `List-Unsubscribe=One-Click`
      // to it opts the reader out without a round trip through a page.
      //
      // That POST is cross-origin and carries no `Origin` header by spec, so
      // `src/proxy.ts` exempts this ONE path from its CSRF check — the same
      // exemption `/api/webhooks/resend` has, and for the same reason: the
      // request authenticates itself (a sealed capability token here, a
      // signature there) rather than by being same-origin.
      "List-Unsubscribe": `<${optOutUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
