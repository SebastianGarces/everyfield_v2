import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { RichText } from "@/components/shared/rich-text";
import { parseElements } from "@/lib/testing/rendered-markup";
import { evryResponseMarkdown } from "./response-markdown";

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(RichText, { body: evryResponseMarkdown(text) })
  );

test("assistant comparisons render emphasis, paragraphs and lists rather than Markdown markers", () => {
  const html = render(
    "They serve different purposes:\n\n- **4C assessment:** A structured evaluation.\n- **Prospect interview:** A recorded conversation.\n\nAn interview can *inform* an assessment."
  );
  assert.match(html, /<strong>4C assessment:<\/strong>/);
  assert.match(html, /<strong>Prospect interview:<\/strong>/);
  assert.match(html, /<em>inform<\/em>/);
  assert.equal(parseElements(html).filter(({ tag }) => tag === "li").length, 2);
  assert.doesNotMatch(html, /\*\*/);
});

test("streaming prefixes stay readable and settle into the same formatted answer", () => {
  const text =
    "**4C assessment:** Scores and notes.\n\n1. Review the scores.\n2. Plan an interview.";
  for (let end = 1; end <= text.length; end++) {
    assert.doesNotThrow(() => render(text.slice(0, end)));
  }
  assert.match(render(text), /<strong>4C assessment:<\/strong>/);
  assert.match(render(text), /<ol>/);
  assert.match(render("Q & A\nA < B"), /Q &amp; A<br\/?>(?:\n)?A &lt; B/);
});

test("model Markdown cannot create links, tracking images, executable HTML or forms", () => {
  const html = render(
    "[Tasks](javascript:alert(1)) [Site](https://example.com) ![Photo](https://example.com/track)\n\n<img src=x onerror=alert(1)><script>alert(1)</script><form><input></form>"
  );
  const tags = parseElements(html).map(({ tag }) => tag);
  for (const tag of ["a", "img", "script", "form", "input", "iframe"]) {
    assert.ok(!tags.includes(tag), `Unexpected ${tag}`);
  }
  assert.match(html, /Tasks/);
  assert.match(html, /Photo/);
});

test("saved and streaming assistant text use the same renderer while user input remains literal", () => {
  const source = readFileSync(
    new URL("./conversation-surface.tsx", import.meta.url),
    "utf8"
  );
  // Native Eve exposes saved and streaming messages through one projection.
  assert.equal(source.match(/body=\{evryResponseMarkdown\(/g)?.length, 1);
  assert.match(source, /projectEveMessage\(message\)/);
  assert.match(
    source,
    /message.role === "user" \? \(\s*<p className="whitespace-pre-wrap">/
  );
});
