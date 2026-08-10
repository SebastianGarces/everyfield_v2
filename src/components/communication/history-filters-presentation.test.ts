import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCommunicationFilters } from "@/lib/validations/communication";

import type {
  HistoryChannelFilter,
  HistoryFilterSelection,
  HistoryStatusFilter,
} from "./history-filters-presentation";
import {
  buildHistoryFilterHref,
  buildHistoryFilterQuery,
  deriveHistoryFilterState,
  toChannelFilter,
  toStatusFilter,
} from "./history-filters-presentation";

// ----------------------------------------------------------------------------
// The history page renders its rows from `parseCommunicationFilters`. These
// tests pin the one property that matters for the controls: whatever the server
// decided to honour is exactly what the controls display. A filter the server
// threw away must not appear as selected, and must not raise a Clear button.
// ----------------------------------------------------------------------------

function state(query: string) {
  return deriveHistoryFilterState(new URLSearchParams(query));
}

// --- compile-time: only rendered options are constructible -------------------
// These declarations ARE the assertion — `@ts-expect-error` fails `pnpm
// typecheck` the moment an annotated line stops being an error. Widening the
// filter state back to `string` therefore breaks the build rather than waiting
// for a runtime test to notice.

const _valid: HistoryFilterSelection = {
  channel: "sms",
  status: "failed",
  search: "bbq",
};

// @ts-expect-error - a typo'd channel literal is not a rendered option
const _typoedChannel: HistoryChannelFilter = "smss";

// @ts-expect-error - the label casing is not the option value
const _typoedStatus: HistoryStatusFilter = "Failed";

// @ts-expect-error - a widened string must go through toChannelFilter first
const _widenedChannel: HistoryChannelFilter = String("sms");

// --- no filters -------------------------------------------------------------

test("an empty query selects the catch-all option in both dropdowns", () => {
  const derived = state("");

  assert.equal(derived.channel, "all");
  assert.equal(derived.status, "all");
  assert.equal(derived.search, "");
  assert.equal(derived.hasFilters, false);
});

// --- valid filters ----------------------------------------------------------

test("a valid channel renders as the selected option", () => {
  const derived = state("channel=sms");

  assert.equal(derived.channel, "sms");
  assert.equal(derived.status, "all");
  assert.equal(derived.hasFilters, true);
});

test("a valid status renders as the selected option", () => {
  const derived = state("status=failed");

  assert.equal(derived.status, "failed");
  assert.equal(derived.channel, "all");
  assert.equal(derived.hasFilters, true);
});

test("a search term counts as an active filter and is trimmed", () => {
  const derived = state("search=%20%20launch%20");

  assert.equal(derived.search, "launch");
  assert.equal(derived.hasFilters, true);
});

// --- invalid filters are shown as the server treated them: absent -----------

test("a hand-edited channel falls back to all channels, not a blank trigger", () => {
  const derived = state("channel=nonsense");

  assert.equal(derived.channel, "all");
  assert.equal(derived.hasFilters, false);
});

test("a hand-edited status falls back to all statuses, not a blank trigger", () => {
  const derived = state("status=definitely-not-a-status");

  assert.equal(derived.status, "all");
  assert.equal(derived.hasFilters, false);
});

test("a whitespace-only search is not an active filter", () => {
  const derived = state("search=%20%20%20");

  assert.equal(derived.search, "");
  assert.equal(derived.hasFilters, false);
});

test("an invalid filter does not raise Clear, but a valid sibling does", () => {
  const derived = state("channel=carrier-pigeon&status=sent");

  assert.equal(derived.channel, "all");
  assert.equal(derived.status, "sent");
  assert.equal(derived.hasFilters, true);
});

test("params the page does not filter on never raise Clear", () => {
  const derived = state("page=3&limit=50&utm_source=newsletter");

  assert.equal(derived.hasFilters, false);
});

// --- client and server derive from the same validated shape -----------------

test("repeated params collapse to the first value, as the server does", () => {
  const derived = state("channel=sms&channel=email");

  assert.equal(derived.channel, "sms");
  assert.equal(
    derived.channel,
    parseCommunicationFilters({ channel: ["sms", "email"] }).channel
  );
});

// --- the write path rebuilds the URL from validated state --------------------
// The regression these pin: a filter change must not copy the incoming query
// string. Whatever the server refused to honour has to be gone from the pushed
// URL, so a copied or bookmarked link carries only filters that are real.

const HISTORY_PATH = "/communication/history";

