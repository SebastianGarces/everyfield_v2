import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCommunicationFilters } from "@/lib/validations/communication";

import { deriveHistoryFilterState } from "./history-filters-presentation";

// ----------------------------------------------------------------------------
// The history page renders its rows from `parseCommunicationFilters`. These
// tests pin the one property that matters for the controls: whatever the server
// decided to honour is exactly what the controls display. A filter the server
// threw away must not appear as selected, and must not raise a Clear button.
// ----------------------------------------------------------------------------

function state(query: string) {
  return deriveHistoryFilterState(new URLSearchParams(query));
}

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
