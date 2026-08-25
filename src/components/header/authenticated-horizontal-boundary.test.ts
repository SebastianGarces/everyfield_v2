import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.join(process.cwd(), "src");

function read(...segments: string[]) {
  return readFileSync(path.join(SRC, ...segments), "utf8");
}

const GLOBAL_STYLES = read("app", "globals.css");
const DASHBOARD_LAYOUT = read("app", "(dashboard)", "layout.tsx");
const WIKI_GUIDE_PANEL = read(
  "components",
  "wiki-guide",
  "wiki-guide-panel.tsx"
);
const WIKI_GUIDE_BUTTON = read(
  "components",
  "wiki-guide",
  "wiki-guide-button.tsx"
);
const TABLE = read("components", "ui", "table.tsx");
const PIPELINE = read("components", "people", "pipeline-view.tsx");

test("every authenticated scroll owner contains horizontal overscroll without clipping it", () => {
  assert.match(
    GLOBAL_STYLES,
    /html:has\(\[data-authenticated-shell\]\),\s*body:has\(\[data-authenticated-shell\]\)\s*\{[^}]*overscroll-behavior-x:\s*none;[^}]*overscroll-behavior-y:\s*none;/,
    "the viewport must contain both authenticated overscroll axes"
  );
  assert.match(
    GLOBAL_STYLES,
    /body:has\(\[data-authenticated-shell\]\) \*\s*\{[^}]*overscroll-behavior-x:\s*none;/,
    "overscroll is not inherited, so nested and portaled scroll owners need the x-axis policy too"
  );
  assert.doesNotMatch(
    GLOBAL_STYLES,
    /overflow-x\s*:/,
    "the root fix must not hide or clip horizontal content"
  );
  assert.match(
    DASHBOARD_LAYOUT,
    /<SidebarProvider[\s\S]*data-authenticated-shell/,
    "the authenticated marker must remain on the bounded shell"
  );
  assert.match(
    TABLE,
    /data-slot="table-container"[\s\S]*overflow-x-auto/,
    "wide tables must keep their intentional horizontal scroll owner"
  );
  assert.match(
    PIPELINE,
    /className="flex h-full gap-4 overflow-x-auto/,
    "the pipeline board must keep its intentional horizontal scroll owner"
  );
});

test("the closed wiki guide slides inside a viewport-sized clip rail", () => {
  assert.match(
    WIKI_GUIDE_PANEL,
    /data-slot="wiki-guide-viewport"[\s\S]*className="pointer-events-none fixed inset-y-0 right-0 z-40 w-full overflow-clip md:max-w-\[536px\]"/,
    "the rail must never exceed the viewport and must clip the translated panel"
  );
  assert.match(
    WIKI_GUIDE_PANEL,
    /"absolute top-4 right-4 bottom-4 w-\[520px\]"/,
    "the open desktop panel keeps its ruled 520px width"
  );
  assert.match(
    WIKI_GUIDE_PANEL,
    /isOpen\s*\? "pointer-events-auto translate-x-0 opacity-100"\s*:\s*"translate-x-\[calc\(100%\+1rem\)\] opacity-0"/,
    "open interaction and the existing slide distance must remain state-driven"
  );
  assert.match(
    WIKI_GUIDE_PANEL,
    /"max-md:left-4 max-md:w-auto"/,
    "the panel must keep its responsive inline margins below md"
  );
  assert.doesNotMatch(
    WIKI_GUIDE_PANEL,
    /"fixed top-4 right-4 bottom-4 z-40 w-\[520px\]"/,
    "the translating panel itself must not remain fixed directly against the document"
  );
  assert.match(WIKI_GUIDE_PANEL, /role="complementary"/);
  assert.match(WIKI_GUIDE_PANEL, /aria-label="Wiki guide panel"/);
  assert.match(
    WIKI_GUIDE_PANEL,
    /aria-hidden=\{!isOpen\}[\s\S]*inert=\{!isOpen\}/,
    "closed clipped controls must leave both the accessibility tree and keyboard order"
  );
});

test("the open wiki guide trigger stays inside narrow viewports", () => {
  assert.match(
    WIKI_GUIDE_BUTTON,
    /export const WIKI_GUIDE_TRIGGER_ID = "wiki-guide-trigger";/
  );
  assert.match(WIKI_GUIDE_BUTTON, /id=\{WIKI_GUIDE_TRIGGER_ID\}/);
  assert.match(
    WIKI_GUIDE_BUTTON,
    /isOpen && "right-4 md:right-\[calc\(520px\+2rem\)\]"/,
    "only desktop has room to shift the trigger beside the 520px panel"
  );
  assert.doesNotMatch(
    WIKI_GUIDE_BUTTON,
    /isOpen && "right-\[calc\(520px\+2rem\)\]/,
    "the desktop offset must not push the trigger past a narrow viewport"
  );
  assert.match(WIKI_GUIDE_BUTTON, /onClick=\{toggle\}/);
  assert.match(
    WIKI_GUIDE_BUTTON,
    /aria-label=\{isOpen \? "Close wiki guide" : "Open wiki guide"\}/,
    "the responsive correction must preserve the trigger's action and accessible state"
  );
});

test("the panel close action restores focus without replacing the trigger toggle", () => {
  assert.match(
    WIKI_GUIDE_PANEL,
    /const closeAndRestoreFocus = \(\) => \{\s*close\(\);\s*document\.getElementById\(WIKI_GUIDE_TRIGGER_ID\)\?\.focus\(\);\s*\};/,
    "focus must leave the subtree before it becomes inert and return to the visible trigger"
  );
  assert.match(
    WIKI_GUIDE_PANEL,
    /aria-label="Close guide panel"[\s\S]*?<X[^>]*>[\s\S]*?<\/Button>/
  );
  assert.match(
    WIKI_GUIDE_PANEL,
    /onClick=\{closeAndRestoreFocus\}[\s\S]*?aria-label="Close guide panel"/,
    "only the internal close action needs explicit restoration"
  );
  assert.match(
    WIKI_GUIDE_BUTTON,
    /id=\{WIKI_GUIDE_TRIGGER_ID\}[\s\S]*?onClick=\{toggle\}/,
    "the trigger must keep native focus when it closes its own panel"
  );
});
