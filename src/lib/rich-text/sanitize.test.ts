import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeHtmlEntities,
  escapeHtml,
  sanitizeRichText,
  sanitizeUrl,
} from "./sanitize";

// ----------------------------------------------------------------------------
// This is the security gate for COM-017 / T-021, so the tests are written as an
// attacker: every case below is markup that a paste, a template import or a
// direct POST to the send action could realistically carry. The assertions are
// negative on purpose — "no script tag survives" is the claim, not "this exact
// string comes out" — because the failure mode is something UNEXPECTED getting
// through, and an equality test only proves the expected case.
// ----------------------------------------------------------------------------

/** Everything the gate must never emit, whatever the input was. */
function assertInert(html: string) {
  const lower = html.toLowerCase();
  assert.ok(!lower.includes("<script"), `script tag survived: ${html}`);
  assert.ok(!lower.includes("</script"), `script close survived: ${html}`);
  assert.ok(!lower.includes("<iframe"), `iframe survived: ${html}`);
  assert.ok(!lower.includes("<img"), `img survived: ${html}`);
  assert.ok(!lower.includes("<svg"), `svg survived: ${html}`);
  assert.ok(!lower.includes("<style"), `style tag survived: ${html}`);
  assert.ok(!/\son[a-z]+\s*=/.test(lower), `event handler survived: ${html}`);
  assert.ok(!lower.includes("javascript:"), `js url survived: ${html}`);
  assert.ok(!lower.includes("data:text/html"), `data url survived: ${html}`);
  assert.ok(!lower.includes(" style="), `style attribute survived: ${html}`);
}

// --- escapeHtml -------------------------------------------------------------

test("escapeHtml escapes both quote forms, so it is safe in attributes", () => {
  assert.equal(
    escapeHtml(`<a href="x" onclick='y'>&</a>`),
    "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
  );
});

// --- what an author may keep ------------------------------------------------

test("bold, italic and underline survive", () => {
  assert.equal(
    sanitizeRichText("<p><strong>bold</strong> and <em>italic</em></p>"),
    "<p><strong>bold</strong> and <em>italic</em></p>"
  );
  assert.equal(sanitizeRichText("<u>under</u>"), "<u>under</u>");
});

test("browser synonyms are normalised to one spelling", () => {
  // execCommand produces <b>/<i>; contentEditable wraps blocks in <div>.
  assert.equal(
    sanitizeRichText("<div><b>bold</b> <i>italic</i></div>"),
    "<p><strong>bold</strong> <em>italic</em></p>"
  );
});

test("lists survive with their items", () => {
  assert.equal(
    sanitizeRichText("<ul><li>one</li><li>two</li></ul>"),
    "<ul><li>one</li><li>two</li></ul>"
  );
});

test("a link keeps its href and gains safe link relations", () => {
  const html = sanitizeRichText('<a href="https://example.com">visit</a>');
  assert.equal(
    html,
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer">visit</a>'
  );
});

test("mailto and tel links survive", () => {
  assert.match(
    sanitizeRichText('<a href="mailto:a@b.com">a</a>'),
    /mailto:a@b/
  );
  assert.match(sanitizeRichText('<a href="tel:+15551234">a</a>'), /tel:/);
});

test("merge field tokens pass through formatted text untouched", () => {
  // The whole point of COM-017: {{first_name}} must still be substitutable
  // after the body becomes HTML, including inside a bold run.
  const html = sanitizeRichText(
    "<p>Hi <strong>{{first_name}}</strong>, see you at {{meeting_date}}.</p>"
  );
  assert.ok(html.includes("{{first_name}}"));
  assert.ok(html.includes("{{meeting_date}}"));
});

// --- hostile input ----------------------------------------------------------

test("script tags lose their content, not just their brackets", () => {
  const html = sanitizeRichText(
    "<p>before</p><script>alert('xss')</script><p>after</p>"
  );
  assertInert(html);
  assert.ok(!html.includes("alert"), html);
  assert.equal(html, "<p>before</p><p>after</p>");
});

test("a script tag with odd casing or padding is still a script tag", () => {
  for (const hostile of [
    "<ScRiPt>alert(1)</ScRiPt>",
    "<script >alert(1)</script >",
    "<script\ntype='text/javascript'>alert(1)</script>",
    "<script src='//evil.example/x.js'></script>",
  ]) {
    const html = sanitizeRichText(hostile);
    assertInert(html);
    assert.ok(!html.includes("alert"), `${hostile} -> ${html}`);
  }
});

test("an unclosed script swallows the rest rather than leaking it", () => {
  const html = sanitizeRichText("<p>hi</p><script>alert(1)");
  assertInert(html);
  assert.ok(!html.includes("alert"), html);
});