/** Push a change on top of whatever `query` derives to, as the control does. */
function push(query: string, patch: Partial<HistoryFilterSelection>) {
  const current = state(query);
  return buildHistoryFilterHref(HISTORY_PATH, {
    channel: current.channel,
    status: current.status,
    search: current.search,
    ...patch,
  });
}

test("picking a status from a junk URL drops the junk channel", () => {
  const href = push("channel=nonsense&status=garbage", { status: "failed" });

  assert.equal(href, `${HISTORY_PATH}?status=failed`);
});

test("picking a status keeps a channel the server did honour", () => {
  const href = push("channel=sms", { status: "sent" });

  assert.equal(href, `${HISTORY_PATH}?channel=sms&status=sent`);
});

test("a filter change drops the page offset and unrelated params", () => {
  const href = push("page=4&limit=50&utm_source=newsletter&channel=email", {
    status: "draft",
  });

  assert.equal(href, `${HISTORY_PATH}?channel=email&status=draft`);
});

test("clearing every filter pushes the bare pathname", () => {
  const href = push("channel=email&status=sent&search=bbq", {
    channel: "all",
    status: "all",
    search: "",
  });

  assert.equal(href, HISTORY_PATH);
});

test("selecting the catch-all option removes only that param", () => {
  const href = push("channel=email&status=sent", { channel: "all" });

  assert.equal(href, `${HISTORY_PATH}?status=sent`);
});

test("the pushed search term is trimmed, and blank search is no param", () => {
  assert.equal(
    buildHistoryFilterQuery({
      channel: "all",
      status: "all",
      search: "  bbq ",
    }),
    "search=bbq"
  );
  assert.equal(
    buildHistoryFilterQuery({ channel: "all", status: "all", search: "   " }),
    ""
  );
});

test("the pushed query uses the same field order as the server's pageHref", () => {
  assert.equal(
    buildHistoryFilterQuery({ channel: "both", status: "sent", search: "bbq" }),
    "channel=both&status=sent&search=bbq"
  );
});

test("a search term is url-encoded, not concatenated raw", () => {
  const href = push("", { search: "picnic & bbq" });

  assert.equal(href, `${HISTORY_PATH}?search=picnic+%26+bbq`);
  assert.equal(
    new URL(href, "https://example.test").searchParams.get("search"),
    "picnic & bbq"
  );
});

test("every pushed URL survives a round trip through the server parse", () => {
  const queries = [
    "channel=nonsense&status=garbage",
    "channel=email",
    "status=sent&search=bbq",
    "channel=x&status=y&search=%20",
    "page=9",
  ];

  for (const query of queries) {
    const href = push(query, { status: "failed" });
    const pushed = new URL(href, "https://example.test").searchParams;
    const before = state(query);
    const after = deriveHistoryFilterState(pushed);

    // The rebuilt URL is a fixed point: re-deriving it changes nothing, so the
    // URL and the rendered controls cannot drift apart.
    assert.equal(after.channel, before.channel, query);
    assert.equal(after.status, "failed", query);
    assert.equal(after.search, before.search, query);
    assert.equal(buildHistoryFilterQuery(after), pushed.toString(), query);
  }
});

// --- Select payloads re-enter the union through a guard ----------------------

test("a Select payload outside the rendered options degrades to all", () => {
  assert.equal(toChannelFilter("sms"), "sms");
  assert.equal(toChannelFilter("all"), "all");
  assert.equal(toChannelFilter("carrier-pigeon"), "all");

  assert.equal(toStatusFilter("failed"), "failed");
  assert.equal(toStatusFilter("all"), "all");
  assert.equal(toStatusFilter("definitely-not-a-status"), "all");
});

test("a narrowed junk payload pushes no param at all", () => {
  const href = push("", { channel: toChannelFilter("carrier-pigeon") });

  assert.equal(href, HISTORY_PATH);
});

test("the controls agree with the server for every query string", () => {
  const queries = [
    "",
    "channel=email",
    "channel=nonsense",
    "status=draft",
    "status=nope",
    "search=picnic",
    "search=%20%20",
    "channel=both&status=sent&search=bbq",
    "channel=x&status=y&search=%20",
  ];

  for (const query of queries) {
    const derived = state(query);
    const params = new URLSearchParams(query);
    const server = parseCommunicationFilters({
      channel: params.get("channel") ?? undefined,
      status: params.get("status") ?? undefined,
      search: params.get("search") ?? undefined,
    });

    assert.equal(derived.channel, server.channel ?? "all", query);
    assert.equal(derived.status, server.status ?? "all", query);
    assert.equal(derived.search, server.search ?? "", query);
    assert.equal(
      derived.hasFilters,
      Boolean(server.channel || server.status || server.search),
      query
    );
  }
});
