import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseCommunicationFilters,
  createTemplateSchema,
  updateTemplateSchema,
} from "./communication";

// ----------------------------------------------------------------------------
// The message-history URL is user-editable and bookmarkable, so parsing must be
// total: any garbage in the query string degrades to "no such filter" instead
// of a 500. These tests pin that contract.
// ----------------------------------------------------------------------------

// --- valid input ------------------------------------------------------------

test("reads channel, status and search from the query string", () => {
  const filters = parseCommunicationFilters({
    channel: "sms",
    status: "failed",
    search: "launch",
  });

  assert.equal(filters.channel, "sms");
  assert.equal(filters.status, "failed");
  assert.equal(filters.search, "launch");
});

test("defaults to the first page and a 20-row limit", () => {
  const filters = parseCommunicationFilters({});

  assert.equal(filters.page, 1);
  assert.equal(filters.limit, 20);
  assert.equal(filters.channel, undefined);
  assert.equal(filters.status, undefined);
  assert.equal(filters.search, undefined);
});

test("coerces a numeric page from its string form", () => {
  assert.equal(parseCommunicationFilters({ page: "3" }).page, 3);
});

// --- invalid input is ignored, never thrown ---------------------------------

test("an unknown channel is ignored, not fatal", () => {
  const filters = parseCommunicationFilters({ channel: "carrier-pigeon" });

  assert.equal(filters.channel, undefined);
});

test("an unknown status is ignored, not fatal", () => {
  assert.equal(
    parseCommunicationFilters({ status: "definitely-not-a-status" }).status,
    undefined
  );
});

test("one bad filter does not discard the good ones", () => {
  const filters = parseCommunicationFilters({
    channel: "nope",
    status: "sent",
    search: "picnic",
  });

  assert.equal(filters.channel, undefined);
  assert.equal(filters.status, "sent");
  assert.equal(filters.search, "picnic");
});

test("a non-numeric page falls back to page 1", () => {
  assert.equal(parseCommunicationFilters({ page: "banana" }).page, 1);
});

test("a zero or negative page falls back to page 1", () => {
  assert.equal(parseCommunicationFilters({ page: "0" }).page, 1);
  assert.equal(parseCommunicationFilters({ page: "-4" }).page, 1);
});

test("an oversized limit falls back to the default rather than the max", () => {
  assert.equal(parseCommunicationFilters({ limit: "5000" }).limit, 20);
});

test("an empty or whitespace-only search is not a filter", () => {
  assert.equal(parseCommunicationFilters({ search: "" }).search, undefined);
  assert.equal(parseCommunicationFilters({ search: "   " }).search, undefined);
});

test("a search term is trimmed", () => {
  assert.equal(parseCommunicationFilters({ search: "  bbq " }).search, "bbq");
});

// --- shape of Next.js searchParams ------------------------------------------

test("repeated params collapse to the first value", () => {
  const filters = parseCommunicationFilters({ channel: ["sms", "email"] });

  assert.equal(filters.channel, "sms");
});

test("unrelated params are ignored", () => {
  const filters = parseCommunicationFilters({
    utm_source: "newsletter",
    channel: "email",
  });

  assert.equal(filters.channel, "email");
});

test("custom template validation rejects blank visible content and preserves rich merge tokens", () => {
  const input = {
    name: "Welcome",
    category: "other",
    channel: "email",
    subject: "Hi {{first_name}}",
    body: "<p><strong>Welcome</strong> {{first_name}}</p>",
  };
  for (const body of [
    "",
    "  ",
    "<p><br></p>",
    "<p>&nbsp;</p>",
    "<script>alert(1)</script>",
    "<style>body{color:red}</style>",
  ]) {
    assert.equal(
      createTemplateSchema.safeParse({ ...input, body }).success,
      false
    );
    assert.equal(updateTemplateSchema.safeParse({ body }).success, false);
  }
  assert.equal(
    createTemplateSchema.safeParse({ ...input, name: "  " }).success,
    false
  );
  assert.equal(createTemplateSchema.parse(input).body, input.body);
  assert.equal(
    createTemplateSchema.parse({ ...input, name: " Welcome " }).name,
    "Welcome"
  );
});

test("template boundary schemas strip forged tenancy and system metadata but preserve authorized content", () => {
  const attack = {
    name: "Custom",
    category: "announcement",
    channel: "email",
    body: "Hello",
    churchId: "foreign",
    isSystem: true,
    sourceTemplateId: "foreign-source",
  };
  const expected = {
    name: "Custom",
    category: "announcement",
    channel: "email",
    body: "Hello",
  };
  assert.deepEqual(createTemplateSchema.parse(attack), expected);
  assert.deepEqual(updateTemplateSchema.parse(attack), expected);
  assert.deepEqual(updateTemplateSchema.parse({ subject: "Corrected" }), {
    subject: "Corrected",
  });
});
