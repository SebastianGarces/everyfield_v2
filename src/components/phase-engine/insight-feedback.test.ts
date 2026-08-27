import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseElements } from "@/lib/testing/rendered-markup";

import { InsightFeedbackCommentField } from "./insight-feedback";

test("the optional feedback comment has a name independent of its placeholder", () => {
  const html = renderToStaticMarkup(
    createElement(InsightFeedbackCommentField, {
      comment: "",
      onChange: () => {},
      disabled: false,
    })
  );
  const comment = parseElements(html).find(
    (element) =>
      element.attrs.placeholder ===
      "What made this insight useful or not? (optional)"
  );

  assert.ok(comment, "feedback comment field is missing");
  assert.equal(comment.attrs["aria-label"], "Feedback comment (optional)");
});

test("the feedback comment field forwards edits and preserves its input contract", () => {
  let receivedComment: string | undefined;
  const field = InsightFeedbackCommentField({
    comment: "Existing feedback",
    onChange: (comment) => {
      receivedComment = comment;
    },
    disabled: true,
  }) as ReactElement<{
    value: string;
    onChange: (event: { target: { value: string } }) => void;
    disabled: boolean;
    maxLength: number;
    "aria-label": string;
  }>;

  field.props.onChange({ target: { value: "Updated feedback" } });

  assert.equal(receivedComment, "Updated feedback");
  assert.equal(field.props.value, "Existing feedback");
  assert.equal(field.props.disabled, true);
  assert.equal(field.props.maxLength, 2000);
  assert.equal(field.props["aria-label"], "Feedback comment (optional)");
});
