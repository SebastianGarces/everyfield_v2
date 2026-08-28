import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(process.cwd(), "src");
const read = (...segments: string[]) =>
  readFileSync(path.join(ROOT, ...segments), "utf8");

const layout = read("app", "(dashboard)", "layout.tsx");
const shell = read("components", "evry", "evry-shell.tsx");
const launcher = read("components", "evry", "evry-launcher.tsx");
const panel = read("components", "evry", "evry-panel.tsx");
const workspace = read("components", "evry", "evry-workspace.tsx");
const surface = read("components", "evry", "conversation-surface.tsx");
const sheet = read("components", "ui", "sheet.tsx");
const resolver = read("lib", "evry", "resolvers", "page-context.ts");
const createRoute = read("app", "api", "evry", "conversations", "route.ts");
const appendRoute = read(
  "app",
  "api",
  "evry",
  "conversations",
  "[conversationId]",
  "messages",
  "route.ts"
);

test("one persistent shell owns the launcher, panel, and dedicated workspace state", () => {
  assert.match(
    layout,
    /<HeaderProvider>[\s\S]*<EvryShell enabled=\{evryEnabled\}>/
  );
  assert.match(
    layout,
    /<EvryShell[\s\S]*<GlobalAppBar[\s\S]*<EvryLauncher \/>[\s\S]*<SidebarInset[\s\S]*\{children\}[\s\S]*<\/EvryShell>/
  );
  assert.match(panel, /<ConversationSurface \/>/);
  assert.match(workspace, /<ConversationSurface \/>/);
  assert.doesNotMatch(workspace, /useState|setDraft|fetch\(/);
});

test("the launcher is absent unless the server-derived plant standing is eligible", () => {
  assert.match(
    layout,
    /const evryEnabled = evryPlantStandingOf\(user\)\.status === "eligible"/
  );
  assert.match(launcher, /if \(!isEnabled\) return null/);
  assert.match(launcher, /aria-haspopup="dialog"/);
  assert.match(launcher, /aria-expanded=\{isPanelOpen\}/);
});

test("the panel traps focus, closes on the dialog Escape behavior, restores focus, and fills narrow screens", () => {
  assert.match(panel, /<Sheet[\s\S]*modal=\{true\}/);
  assert.match(panel, /onOpenChange=\{\(open\) => !open && closePanel\(\)\}/);
  assert.match(panel, /onCloseAutoFocus=\{\(event\) => \{/);
  assert.match(panel, /restoreLauncherFocus\(\)/);
  assert.match(panel, /w-full max-w-none[\s\S]*sm:max-w-\[28rem\]/);
  assert.match(
    sheet,
    /data-slot="sheet-overlay"[\s\S]*motion-reduce:data-\[state=open\]:animate-none/
  );
  assert.match(
    sheet,
    /data-slot="sheet-content"[\s\S]*motion-reduce:transition-none/
  );
});

test("expand and browser Back retain provider state and reopen the panel", () => {
  assert.match(
    shell,
    /setExpandedFromPanel\(true\)[\s\S]*setPanelOpen\(false\)[\s\S]*router\.push\(`\/evry/
  );
  assert.match(
    shell,
    /if \(expandedFromPanel\) \{[\s\S]*setPanelOpen\(true\)[\s\S]*router\.back\(\)/
  );
  assert.match(workspace, /onClick=\{returnToPage\}/);
  assert.match(
    shell,
    /previousPathname === "\/evry"[\s\S]*pathname !== "\/evry"[\s\S]*setPanelOpen\(true\)/
  );
  assert.match(
    shell,
    /enabled && hasOpenedPanel \? <EvryPanel \/> : null/,
    "the mounted dialog must survive closing long enough to restore focus"
  );
});

test("workspace URL updates stay in the App Router and failed loads do not loop", () => {
  assert.match(
    shell,
    /router\.replace\(`\/evry\?conversation=\$\{nextConversation\.id\}`\)/
  );
  assert.doesNotMatch(shell, /window\.history\.replaceState/);
  assert.match(
    shell,
    /const loadingConversationIdRef = useRef<string \| null>\(null\)/
  );
  assert.match(shell, /loadingConversationIdRef\.current === conversationId/);
  assert.match(shell, /\[conversation\?\.id\]\s*\)/);
  assert.doesNotMatch(shell, /\[conversation\?\.id, isLoading\]/);
});

test("removing context removes it from the request body", () => {
  assert.match(surface, /onRemove=\{clearContext\}/);
  assert.match(
    shell,
    /const clearContext = useCallback\(\(\) => setActiveContext\(null\), \[\]\)/
  );
  assert.match(shell, /pageContext: activeContext\?\.wire \?\? null/);
});

test("both conversation writes resolve the untrusted hint after auth and before persistence", () => {
  for (const route of [createRoute, appendRoute]) {
    const auth = route.indexOf("const actor = await requireEvryPlantViewer()");
    const body = route.indexOf("body = await request.json()");
    const resolution = route.indexOf(
      "const pageContext = await resolvePageContext"
    );
    const write = Math.max(
      route.indexOf("await create({"),
      route.indexOf("await continueConversation({")
    );
    assert.ok(
      auth >= 0 && body > auth && resolution > body && write > resolution
    );
  }

  assert.match(resolver, /eq\(persons\.churchId, actor\.plantId\)/);
  assert.match(resolver, /eq\(churchMeetings\.churchId, actor\.plantId\)/);
  assert.match(resolver, /eq\(ministryTeams\.churchId, actor\.plantId\)/);
  assert.match(resolver, /eq\(tasks\.churchId, actor\.plantId\)/);
  assert.match(resolver, /eq\(launches\.churchId, actor\.plantId\)/);
  assert.match(resolver, /recordId === null[\s\S]*\? null/);
});
