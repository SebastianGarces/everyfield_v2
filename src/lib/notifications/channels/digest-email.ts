import { digestEmail } from "@/lib/email/templates/digest";

import { digestLinesFromBody } from "../digest";

import {
  appBaseUrl,
  batchSubject,
  notificationPreferencesUrl,
  unsubscribeUrl,
  type ComposeBatchEmailOptions,
  type NotificationEmailItem,
  type NotificationEmailRecipient,
  type OutboundEmail,
} from "./email";
import { mintUnsubscribeToken } from "./unsubscribe-token";
import type { NotificationCategory } from "../categories";

// ============================================================================
// The planter digest's email face (N-013).
//
// It sits BESIDE `./email.ts` rather than in `../digest.ts`, and the placement
// is a rule rather than taste. Two of them, in fact:
//
//   1. `./email.ts` already says it: everything about how a dispatched
//      notification LOOKS lives in this directory or in the template it calls,
//      and everything about whether it may be sent lives in `../dispatch.ts`.
//      A second composer belongs where the first one is.
//
//   2. `enqueue.test.ts` guards N-002 by scanning `src/lib/notifications/*.ts`
//      for a module that reaches `@/lib/email`, and allows exactly one:
//      `dispatch.ts`. That guard is what stops a second send path appearing, so
//      it must not be widened for a module that merely renders — and it is
//      scoped to the top level precisely because composition lives one directory
//      down.
//
// So `../digest.ts` owns WHAT the digest says and this file owns WHAT IT LOOKS
// LIKE, with `digestLinesFromBody` as the seam between them.
// ============================================================================

/**
 * Compose the digest email for a dispatched group.
 *
 * Signature-compatible with `composeBatchEmail`, because `../dispatch.ts`
 * selects between them by notification `type` and both have to be the same kind
 * of thing (`GroupEmailComposer` there).
 *
 * It THROWS when a working unsubscribe link cannot be minted, exactly as
 * `composeBatchEmail` does and for the same reason: an email with a dead
 * unsubscribe link is a compliance failure that is invisible until somebody
 * complains, and the dispatcher already contains that throw as a retryable
 * delivery failure.
 *
 * The structure the template renders is recovered from each row's stored body
 * through `digestLinesFromBody` — the exact inverse of the composer that wrote
 * it. A body this product did not write resolves to no lines, so the email
 * degrades to a heading and the primary call to action rather than to a wrong
 * link.
 */
export async function composePlanterDigestEmail(
  recipient: NotificationEmailRecipient,
  category: NotificationCategory,
  items: readonly NotificationEmailItem[],
  idempotencyKey: string,
  options: ComposeBatchEmailOptions = {}
): Promise<OutboundEmail> {
  const baseUrl = options.baseUrl ?? appBaseUrl();

  // DISABLE-only, like every other dispatched email: what goes in an inbox can
  // never re-subscribe anyone.
  const token = mintUnsubscribeToken({
    userId: recipient.id,
    category,
    purpose: "disable",
    now: options.now,
    secret: options.secret,
  });
  const optOutUrl = unsubscribeUrl(token, baseUrl);

  const sections = items
    .flatMap((item) => digestLinesFromBody(item.body))
    .map((line) => ({
      text: line.text,
      href: `${baseUrl}${line.path}`,
      linkLabel: line.linkLabel,
    }));

  const { html, text } = await digestEmail({
    recipientName: recipient.name,
    heading: items[0]?.title ?? "What needs your attention",
    sections,
    dashboardUrl: `${baseUrl}/dashboard`,
    unsubscribeUrl: optOutUrl,
    preferencesUrl: notificationPreferencesUrl(baseUrl),
  });

  return {
    to: recipient.email,
    // The SUBJECT stays `batchSubject`'s, so the dispatcher's grouping decision
    // and the inbox agree however many rows a group turns out to hold.
    subject: batchSubject(category, items),
    html,
    text,
    idempotencyKey,
    headers: {
      // RFC 8058, the same pair every dispatched email carries. See
      // `./email.ts` for why the two headers only mean anything together.
      "List-Unsubscribe": `<${optOutUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
