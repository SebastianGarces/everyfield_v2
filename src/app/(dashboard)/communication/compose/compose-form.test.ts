import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { MessageTemplate } from "@/db/schema/communication";
import { EmailPreview } from "@/components/communication/email-preview";
import { storedTemplateContent } from "@/lib/communication/templates";
import { toRichTextHtml } from "@/lib/rich-text/format";
import { ComposeForm } from "./compose-form";

const facts = {
  church_name: "QA Church",
  pastor_name: "Alex & Smith",
  launch_date: "January 3, 2027",
};

function renderCompose(template: MessageTemplate) {
  const unexpectedNavigation = () => {
    throw new Error("Rendering compose must not navigate");
  };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      {
        value: {
          bfcacheId: "qa828",
          back: unexpectedNavigation,
          forward: unexpectedNavigation,
          refresh: unexpectedNavigation,
          push: unexpectedNavigation,
          replace: unexpectedNavigation,
          prefetch: unexpectedNavigation,
        },
      },
      createElement(ComposeForm, {
        templates: [template],
        initialTemplate: template,
        churchMergeData: facts,
      })
    )
  );
}

for (const legacy of [false, true]) {
  test(`Use and reload preserve saved ${legacy ? "plain-text" : "rich-text"} template content in compose preview`, () => {
    const content = legacy
      ? {
          body: "Manual O'Neil & Sons\nMarch 4, 2028\n{{pastor_name}}\n{{launch_date}}",
          bodyHtml: null,
        }
      : storedTemplateContent(
          '<p><strong>Manual O\'Neil &amp; Sons</strong></p><p>March 4, 2028</p><p><em>{{pastor_name}}</em></p><p>{{launch_date}}</p><p><a href="https://example.com/qa828">Details</a></p>'
        );
    const template: MessageTemplate = {
      id: "828-template",
      churchId: "828-church",
      name: "Saved template",
      description: null,
      category: "other",
      channel: "email",
      subject: "Manual March 4, 2028 | {{pastor_name}} | {{launch_date}}",
      ...content,
      mergeFields: null,
      isSystem: false,
      sourceTemplateId: null,
      createdAt: new Date("2026-09-10T00:00:00Z"),
      updatedAt: new Date("2026-09-10T00:00:00Z"),
    };
    // The in-page picker consumes the stored HTML with the legacy fallback.
    // Compare its real preview with the real component's initial state on two
    // fresh renders, as Use and a full reload each mount ComposeForm.
    const expectedPreview = renderToStaticMarkup(
      createElement(EmailPreview, {
        subject: template.subject ?? "",
        body: toRichTextHtml(template.bodyHtml ?? template.body),
        mergeData: facts,
      })
    );
    for (const html of [renderCompose(template), renderCompose(template)]) {
      assert.ok(
        html.includes(expectedPreview),
        "Initial preview lost saved content"
      );
      assert.ok(html.includes("March 4, 2028"));
      assert.ok(html.includes("January 3, 2027"));
      assert.ok(html.includes("Alex &amp; Smith"));
      if (!legacy) {
        assert.ok(
          html.includes("<strong>Manual O&#x27;Neil &amp; Sons</strong>") ||
            html.includes("<strong>Manual O&#39;Neil &amp; Sons</strong>")
        );
        assert.ok(html.includes("<em>Alex &amp; Smith</em>"));
        assert.ok(html.includes('href="https://example.com/qa828"'));
      }
    }
  });
}
