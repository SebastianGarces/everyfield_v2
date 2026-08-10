import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { toRichTextHtml } from "@/lib/rich-text/format";

import { MessageBody } from "./message-body";

// ----------------------------------------------------------------------------
// The message detail page is the last place a planter reads their own sent
// message, and it used to be the WORST corrupted of the three surfaces: the
// page sanitised the body and then handed it to this component, which sanitised
// it again — four passes over an escaping sanitiser in total. So this component
// owns the sanitise AND the merge substitution, and it runs each exactly once.
// These tests pin that: one pass, in the send path's order, on the raw stored
// body.
// ----------------------------------------------------------------------------

/** What a contentEditable serialises for: Bob & Sue <3  today */
const BROWSER_SERIALISED = `<p>Bob &amp; Sue &lt;3&nbsp; today</p>`;

function body(props: {
  body: string | null | undefined;
  mergeData?: Record<string, string>;
}) {
  return renderToStaticMarkup(createElement(MessageBody, props));
}

test("the formatting is rendered, not printed", () => {
  const html = body({ body: "<p>Hi <strong>Sarah</strong></p>" });
  assert.ok(html.includes("<strong>Sarah</strong>"), html);
  assert.ok(!html.includes("&lt;strong&gt;"), html);
});

test("an entity-bearing body reads as the words that were typed", () => {
  const html = body({ body: BROWSER_SERIALISED });

  assert.ok(html.includes("Bob &amp; Sue &lt;3"), html);
  // The four-pass failure: escapes escaped, then escaped again.
  assert.ok(!html.includes("&amp;amp;"), html);
  assert.ok(!html.includes("&amp;lt;"), html);
});

test("a pre-sanitised body renders the same as the raw one", () => {
  // Nothing upstream should sanitise for this component, but if a caller does,
  // the reader must still see one message rather than a second variant.
  assert.equal(
    body({ body: toRichTextHtml(BROWSER_SERIALISED) }),
    body({ body: BROWSER_SERIALISED })
  );
});

test("merge values substitute inside the formatting, escaped exactly once", () => {
  const html = body({
    body: "<p>Hi <strong>{{first_name}}</strong></p>",
    mergeData: { first_name: "O'Brien" },
  });

  // One level of escaping — the browser renders that as an apostrophe. Two
  // levels is what the detail page used to show: a literal `O&#39;Brien`.
  assert.ok(html.includes("<strong>O&#39;Brien</strong>"), html);
  assert.ok(!html.includes("&amp;#39;"), html);
  assert.ok(!html.includes("{{first_name}}"), html);
});

test("a hostile merge VALUE is text here too, not an element", () => {
  const html = body({
    body: "<p>Hi {{first_name}}</p>",
    mergeData: { first_name: `<img src=x onerror="alert(1)">` },
  });

  assert.ok(!html.toLowerCase().includes("<img"), html);
  assert.ok(html.includes("&lt;img"), html);
});

test("a hostile stored body is sanitised on the way out", () => {
  const html = body({
    body: `<p>hi</p><script>alert(1)</script><img src=x onerror=alert(2)>`,
  });

  assert.ok(!html.toLowerCase().includes("<script"), html);
  assert.ok(!html.includes("alert(1)"), html);
  assert.ok(!/\sonerror\s*=/i.test(html), html);
});

test("a legacy plain-text body renders as paragraphs", () => {
  const html = body({ body: "Hi Sarah,\n\nSee you Sunday." });
  assert.ok(html.includes("<p>Hi Sarah,</p>"), html);
  assert.ok(html.includes("<p>See you Sunday.</p>"), html);
});

test("an empty body says so rather than rendering a blank block", () => {
  assert.ok(body({ body: "" }).includes("No content"));
  assert.ok(body({ body: null }).includes("No content"));
});
