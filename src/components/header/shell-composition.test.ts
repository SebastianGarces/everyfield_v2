import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.join(process.cwd(), "src");

function read(...segments: string[]) {
  return readFileSync(path.join(SRC, ...segments), "utf8");
}

const GLOBAL_BAR = read("components", "header", "global-app-bar.tsx");
const MOBILE_TRIGGER = read(
  "components",
  "header",
  "mobile-sidebar-trigger.tsx"
);
const PAGE_CONTEXT = read("components", "header", "page-context.tsx");
const PAGE_FRAME = read("components", "layout", "page-frame.tsx");
const GLOBAL_STYLES = read("app", "globals.css");
const PHASE = read("app", "(dashboard)", "phase", "page.tsx");
const WIKI = read("app", "(dashboard)", "wiki", "layout.tsx");
const SETTINGS = read("components", "settings", "settings-modal.tsx");
const SIDEBAR = read("components", "app-sidebar.tsx");
const SIDEBAR_PRIMITIVE = read("components", "ui", "sidebar.tsx");
const ACCOUNT = read("components", "nav-user.tsx");
const LAYOUT = read("app", "(dashboard)", "layout.tsx");

function assertInOrder(source: string, needles: string[]) {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `missing ${needle}`);
    assert.ok(next > cursor, `${needle} is out of order`);
    cursor = next;
  }
}

test("the one shell bar keeps its ruled geometry", () => {
  assert.match(GLOBAL_BAR, /\bh-10\b/, "the global bar must remain 40px");
  assert.match(
    GLOBAL_BAR,
    /<Mark className="[^"]*\bw-6\b/,
    "the green mark must remain 24px wide"
  );
  assert.doesNotMatch(
    LAYOUT,
    /DashboardHeader/,
    "the retired 64px context bar must not consume shell height"
  );
});

test("the page canvas owns breadcrumbs and the existing actions portal", () => {
  assert.match(
    PAGE_FRAME,
    /<PageContext attachment=\{contextAttachment\} items=\{contextItems\} \/>/
  );
  assert.doesNotMatch(
    PAGE_CONTEXT,
    /<header\b/,
    "page context must not create a second banner landmark inside page headers"
  );
  assertInOrder(PAGE_CONTEXT, [
    '<Breadcrumb className="min-w-0 overflow-hidden">',
    'data-slot="page-actions"',
  ]);
  assert.match(PAGE_CONTEXT, /ref=\{setActionsContainer\}/);
});

test("the hierarchy ruling leaves no runtime prototype artifacts", () => {
  assert.equal(
    existsSync(path.join(SRC, "components", "page-hierarchy-prototype.tsx")),
    false
  );
  for (const [name, source] of [
    ["dashboard layout", LAYOUT],
    ["page context", PAGE_CONTEXT],
    ["page frame", PAGE_FRAME],
    ["global styles", GLOBAL_STYLES],
    ["Plant Intelligence", PHASE],
    ["Wiki", WIKI],
  ] as const) {
    assert.doesNotMatch(
      source,
      /PageHierarchyPrototype|data-auth-page-hierarchy|auth-page-hierarchy-prototype|data-context-layout|suppressSingleCrumb/,
      `${name} still contains taste-prototype state or selectors`
    );
  }
});

test("global controls stay in the requested reading order", () => {
  assertInOrder(GLOBAL_BAR, [
    "<FeedbackButton />",
    "{children}",
    "<NavUser user={user} />",
  ]);
  assert.match(GLOBAL_BAR, /<MobileSidebarTrigger\s*\/>/);
});

test("the desktop global brand remains visible independently of sidebar state", () => {
  const brand = GLOBAL_BAR.slice(
    GLOBAL_BAR.indexOf('data-slot="global-app-brand"')
  );

  assert.match(
    brand,
    /className="[^"]*\bmd:w-64\b[^"]*\bmd:shrink-0\b[^"]*"/,
    "the global brand keeps the expanded 16rem lane when the desktop sidebar collapses"
  );
  assert.doesNotMatch(
    brand.slice(0, brand.indexOf("</div>")),
    /--sidebar-width|group-data-\[collapsible/,
    "global brand geometry must not inherit the desktop sidebar's collapsed width"
  );
  assertInOrder(brand, ["<Mark", "{shell.label}"]);
});

