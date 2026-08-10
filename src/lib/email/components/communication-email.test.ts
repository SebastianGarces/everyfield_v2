import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@react-email/components";

import { renderTemplate } from "@/lib/communication/merge";
import {
  escapeMergeValues,
  richTextToPlainText,
  toRichTextHtml,
} from "@/lib/rich-text/format";
import {
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/rsvp-placeholders";

import { CommunicationEmail } from "./communication-email";

// ----------------------------------------------------------------------------
// COM-017's first acceptance criterion is about the DELIVERED email, not the
// editor: bold, italic and links must survive all the way into the HTML body
// Resend is handed. So these tests run the send path's own three steps —
// sanitise, substitute (with values escaped), render — and read the result.
//
// `sendCommunication` itself needs a database and a Resend key; this is the
// same pipeline with the I/O removed, which is what makes it assertable here.
// ----------------------------------------------------------------------------

/** The body exactly as `sendCommunication` builds it, minus the I/O. */
function renderedBody(composed: string, data: Record<string, string> = {}) {
  const safe = toRichTextHtml(composed);
  return {
    html: renderTemplate(safe, escapeMergeValues(data)),
    text: renderTemplate(richTextToPlainText(safe), data),
  };
}

test("bold, italic and links reach the delivered HTML body", async () => {
  const body = renderedBody(
    `<p>Hi <strong>Sarah</strong>, this is <em>important</em>. <a href="https://everyfield.app/rsvp">RSVP here</a>.</p>`
  );

  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  assert.ok(html.includes("<strong>Sarah</strong>"), html);
  assert.ok(html.includes("<em>important</em>"), html);
  assert.match(html, /<a[^>]+href="https:\/\/everyfield\.app\/rsvp"/, html);
  // The reader must see words, not tags.
  assert.ok(!html.includes("&lt;strong&gt;"), html);
});

test("a link keeps the relations that make it safe to click from an inbox", async () => {
  const body = renderedBody(`<a href="https://example.com">visit</a>`);
  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  assert.match(html, /rel="noopener noreferrer"/, html);
});

test("merge fields substitute inside formatted text", async () => {
  const body = renderedBody(
    `<p>Hi <strong>{{first_name}}</strong>, see you at {{meeting_location}}.</p>`,
    { first_name: "Sarah", meeting_location: "Community Center" }
  );

  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  assert.ok(html.includes("<strong>Sarah</strong>"), html);
  assert.ok(html.includes("Community Center"), html);
  assert.ok(!html.includes("{{first_name}}"), html);
});

test("no script tag or event handler survives into the delivered email", async () => {
  const hostile = `<p>Hello</p><script>fetch("https://evil.example")</script><img src=x onerror="fetch('https://evil.example')"><a href="javascript:alert(1)">click</a>`;
  const body = renderedBody(hostile);

  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  assert.ok(!html.toLowerCase().includes("<script"), html);
  assert.ok(!html.toLowerCase().includes("<img"), html);
  assert.ok(!html.includes("evil.example"), html);
  assert.ok(!html.toLowerCase().includes("javascript:"), html);
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), html);
  // The author's words survive; only the weapons are removed.
  assert.ok(html.includes("Hello"), html);
  assert.ok(html.includes("click"), html);
});

test("a hostile merge VALUE cannot inject markup into the email", async () => {
  const body = renderedBody("<p>Hi {{first_name}}</p>", {
    first_name: `<script>fetch("https://evil.example")</script>`,
  });

  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  assert.ok(!html.toLowerCase().includes("<script"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
});

test("the RSVP tokens become real buttons, and the body stays balanced", async () => {
  const legacyTemplate = `Hi {{first_name}},

Please let us know:

{{confirm_link}}
{{decline_link}}

Thanks!`;

  const body = renderedBody(legacyTemplate, {
    first_name: "Sarah",
    confirm_link: CONFIRM_PLACEHOLDER,
    decline_link: DECLINE_PLACEHOLDER,
  });

  const html = await render(
    CommunicationEmail({
      bodyHtml: body.html,
      confirmUrl: "https://everyfield.app/rsvp/token",
      declineUrl: "https://everyfield.app/rsvp/token?action=decline",
      churchName: "New Life",
    })
  );

  assert.ok(!html.includes(CONFIRM_PLACEHOLDER), html);
  assert.ok(!html.includes(DECLINE_PLACEHOLDER), html);
  assert.match(html, /href="https:\/\/everyfield\.app\/rsvp\/token"/, html);
  assert.ok(html.includes("Hi Sarah,"), html);
  assert.ok(html.includes("Thanks!"), html);
});

test("the plain-text half says the same thing, without the tags", async () => {
  const body = renderedBody(
    "<p>Hi <strong>{{first_name}}</strong>,</p><ul><li>bring a chair</li></ul>",
    { first_name: "Sarah" }
  );

  const text = await render(
    CommunicationEmail({ body: body.text, churchName: "New Life" }),
    { plainText: true }
  );

  assert.ok(text.includes("Hi Sarah,"), text);
  assert.ok(text.includes("bring a chair"), text);
  assert.ok(!text.includes("<strong>"), text);
});

test("a body composed before COM-017 still renders as paragraphs", async () => {
  const body = renderedBody("Hi Sarah,\n\nSee you Sunday.");
  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  assert.ok(html.includes("Hi Sarah,"), html);
  assert.ok(html.includes("See you Sunday."), html);
});

// ----------------------------------------------------------------------------
// AC1 is about the body SURVIVING, not only its tags. A contentEditable hands
// the send path an innerHTML string in which `&`, `<`, `>` and the non-breaking
// space it inserts for a repeated space are ALREADY encoded, and the body is
// sanitised more than once on the way out. A sanitiser that re-escapes what is
// already escaped ships `Bob &amp; Sue &lt;3` to a recipient's inbox — the
// tags survive and the words do not. These fixtures start where the browser
// leaves off.
// ----------------------------------------------------------------------------

/** What a contentEditable serialises for: Bob & Sue <3  today */
const BROWSER_SERIALISED = `<p>Bob &amp; Sue &lt;3&nbsp; today</p>`;

test("an entity-bearing body reaches the inbox as the words that were typed", async () => {
  const body = renderedBody(BROWSER_SERIALISED);

  const html = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" })
  );

  // react-email escapes for the DOM, so read the text the recipient sees.
  const rendered = await render(
    CommunicationEmail({ bodyHtml: body.html, churchName: "New Life" }),
    { plainText: true }
  );
  assert.ok(rendered.includes("Bob & Sue <3"), rendered);
  // The failure this pins: the escapes escaped again.
  assert.ok(!html.includes("&amp;amp;"), html);
  assert.ok(!html.includes("&amp;lt;"), html);
  assert.ok(!html.includes("&amp;nbsp;"), html);
});

test("the text/plain half says the same words as the HTML half", async () => {
  const body = renderedBody(BROWSER_SERIALISED);

  const text = await render(
    CommunicationEmail({ body: body.text, churchName: "New Life" }),
    { plainText: true }
  );

  assert.ok(text.includes("Bob & Sue <3"), text);
  assert.ok(!text.includes("&amp;"), text);
  assert.ok(!text.includes("&lt;"), text);
});

test("sanitising the stored body again does not change the delivered body", async () => {
  // The stored row is already sanitised; every reader sanitises again. Both
  // halves must be byte-identical after the extra pass.
  const once = renderedBody(BROWSER_SERIALISED);
  const twice = renderedBody(toRichTextHtml(BROWSER_SERIALISED));

  assert.equal(twice.html, once.html);
  assert.equal(twice.text, once.text);
});
