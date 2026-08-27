import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  shouldCloseWikiMobileNavigation,
  shouldHandleWikiSearchShortcut,
} from "./wiki-search-shortcut";

const MOBILE_NAVIGATION = readFileSync(
  join(__dirname, "wiki-mobile-navigation.tsx"),
  "utf8"
);
const SIDEBAR = readFileSync(join(__dirname, "wiki-sidebar.tsx"), "utf8");

test("mobile Wiki navigation is a labelled Sheet that reuses the shared sidebar", () => {
  assert.match(
    MOBILE_NAVIGATION,
    /<Sheet open=\{open\} onOpenChange=\{setOpen\}>/
  );
  assert.match(MOBILE_NAVIGATION, /<SheetTitle>Browse Wiki<\/SheetTitle>/);
  assert.match(
    MOBILE_NAVIGATION,
    /<WikiSidebar[\s\S]*onNavigate=\{\(\) => setOpen\(false\)\}/
  );
  assert.match(MOBILE_NAVIGATION, /overscroll-x-none overscroll-y-none/);
});

test("Wiki links close the mobile Sheet only for same-tab navigation", () => {
  assert.match(SIDEBAR, /function closeAfterNavigation\(/);
  assert.match(
    SIDEBAR,
    /event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey/
  );
  assert.match(SIDEBAR, /onNavigate\?\.\(\);/);
});

test("only the active Wiki navigation owns Cmd/Ctrl+K", () => {
  assert.equal(shouldHandleWikiSearchShortcut("desktop", true), true);
  assert.equal(shouldHandleWikiSearchShortcut("mobile", true), false);
  assert.equal(shouldHandleWikiSearchShortcut("desktop", false), false);
  assert.equal(shouldHandleWikiSearchShortcut("mobile", false), true);
});

test("entering desktop closes an open mobile Sheet and its portal", () => {
  let mobileSheetOpen = true;

  if (shouldCloseWikiMobileNavigation(false)) {
    mobileSheetOpen = false;
  }
  assert.equal(mobileSheetOpen, true);

  if (shouldCloseWikiMobileNavigation(true)) {
    mobileSheetOpen = false;
  }
  assert.equal(mobileSheetOpen, false);
  assert.match(
    MOBILE_NAVIGATION,
    /<Sheet open=\{open\} onOpenChange=\{setOpen\}>/
  );
  assert.match(
    MOBILE_NAVIGATION,
    /desktopQuery\.addEventListener\("change", closeOnDesktop\)/
  );
});
