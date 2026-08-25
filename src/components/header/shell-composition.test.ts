import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const CONTEXT_BAR = read("components", "header", "dashboard-header.tsx");
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

test("the two shell bars keep their ruled geometry", () => {
  assert.match(GLOBAL_BAR, /\bh-10\b/, "the global bar must remain 40px");
  assert.match(
    GLOBAL_BAR,
    /<Mark className="[^"]*\bw-6\b/,
    "the green mark must remain 24px wide"
  );
  assert.match(CONTEXT_BAR, /\bh-16\b/, "the context bar must remain 64px");
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
    /if \(isMobile && !openMobile\) openedFromTrigger\.current = true/,
    "only the top-bar trigger's own open should claim focus restoration"
  );
  assert.match(MOBILE_TRIGGER, /<SidebarTrigger[\s\S]*ref=\{triggerRef\}/);
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
    "<form action={logout}",
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

test("page context stays outside the focusable route-content main", () => {
  assertInOrder(LAYOUT, [
    "<DashboardHeader />",
    "<SidebarInset",
    "{children}",
    "</SidebarInset>",
    "<SettingsModal",
  ]);
});

test("the viewport caps the shell and leaves route scrolling to the main pane", () => {
  assert.match(
    LAYOUT,
    /<SidebarProvider[\s\S]*className="[^"]*\bh-svh\b[^"]*\boverflow-hidden\b[^"]*"/
  );
  assert.match(
    LAYOUT,
    /<SidebarInset[\s\S]*className="[^"]*\bmin-h-0\b[^"]*\boverflow-auto\b[^"]*"[\s\S]*{children}[\s\S]*<\/SidebarInset>/
  );
});
