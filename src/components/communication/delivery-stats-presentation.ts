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

import type {
  DeliveryTotals,
  MessageDeliveryStats,
} from "@/lib/communication/queries";

export type { DeliveryTotals, MessageDeliveryStats };

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

// ---------------------------------------------------------------------------
// One message's tiles
// ---------------------------------------------------------------------------

export type MessageTileKey = "sent" | "delivered" | "opened" | "issues";

export interface MessageTile {
  key: MessageTileKey;
  label: string;
  /** The headline figure — always a count on these tiles, never a rate. */
  value: number;
  /** What the count is out of, shown under it. */
  caption: string;
}

/**
 * The four tiles above one message's recipient table.
 *
 * Every headline here is a COUNT of recipient rows, and every caption names
 * the denominator. That is the ruling of 2026-08-09 (PR #371): the tile that
 * used to read "60% delivery rate" measured `delivered / all recipient rows`,
 * while the church-wide overview measures `delivered / attempted` and calls
 * that the delivery rate. Two different divisions one click apart, under one
 * name. The rate now lives only on the overview; this page reports the counts
 * it actually holds, so the two can never be read as the same figure.
 *
 * Opens keep a percentage because that division IS the overview's — opened
 * over delivered — and an unknown rate stays unknown rather than becoming 0%.
 */
export function summarizeMessageDelivery(
  stats: MessageDeliveryStats
): MessageTile[] {
  const openPercent = toPercent(stats.opened, stats.delivered);

  return [
    {
      key: "sent",
      label: "Sent",
      value: stats.sent,
      caption: `of ${stats.total} recipients`,
    },
    {
      key: "delivered",
      label: "Delivered",
      value: stats.delivered,
      caption: `of ${stats.total} recipients`,
    },
    {
      key: "opened",
      label: "Opened",
      value: stats.opened,
      caption:
        openPercent === null
          ? "nothing delivered yet"
          : `${openPercent}% of ${stats.delivered} delivered`,
    },
    {
      key: "issues",
      label: "Issues",
      value: stats.bounced + stats.failed,
      caption: "bounced or failed",
    },
  ];
}
