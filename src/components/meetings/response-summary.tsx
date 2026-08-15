import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RESPONSE_NOT_RECORDED_COPY,
  RESPONSE_NOT_RECORDED_LABEL,
  RESPONSE_SUMMARY_EMPTY_COPY,
  type ResponseBreakdown,
} from "@/lib/meetings/response-card";

// ============================================================================
// VM-014 — the Outcomes breakdown.
//
// A SERVER component with no state and no handlers. The figures are computed on
// the server by `getMeetingResponseBreakdown`, so there is nothing here to
// synchronise: no server data in `useState`, no `useEffect`
// (memory/contracts/data-patterns.md). Capture lives on the Attendance tab,
// where the planter has the cards in their hand; this only reads.
//
// TWO POPULATIONS, SAID SEPARATELY. The bars are the cards that came BACK, and
// their percentages are shares of that. Attendees who handed nothing in are a
// line of their own below, with a sentence saying it is not a refusal. Folding
// the second into the first would report a silence as a no — the exact thing
// VM-014's acceptance criterion forbids, and the reason a planter can trust the
// "ready to commit" number at all.
// ============================================================================

interface ResponseSummaryProps {
  breakdown: ResponseBreakdown;
}

/** The share of the widest row, so the bars scale to the meeting they describe. */
function barWidth(count: number, peak: number): string {
  if (peak <= 0) return "0%";
  return `${Math.max((count / peak) * 100, count > 0 ? 4 : 0)}%`;
}

export function ResponseSummary({ breakdown }: ResponseSummaryProps) {
  const { rows, recordedCount, notRecordedCount, attendeeCount } = breakdown;
  const peak = rows.reduce((widest, row) => Math.max(widest, row.count), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Response cards</CardTitle>
        {/* Say what the figures count, on the same rule as the analytics
            scope line: an unlabelled "4" beside "Ready to commit" looks like a
            claim about the whole room. */}
        <p
          className="text-muted-foreground text-sm"
          data-testid="response-scope"
        >
          {recordedCount === 0
            ? `${attendeeCount} ${attendeeCount === 1 ? "attendee" : "attendees"} marked here.`
            : `${recordedCount} of ${attendeeCount} ${
                attendeeCount === 1 ? "attendee" : "attendees"
              } handed a card in.`}
        </p>
      </CardHeader>

      <CardContent>
        {recordedCount === 0 ? (
          <p
            className="text-muted-foreground py-6 text-center text-sm"
            data-testid="response-summary-empty"
          >
            {RESPONSE_SUMMARY_EMPTY_COPY}
          </p>
        ) : (
          <dl className="space-y-4" data-testid="response-breakdown">
            {rows.map((row) => (
              <div key={row.value} data-testid={`response-row-${row.value}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm font-medium">{row.label}</dt>
                  <dd className="text-sm tabular-nums">
                    <span className="font-medium">{row.count}</span>
                    {/* A share with a zero denominator is unknown, never 0% —
                        and `share` is already null in that case, so the whole
                        clause disappears rather than claiming anything. */}
                    {row.share !== null && (
                      <span className="text-muted-foreground ml-2">
                        {row.share}%
                      </span>
                    )}
                  </dd>
                </div>
                {/* Decorative: every number the bar encodes is already read out
                    above it, so announcing it again is noise. */}
                <div
                  className="bg-muted mt-1.5 h-2 w-full overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: barWidth(row.count, peak) }}
                  />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.description}
                </p>
              </div>
            ))}
          </dl>
        )}

        {notRecordedCount > 0 && (
          <div
            className="mt-6 border-t pt-4"
            data-testid="response-not-recorded"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium">
                {RESPONSE_NOT_RECORDED_LABEL}
              </span>
              <span className="text-sm tabular-nums">{notRecordedCount}</span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {RESPONSE_NOT_RECORDED_COPY}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