test("event handlers never survive, in any spelling", () => {
  for (const hostile of [
    `<p onclick="steal()">text</p>`,
    `<p ONCLICK="steal()">text</p>`,
    `<p onclick = "steal()">text</p>`,
    `<p onmouseover=steal()>text</p>`,
    `<img src=x onerror=alert(1)>`,
    `<svg/onload=alert(1)>`,
    `<body onload=alert(1)>text`,
    `<a href="https://ok.example" onclick="steal()">link</a>`,
  ]) {
    const html = sanitizeRichText(hostile);
    assertInert(html);
    assert.ok(!html.includes("steal"), `${hostile} -> ${html}`);
    assert.ok(!html.includes("alert"), `${hostile} -> ${html}`);
  }
});

test("javascript: hrefs are refused, however they are spelled", () => {
  for (const hostile of [
    `<a href="javascript:alert(1)">click</a>`,
    `<a href="JaVaScRiPt:alert(1)">click</a>`,
    `<a href="  javascript:alert(1)">click</a>`,
    `<a href="java\tscript:alert(1)">click</a>`,
    `<a href="java\nscript:alert(1)">click</a>`,
    `<a href="&#106;avascript:alert(1)">click</a>`,
    `<a href="&#x6a;avascript:alert(1)">click</a>`,
    `<a href="java&Tab;script:alert(1)">click</a>`,
    `<a href="data:text/html;base64,PHNjcmlwdD4=">click</a>`,
    `<a href="vbscript:msgbox(1)">click</a>`,
  ]) {
    const html = sanitizeRichText(hostile);
    assertInert(html);
    // The anchor is unwrapped, so the author keeps their words.
    assert.equal(html, "click", `${hostile} -> ${html}`);
  }
});

test("style, iframe, object and svg lose their content too", () => {
  for (const hostile of [
    "<style>body{background:url(javascript:alert(1))}</style>",
    "<iframe src='https://evil.example'></iframe>",
    "<object data='x'><param name=a></object>",
    "<svg><script>alert(1)</script></svg>",
    "<math><mtext><script>alert(1)</script></mtext></math>",
  ]) {
    const html = sanitizeRichText(hostile);
    assertInert(html);
    assert.ok(!html.includes("alert"), `${hostile} -> ${html}`);
  }
});

test("unknown elements are unwrapped, keeping the words inside them", () => {
  assert.equal(
    sanitizeRichText('<span class="x"><font size="7">hello</font></span>'),
    "hello"
  );
  assert.equal(sanitizeRichText("<h1>Title</h1>"), "Title");
});

test("comments, doctypes and CDATA are dropped", () => {
  assert.equal(
    sanitizeRichText(
      "<!DOCTYPE html><!-- <script>alert(1)</script> --><p>hi</p>"
    ),
    "<p>hi</p>"
  );
});

test("a `<` the author typed stays text", () => {
  assert.equal(sanitizeRichText("2 < 3 & 5 > 4"), "2 &lt; 3 &amp; 5 &gt; 4");
});

test("unbalanced markup comes out balanced", () => {
  assert.equal(
    sanitizeRichText("<p><strong>bold<p>next"),
    "<p><strong>bold<p>next</p></strong></p>"
  );
  // A stray close tag for something never opened is ignored, not emitted.
  assert.equal(sanitizeRichText("bold</strong>"), "bold");
});

test("a quoted `>` inside an attribute does not end the tag early", () => {
  const html = sanitizeRichText(`<a href="https://e.example/?a=1>2">x</a>`);
  assertInert(html);
  assert.ok(!html.includes("2&quot;&gt;"), html);
});

test("sanitising twice changes nothing", () => {
  const once = sanitizeRichText(
    `<p>Hi <b>{{first_name}}</b> <a href="https://x.example">link</a></p><script>alert(1)</script>`
  );
  assert.equal(sanitizeRichText(once), once);
});

test("deeply nested markup is bounded, not stack-overflowing", () => {
  const html = sanitizeRichText("<em>".repeat(500) + "x" + "</em>".repeat(500));
  assertInert(html);
  assert.ok(html.includes("x"));
});

// --- sanitizeUrl ------------------------------------------------------------

test("sanitizeUrl allows http, https, mailto, tel and relative paths", () => {
  assert.equal(sanitizeUrl("https://a.example/x"), "https://a.example/x");
  assert.equal(sanitizeUrl("http://a.example"), "http://a.example");
  assert.equal(sanitizeUrl("mailto:a@b.com"), "mailto:a@b.com");
  assert.equal(sanitizeUrl("/wiki/article"), "/wiki/article");
});

test("sanitizeUrl refuses everything else", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(sanitizeUrl("file:///etc/passwd"), null);
  assert.equal(sanitizeUrl("//evil.example/x"), null);
  assert.equal(sanitizeUrl("   "), null);
});

test("decodeHtmlEntities handles the forms a browser accepts in an attribute", () => {
  assert.equal(decodeHtmlEntities("&#106;s"), "js");
  assert.equal(decodeHtmlEntities("&#x6a;s"), "js");
  assert.equal(decodeHtmlEntities("&#106s"), "js");
  assert.equal(decodeHtmlEntities("&amp;"), "&");
  assert.equal(decodeHtmlEntities("&notarealentity;"), "&notarealentity;");
});