test("the mobile shell trigger restores focus after its Sheet closes", () => {
  assert.match(
    MOBILE_TRIGGER,
    /const \{ isMobile, openMobile \} = useSidebar\(\)/
  );
  assert.match(
    MOBILE_TRIGGER,
    /const triggerRef = useRef<HTMLButtonElement>\(null\)/
  );
  assert.match(
    MOBILE_TRIGGER,
    /const sheetClosed = wasOpen\.current && !openMobile/
  );
  assert.match(
    MOBILE_TRIGGER,
    /document\.querySelector\('\[data-sidebar="sidebar"\]\[data-mobile="true"\]'\)/,
    "focus restoration must wait for Radix to remove the closing Sheet's focus scope"
  );
  assertInOrder(MOBILE_TRIGGER, [
    "const restoreAfterSheetUnmounts",
    "document.querySelector",
    "triggerRef.current?.focus()",
  ]);
  assert.match(
    MOBILE_TRIGGER,
    /if \(isMobile && !openMobile\) \{[\s\S]*triggerRef\.current = event\.currentTarget;[\s\S]*openedFromTrigger\.current = true;/,
    "only the top-bar trigger's own open should claim focus restoration"
  );
  assert.doesNotMatch(
    MOBILE_TRIGGER,
    /<SidebarTrigger[\s\S]*ref=\{triggerRef\}/,
    "focus restoration must capture the rendered button instead of relying on a ref forwarded through wrapper components"
  );
});

test("notification streaming remains below its own Suspense boundary", () => {
  assertInOrder(LAYOUT, [
    "<GlobalAppBar",
    "<Suspense",
    "<NotificationBellSlot viewer={viewer} />",
    "</Suspense>",
    "</GlobalAppBar>",
  ]);
});

test("the sidebar footer is control first, then passive identity", () => {
  const footer = SIDEBAR.slice(SIDEBAR.indexOf("<SidebarFooter"));
  assertInOrder(footer, ["<SidebarTrigger", "<SidebarIdentity"]);
  assert.doesNotMatch(
    ACCOUNT.slice(ACCOUNT.indexOf("export function SidebarIdentity")),
    /<(button|a)\b|tabIndex=/,
    "the sidebar identity must not become a second account-menu trigger"
  );
});

test("the gear menu keeps identity, SettingsLink, and the logout action", () => {
  const menu = ACCOUNT.slice(ACCOUNT.indexOf("export function NavUser"));
  assert.match(menu, /aria-label="Account menu"/);
  assertInOrder(menu, [
    "<DropdownMenuLabel",
    "<SettingsLink",
    "<form",
    "action={logout}",
    'recordNavigationIntent("/login")',
  ]);
});

test("the dashboard has one main landmark and a skip target", () => {
  assert.match(LAYOUT, /href={`#\$\{DASHBOARD_MAIN_ID\}`}/);
  assert.match(LAYOUT, /<SidebarInset[\s\S]*id={DASHBOARD_MAIN_ID}/);
  assert.doesNotMatch(LAYOUT, /^[ \t]*<main\b/m);
  const inset = SIDEBAR_PRIMITIVE.slice(
    SIDEBAR_PRIMITIVE.indexOf("function SidebarInset"),
    SIDEBAR_PRIMITIVE.indexOf("function SidebarInput")
  );
  assert.match(inset, /<main\b/);
});

test("page context stays inside the focusable route-content main", () => {
  assertInOrder(LAYOUT, [
    "<SidebarInset",
    "{children}",
    "</SidebarInset>",
    "<SettingsModal",
  ]);
  assert.match(
    PAGE_FRAME,
    /data-slot="page-canvas"[\s\S]*<PageContext attachment=\{contextAttachment\} items=\{contextItems\} \/>/
  );
});

test("settings close resumes after page context instead of re-entering it", () => {
  assert.match(
    PAGE_FRAME,
    /<PageContext[\s\S]*id=\{hasContentFocusTarget \? DASHBOARD_PAGE_CONTENT_ID : undefined\}[\s\S]*tabIndex=\{hasContentFocusTarget \? -1 : undefined\}/
  );
  assert.match(
    SETTINGS,
    /document\.getElementById\(DASHBOARD_PAGE_CONTENT_ID\)\?\.focus\(\)/
  );
  assert.doesNotMatch(
    SETTINGS,
    /document\.getElementById\(DASHBOARD_MAIN_ID\)/,
    "focusing main would put breadcrumb links before route content on the next Tab"
  );
});

test("the viewport caps the shell and leaves route scrolling to page canvases", () => {
  const shellMain = LAYOUT.slice(
    LAYOUT.indexOf("<SidebarInset"),
    LAYOUT.indexOf("</SidebarInset>") + "</SidebarInset>".length
  );

  assert.match(
    LAYOUT,
    /<SidebarProvider[\s\S]*data-authenticated-shell[\s\S]*className="[^"]*\bh-svh\b[^"]*\boverflow-hidden\b[^"]*"/
  );
  assert.match(
    shellMain,
    /className="[^"]*\bmin-h-0\b[^"]*\boverflow-clip\b[^"]*\boverscroll-y-none\b[^"]*"[\s\S]*{children}/,
    "the shell main must clip without becoming a programmatic scroll ancestor"
  );
  assert.doesNotMatch(
    shellMain,
    /\boverflow-(?:auto|hidden|scroll)\b/,
    "PageCanvas and specialized panes, not the persistent shell main, own route scrolling"
  );
  assert.match(
    GLOBAL_STYLES,
    /html:has\(\[data-authenticated-shell\]\),\s*body:has\(\[data-authenticated-shell\]\)\s*\{[^}]*overscroll-behavior-x:\s*none;[^}]*overscroll-behavior-y:\s*none;/,
    "the viewport must not rubber-band past the authenticated shell on either axis"
  );
  assert.doesNotMatch(
    GLOBAL_STYLES,
    /(?:^|\n)html,\s*body\s*\{[^}]*(?:overscroll-behavior(?:-[xy])?):/,
    "public pages must retain their native viewport overscroll behavior"
  );
  assert.doesNotMatch(
    GLOBAL_STYLES,
    /\[data-authenticated-shell\][^}]*overflow-x:\s*hidden/,
    "contain viewport chaining without clipping intentional horizontal scrollers"
  );
});
