import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HistoryDownloadButton } from "./history-download-button";

test("the history download control names the document it downloads", () => {
  const html = renderToStaticMarkup(
    createElement(HistoryDownloadButton, {
      artifactId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      label: "Core Group Commitment Card",
    })
  );

  assert.match(html, /Download Core Group Commitment Card/);
  assert.match(html, />Download</);
});
