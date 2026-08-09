import { AlertTriangle, BarChart3, Mail } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeliveryTotals } from "@/lib/communication/queries";

import {
  formatPercent,
  formatRatio,
  meterWidth,
  summarizeDelivery,
} from "./delivery-stats-presentation";

interface DeliveryOverviewProps {
  totals: DeliveryTotals;
}

/**
 * Church-wide delivery performance (COM-019).
 *
 * A server component: the figures are already resolved by the time they get
 * here, so there is nothing to hydrate. Every rate prints its denominator
 * beside it — a bare "48%" is not a number anyone can act on — and the meters
 * are drawn with the theme's own chart token, so they hold up in light and
 * dark without a second palette.
 */
export function DeliveryOverview({ totals }: DeliveryOverviewProps) {
  const overview = summarizeDelivery(totals);

  return (
    <Card data-testid="delivery-overview">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Delivery performance</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {overview.isEmpty
              ? "Across every message you send"
              : `Across ${overview.totals.messagesSent} sent message${
                  overview.totals.messagesSent === 1 ? "" : "s"
                } and ${overview.totals.recipients} recipient${
                  overview.totals.recipients === 1 ? "" : "s"
                }`}
          </p>
        </div>
        <BarChart3 className="text-muted-foreground h-4 w-4 shrink-0" />
      </CardHeader>
      <CardContent>
        {overview.isEmpty ? (
          <div
            className="flex flex-col items-center justify-center py-10 text-center"
            data-testid="delivery-overview-empty"
          >
            <Mail className="text-muted-foreground mb-3 h-8 w-8" />
            <p className="font-medium">No delivery data yet</p>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Send your first message and delivery, open and click rates will
              appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {overview.rates.map((rate) => (
              <div key={rate.key} data-testid={`delivery-rate-${rate.key}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium">{rate.label}</span>
                  <span
                    className="text-2xl font-bold tabular-nums"
                    data-testid={`delivery-rate-${rate.key}-percent`}
                  >
                    {formatPercent(rate.percent)}
                  </span>
                </div>
                <div
                  className="bg-muted mt-2 h-2 w-full overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  <div
                    className="bg-chart-2 h-full rounded-full"
                    style={{ width: `${meterWidth(rate.percent)}%` }}
                  />
                </div>
                <p
                  className="text-muted-foreground mt-1.5 text-xs tabular-nums"
                  data-testid={`delivery-rate-${rate.key}-ratio`}
                >
                  {formatRatio(rate)}
                </p>
              </div>
            ))}

            <div className="text-muted-foreground flex items-center gap-2 border-t pt-4 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="tabular-nums" data-testid="delivery-issues">
                {overview.issues} bounced or failed
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
