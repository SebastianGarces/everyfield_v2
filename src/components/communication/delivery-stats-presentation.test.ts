import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeliveryTotals } from "@/lib/communication/queries";

import {
  EMPTY_RATE,
  formatPercent,
  formatRatio,
  meterWidth,
  summarizeDelivery,
  summarizeMessageDelivery,
  toPercent,
  type MessageDeliveryStats,
  type MessageTileKey,
} from "./delivery-stats-presentation";

// ----------------------------------------------------------------------------
// Rates are the one place this feature can lie. A church that has sent nothing
// divides by zero; rendered raw that reaches the DOM as "NaN%", and "fixed" by
// a naive `|| 0` it reads as "0% open rate", which is a claim about a thing
// that never happened. These tests pin the third answer: unknown, shown as an
// em dash, with the denominator always beside the figure.
// ----------------------------------------------------------------------------

function totals(overrides: Partial<DeliveryTotals> = {}): DeliveryTotals {
  return {
    messagesSent: 0,
    recipients: 0,
    attempted: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
    ...overrides,
  };
}

// --- toPercent --------------------------------------------------------------

test("a zero denominator is unknown, not zero", () => {
  assert.equal(toPercent(0, 0), null);
  assert.equal(toPercent(5, 0), null);
});

test("a negative denominator is unknown too", () => {
  assert.equal(toPercent(1, -1), null);
});

test("a non-finite input never becomes NaN%", () => {
  assert.equal(toPercent(Number.NaN, 10), null);
  assert.equal(toPercent(1, Number.POSITIVE_INFINITY), null);
});

test("rates round to whole percents", () => {
  assert.equal(toPercent(1, 3), 33);
  assert.equal(toPercent(2, 3), 67);
  assert.equal(toPercent(50, 50), 100);
  assert.equal(toPercent(0, 50), 0);
});

// --- formatting -------------------------------------------------------------

test("an unknown rate renders as an em dash, never 0%", () => {
  assert.equal(formatPercent(null), EMPTY_RATE);
  assert.notEqual(formatPercent(null), "0%");
});

test("a known rate renders with a percent sign", () => {
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(48), "48%");
});

test("every rate prints its denominator", () => {
  const overview = summarizeDelivery(
    totals({ recipients: 50, attempted: 50, delivered: 40, opened: 20 })
  );
  const delivered = overview.rates.find((r) => r.key === "delivered");
  const opened = overview.rates.find((r) => r.key === "opened");

  assert.equal(formatRatio(delivered!), "40 of 50 sent");
  assert.equal(formatRatio(opened!), "20 of 40 delivered");
});

// --- meter width ------------------------------------------------------------

test("an unknown rate draws no bar", () => {
  assert.equal(meterWidth(null), 0);
});

test("a bar can never overflow its track", () => {
  assert.equal(meterWidth(150), 100);
  assert.equal(meterWidth(-10), 0);
  assert.equal(meterWidth(62), 62);
});

// --- summarizeDelivery ------------------------------------------------------

test("a church that never sent anything is empty, not zeroed", () => {
  const overview = summarizeDelivery(totals());

  assert.equal(overview.isEmpty, true);
  for (const rate of overview.rates) {
    assert.equal(rate.percent, null, `${rate.key} should be unknown`);
    assert.equal(formatPercent(rate.percent), EMPTY_RATE);
  }
});

test("a church with sent messages but no recipient rows is still empty", () => {
  // Every recipient lacked an address: the message exists, nothing left.
  const overview = summarizeDelivery(totals({ messagesSent: 2 }));

  assert.equal(overview.isEmpty, true);
});

test("one delivered recipient is enough to leave the empty state", () => {
  const overview = summarizeDelivery(
    totals({ messagesSent: 1, recipients: 1, attempted: 1, delivered: 1 })
  );

  assert.equal(overview.isEmpty, false);
});

test("delivered is rated against what was attempted, not against pending rows", () => {
  // 10 recipients, 2 never left the queue, 6 of the 8 attempts arrived.
  const overview = summarizeDelivery(
    totals({ recipients: 10, attempted: 8, delivered: 6 })
  );
  const delivered = overview.rates.find((r) => r.key === "delivered")!;

  assert.equal(delivered.denominator, 8);
  assert.equal(delivered.percent, 75);
});

