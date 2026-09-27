import assert from "node:assert/strict";
import test from "node:test";
import { historyFilterOptions } from "./history-options";
import {
  communicationChannels,
  communicationStatuses,
} from "@/db/schema/communication";
import {
  buildHistoryFilterHref,
  deriveHistoryFilterState,
} from "@/components/communication/history-filters-presentation";

const empty = { channels: [], statuses: [] };
test("empty and supported-only histories retain all supported options without deferred workflows", () => {
  for (const available of [
    empty,
    { channels: ["email" as const], statuses: ["logged" as const] },
  ]) {
    const options = historyFilterOptions(available, {});
    assert.deepEqual(
      options.channels.map((option) => option.value),
      ["email"]
    );
    assert.deepEqual(
      options.statuses.map((option) => option.value),
      ["sending", "sent", "failed", "logged"]
    );
    assert.ok(
      [...options.channels, ...options.statuses].every(
        (option) => !option.historical
      )
    );
  }
});
test("observed historical values remain selectable in canonical order and clearly labelled", () => {
  const options = historyFilterOptions(
    {
      channels: [...communicationChannels].reverse(),
      statuses: [...communicationStatuses].reverse(),
    },
    {}
  );
  assert.deepEqual(
    options.channels.map((option) => option.value),
    communicationChannels
  );
  assert.deepEqual(
    options.statuses.map((option) => option.value),
    communicationStatuses
  );
  assert.equal(
    options.channels.find((option) => option.value === "sms")?.label,
    "SMS (historical)"
  );
  assert.equal(
    options.statuses.find((option) => option.value === "scheduled")?.label,
    "Scheduled (historical)"
  );
});
test("a narrowed or empty result does not remove historical choices supplied by whole-history availability", () => {
  const options = historyFilterOptions(
    { channels: ["both"], statuses: ["draft"] },
    { channel: "email", status: "failed" }
  );
  assert.deepEqual(
    options.channels.map((option) => option.value),
    ["email", "both"]
  );
  assert.deepEqual(
    options.statuses.map((option) => option.value),
    ["draft", "sending", "sent", "failed", "logged"]
  );
});
test("historical URL choices survive an empty history and clear through the canonical URL builder", () => {
  const selection = deriveHistoryFilterState(
    new URLSearchParams("channel=sms&status=scheduled&page=4")
  );
  assert.equal(selection.channel, "sms");
  assert.equal(selection.status, "scheduled");
  const options = historyFilterOptions(empty, {
    channel: "sms",
    status: "scheduled",
  });
  assert.ok(
    options.channels.some(
      (option) => option.value === selection.channel && option.historical
    )
  );
  assert.ok(
    options.statuses.some(
      (option) => option.value === selection.status && option.historical
    )
  );
  assert.equal(
    buildHistoryFilterHref("/communication/history", {
      ...selection,
      status: "sent",
    }),
    "/communication/history?channel=sms&status=sent"
  );
  assert.equal(
    buildHistoryFilterHref("/communication/history", {
      channel: "all",
      status: "all",
      search: "",
    }),
    "/communication/history"
  );
});
test("historical choices are limited to available or selected values, with no duplicate options", () => {
  const options = historyFilterOptions(
    { channels: ["sms", "sms"], statuses: ["draft", "draft"] },
    { channel: "sms", status: "draft" }
  );
  assert.deepEqual(
    options.channels.map((option) => option.value),
    ["email", "sms"]
  );
  assert.ok(!options.statuses.some((option) => option.value === "scheduled"));
});
