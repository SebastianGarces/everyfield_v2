import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getSampleData } from "@/lib/communication/merge";

import { EmailPreview } from "./email-preview";

// ----------------------------------------------------------------------------
// COM-015 shows a planter what the recipient will get; COM-017 made that body
// rich text. The preview is therefore the one screen where "shows the
// formatting, not the markup" is a promise — and where an injected merge value
// would land in `dangerouslySetInnerHTML`. Both are asserted on the markup the
// browser receives.
// ----------------------------------------------------------------------------

function preview(props: {
  subject?: string;
  body: string;
  mergeData?: Record<string, string>;
}) {
  return renderToStaticMarkup(
    createElement(EmailPreview, { subject: "", ...props })
  );
}

test("the preview renders the formatting, not the tags", () => {
  const html = preview({
    body: "<p>Hi <strong>Sarah</strong>, come <em>early</em>.</p>",
  });

  assert.ok(html.includes("<strong>Sarah</strong>"), html);
  assert.ok(html.includes("<em>early</em>"), html);
  // The failure this guards: the body printed as escaped markup at the reader.
  assert.ok(!html.includes("&lt;strong&gt;"), html);
});

test("merge fields substitute inside formatted text", () => {
  const html = preview({
    subject: "Hello {{first_name}}",
    body: "<p>Hi <strong>{{first_name}}</strong>, see you on {{meeting_date}}.</p>",
    mergeData: getSampleData(),
  });

  // Sample data, so the substitution is visible: Sarah, still bold.
  assert.ok(html.includes("<strong>Sarah</strong>"), html);
  assert.ok(html.includes("Vision Meeting #12") || html.includes("2026"), html);
  assert.ok(!html.includes("{{first_name}}"), html);
});

test("an unresolved token is still called out, inside formatting", () => {
  const html = preview({ body: "<p><strong>{{nope}}</strong></p>" });
  assert.ok(html.includes("{{nope}}"), html);
  // Highlighted rather than silently blank.
  assert.ok(html.includes("#dc2626"), html);
});

test("a hostile body cannot reach the preview's inner HTML", () => {
  const html = preview({
    body: `<p>hello</p><script>alert(1)</script><img src=x onerror="alert(2)">`,
  });

  assert.ok(!html.toLowerCase().includes("<script"), html);
  assert.ok(!html.includes("alert(1)"), html);
  assert.ok(!/\sonerror\s*=/i.test(html), html);
});

test("a hostile merge VALUE is escaped, not rendered", () => {
  const html = preview({
    subject: `<img src=x onerror=alert(1)>`,
    body: "<p>Hi {{first_name}}</p>",
    mergeData: { first_name: `<img src=x onerror="alert(1)">` },
  });

  // The value is shown as the text it is. `onerror=` still appears in the
  // markup — as characters inside an escaped run, which is exactly the point,
  // so the assertion is that no ELEMENT was created from it.
  assert.ok(!html.toLowerCase().includes("<img"), html);
  assert.equal((html.match(/&lt;img/g) ?? []).length, 2, html);
});

test("a legacy plain-text body still previews as paragraphs", () => {
  const html = preview({ body: "Hi Sarah,\n\nSee you Sunday." });

  assert.ok(html.includes("<p>Hi Sarah,</p>"), html);
  assert.ok(html.includes("<p>See you Sunday.</p>"), html);
});

test("an empty body shows the prompt, not a blank frame", () => {
  assert.ok(preview({ body: "" }).includes("Start typing"));
  assert.ok(preview({ body: "<p><br></p>" }).includes("Start typing"));
});

test("the RSVP tokens preview as buttons, not as raw tokens", () => {
  const html = preview({
    body: "<p>{{confirm_link}}<br>{{decline_link}}</p>",
    mergeData: getSampleData(),
  });

  assert.ok(
    html.includes("I&#x27;ll be there") || html.includes("be there"),
    html
  );
  assert.ok(!html.includes("__EF_CONFIRM__"), html);
});
