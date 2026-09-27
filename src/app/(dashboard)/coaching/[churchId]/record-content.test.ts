import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordContent } from "./record-content";
import type { CoachedRecord } from "@/lib/coaching/record-read";

function render(description: string) {
  const record: CoachedRecord = {
    kind: "tasks",
    plant: { churchId: "plant", churchName: "Plant", currentPhase: 2 },
    task: {
      id: "task",
      title: "Welcome",
      description,
      status: "not_started",
      priority: "medium",
      dueDate: null,
      dueTime: null,
      category: "general",
    },
    steps: [
      { id: "step", title: "Prepare", description, status: "not_started" },
    ],
  };
  return renderToStaticMarkup(createElement(RecordContent, { record }));
}
test("coach task and step descriptions render rich formatting", () => {
  const html = render(
    "<p>Meet <strong>Sarah</strong></p><ul><li>Bring cards</li></ul>"
  );
  assert.equal(html.match(/<strong>Sarah<\/strong>/g)?.length, 2);
  assert.equal(html.match(/<li>Bring cards<\/li>/g)?.length, 2);
  assert.ok(!html.includes("&lt;strong&gt;"));
});
test("coach task and step descriptions preserve legacy text", () => {
  const html = render("First line\nSecond line & more");
  assert.equal(html.match(/Second line &amp; more/g)?.length, 2);
  assert.match(html, /First line<br\s*\/?\s*>Second line/);
});
test("coach descriptions use the canonical safe rich-text renderer", () => {
  const html = render(
    '<p onclick="alert(1)">Safe</p><script>alert(2)</script><a href="javascript:alert(3)">bad</a><img src=x onerror="alert(4)">'
  );
  assert.ok(!/<script|onclick=|onerror=|href="javascript:/i.test(html));
  assert.match(html, /Safe/);
});