test("opens and clicks are rated against what was delivered", () => {
  const overview = summarizeDelivery(
    totals({
      recipients: 100,
      attempted: 100,
      delivered: 80,
      opened: 40,
      clicked: 8,
    })
  );
  const opened = overview.rates.find((r) => r.key === "opened")!;
  const clicked = overview.rates.find((r) => r.key === "clicked")!;

  assert.equal(opened.percent, 50);
  assert.equal(clicked.percent, 10);
  assert.equal(opened.denominatorLabel, "delivered");
  assert.equal(clicked.denominatorLabel, "delivered");
});

test("a send where nothing was delivered leaves the open rate unknown", () => {
  // All eight bounced. "0% open rate" would blame the message; the truth is
  // that no message ever arrived to be opened.
  const overview = summarizeDelivery(
    totals({ recipients: 8, attempted: 8, delivered: 0, bounced: 8 })
  );
  const opened = overview.rates.find((r) => r.key === "opened")!;

  assert.equal(opened.percent, null);
  assert.equal(overview.issues, 8);
});

test("issues add bounced and failed together", () => {
  const overview = summarizeDelivery(
    totals({ recipients: 10, attempted: 10, bounced: 3, failed: 2 })
  );

  assert.equal(overview.issues, 5);
});

test("the three rates come back in funnel order", () => {
  const overview = summarizeDelivery(totals({ recipients: 1, attempted: 1 }));

  assert.deepEqual(
    overview.rates.map((r) => r.key),
    ["delivered", "opened", "clicked"]
  );
});

// --- summarizeMessageDelivery -----------------------------------------------
//
// Ruled 2026-08-09 (PR #371). One message's "Delivered" tile used to caption
// itself "60% delivery rate", dividing by every recipient row; the church-wide
// card calls `delivered / attempted` the delivery rate. Same name, different
// division, one click apart. The tile now reports the count it holds, with the
// denominator spelled out, and claims no rate at all.

function messageStats(
  overrides: Partial<MessageDeliveryStats> = {}
): MessageDeliveryStats {
  return {
    total: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
    ...overrides,
  };
}

function tile(stats: MessageDeliveryStats, key: MessageTileKey) {
  return summarizeMessageDelivery(stats).find((t) => t.key === key)!;
}

test("the delivered tile is a count of recipients, not a delivery rate", () => {
  const delivered = tile(
    messageStats({ total: 10, sent: 8, delivered: 6 }),
    "delivered"
  );

  assert.equal(delivered.label, "Delivered");
  assert.equal(delivered.value, 6);
  assert.equal(delivered.caption, "of 10 recipients");
});

test("no tile on a single message calls itself a delivery rate", () => {
  const tiles = summarizeMessageDelivery(
    messageStats({ total: 10, sent: 10, delivered: 6, opened: 3 })
  );

  for (const t of tiles) {
    assert.doesNotMatch(
      t.caption,
      /delivery rate/i,
      `${t.key} must not claim a delivery rate`
    );
  }
});

test("the four tiles come back in funnel order", () => {
  assert.deepEqual(
    summarizeMessageDelivery(messageStats()).map((t) => t.key),
    ["sent", "delivered", "opened", "issues"]
  );
});

test("the sent tile counts attempts against every recipient row", () => {
  const sent = tile(messageStats({ total: 10, sent: 8 }), "sent");

  assert.equal(sent.value, 8);
  assert.equal(sent.caption, "of 10 recipients");
});

test("the open rate on one message divides by delivered, like the overview", () => {
  const opened = tile(
    messageStats({ total: 10, sent: 10, delivered: 8, opened: 4 }),
    "opened"
  );

  assert.equal(opened.value, 4);
  assert.equal(opened.caption, "50% of 8 delivered");
});

test("a message with nothing delivered shows no open rate at all", () => {
  // "0% open rate" would blame the message for a delivery that never happened.
  const opened = tile(
    messageStats({ total: 4, sent: 4, delivered: 0, bounced: 4 }),
    "opened"
  );

  assert.doesNotMatch(opened.caption, /%/);
  assert.equal(opened.caption, "nothing delivered yet");
});

test("the issues tile adds bounced and failed", () => {
  const issues = tile(
    messageStats({ total: 10, sent: 10, bounced: 2, failed: 1 }),
    "issues"
  );

  assert.equal(issues.value, 3);
  assert.equal(issues.caption, "bounced or failed");
});
