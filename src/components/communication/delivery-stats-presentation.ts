// ============================================================================
// Delivery Stats Presentation (COM-019)
// ============================================================================
//
// The arithmetic behind the delivery overview, kept as pure functions so the
// division that turns counts into rates can be tested without a database or a
// renderer. A rate whose denominator is zero is UNKNOWN, not zero: an empty
// church that reads "0% open rate" is being told something false, and `0/0`
// rendered raw is `NaN%`. Every rate here therefore carries its denominator,
// and `null` is the honest answer.
// ============================================================================

import type { DeliveryTotals } from "@/lib/communication/queries";

export type { DeliveryTotals };

export type DeliveryRateKey = "delivered" | "opened" | "clicked";

export interface DeliveryRate {
  key: DeliveryRateKey;
  label: string;
  numerator: number;
  denominator: number;
  /** What the denominator counts, e.g. "sent" — rendered beside the figure. */
  denominatorLabel: string;
  /** Whole percent, or `null` when the denominator is zero. */
  percent: number | null;
}

export interface DeliveryOverview {
  totals: DeliveryTotals;
  rates: DeliveryRate[];
  /** Bounced plus failed — the one figure that is a count, not a rate. */
  issues: number;
  /**
   * True when nothing has ever been sent to anybody. The caller shows an empty
   * state instead of a wall of zeroes.
   */
  isEmpty: boolean;
}

export const EMPTY_RATE = "—";

/**
 * Whole-percent rate, or `null` when there is nothing to divide by. Guards the
 * non-finite inputs too, so a bad count can never reach the DOM as `NaN%`.
 */
export function toPercent(
  numerator: number,
  denominator: number
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/** `"62%"`, or an em dash when the rate is unknown. */
export function formatPercent(percent: number | null): string {
  return percent === null ? EMPTY_RATE : `${percent}%`;
}

/** `"31 of 50 sent"` — the denominator stays visible next to every rate. */
export function formatRatio(rate: DeliveryRate): string {
  return `${rate.numerator} of ${rate.denominator} ${rate.denominatorLabel}`;
}

/**
 * Bar width for a rate meter. Clamped to 0–100 so a figure that somehow
 * exceeds its denominator cannot overflow the track; the number beside it is
 * still reported unclamped, which is what makes the anomaly visible.
 */
export function meterWidth(percent: number | null): number {
  if (percent === null) return 0;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Turn the aggregate counts into the three rates the overview shows.
 *
 * Denominators follow the funnel rather than one shared total:
 *  - delivered is measured against what was ATTEMPTED, because a recipient row
 *    still pending was never given a chance to arrive;
 *  - opened and clicked are measured against what was DELIVERED, because a
 *    message that bounced cannot be opened and would otherwise drag the open
 *    rate down for a reason that has nothing to do with the message.
 */
export function summarizeDelivery(totals: DeliveryTotals): DeliveryOverview {
  const rates: DeliveryRate[] = [
    {
      key: "delivered",
      label: "Delivered",
      numerator: totals.delivered,
      denominator: totals.attempted,
      denominatorLabel: "sent",
      percent: toPercent(totals.delivered, totals.attempted),
    },
    {
      key: "opened",
      label: "Opened",
      numerator: totals.opened,
      denominator: totals.delivered,
      denominatorLabel: "delivered",
      percent: toPercent(totals.opened, totals.delivered),
    },
    {
      key: "clicked",
      label: "Clicked",
      numerator: totals.clicked,
      denominator: totals.delivered,
      denominatorLabel: "delivered",
      percent: toPercent(totals.clicked, totals.delivered),
    },
  ];

  return {
    totals,
    rates,
    issues: totals.bounced + totals.failed,
    // No recipient row means no message ever left for anyone — a draft-only or
    // brand-new church. Nothing here can be rated, so nothing is shown.
    isEmpty: totals.recipients === 0,
  };
}
