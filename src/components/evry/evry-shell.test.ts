import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(process.cwd(), "src");
const read = (...segments: string[]) =>
  readFileSync(path.join(ROOT, ...segments), "utf8");

const layout = read("app", "(dashboard)", "layout.tsx");
const shell = read("components", "evry", "evry-shell.tsx");
const interaction = read("components", "evry", "interaction-state.ts");
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
    /<HeaderProvider>[\s\S]*<EvryShell[\s\S]*enabled=\{evryEnabled\}[\s\S]*eligibleSuggestions=\{evrySuggestions\}/
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

test("workspace URL sync cannot compete with App Router navigation and loads use the latest-attempt gate", () => {
  assert.match(
    workspace,
    /syncEvryWorkspaceConversationHistory\([\s\S]*window\.history\.state,[\s\S]*window\.History\.prototype\.replaceState\.call\([\s\S]*window\.history,[\s\S]*conversationId,[\s\S]*conversation\?\.id \?\? null/
  );
  assert.doesNotMatch(workspace, /useRouter|router\.replace|router\.push/);
  assert.doesNotMatch(shell, /router\.replace|window\.history\.replaceState/);
  assert.match(
    shell,
    /const conversationLoadStateRef = useRef\([\s\S]*initialEvryConversationLoadState\(\)/
  );
  assert.match(shell, /isLatestEvryConversationLoad\([\s\S]*load\.attempt/);
  assert.match(shell, /finishEvryConversationLoad\([\s\S]*load\.attempt/);
  assert.match(
    shell,
    /canApplyEvryConversationLoadResponse\([\s\S]*loadedConversation\.id/
  );
  assert.match(
    shell,
    /conversationLoadStateRef\.current = load\.state;[\s\S]*setConversation\(null\);[\s\S]*setRequestedConversationId\(conversationId\)/
  );
  assert.match(
    shell,
    /requestedConversationId !== null \|\|[\s\S]*conversationLoadStateRef\.current\.latest !== null/
  );
  assert.match(shell, /\[conversation\?\.id\]\s*\)/);
  assert.doesNotMatch(shell, /\[conversation\?\.id, isLoading\]/);
});

test("the mounted workspace owns query sync and send preserves in-flight edits", () => {
  assert.match(
    shell,
    /setDraft\(evryDraftAfterSubmission\(draftRef\.current, message\)\)/
  );
  assert.match(
    interaction,
    /urlConversationId === null && mountedConversationId !== null[\s\S]*`\/evry\?conversation=\$\{mountedConversationId\}`[\s\S]*: null/
  );
  assert.match(interaction, /nativeReplaceState\(historyState, "", href\)/);
  assert.match(
    interaction,
    /currentDraft === submittedDraft \? "" : currentDraft/
  );
});

test("message retries keep their semantic request identity until success", () => {
  assert.match(
    shell,
    /const pendingSubmissionRef = useRef<PendingEvrySubmission \| null>\(null\)/
  );
  assert.match(
    shell,
    /pendingEvrySubmissionFor\([\s\S]*pendingSubmissionRef\.current[\s\S]*conversationId:[\s\S]*message,[\s\S]*pageContext/
  );
  assert.match(shell, /evryConversationRequestBody\(pendingSubmission\)/);
  assert.match(interaction, /requestKey: submission\.requestKey/);
  assert.match(
    shell,
    /const nextConversation = await responseConversation\(response\);[\s\S]*pendingSubmissionRef\.current = null/
  );
  assert.doesNotMatch(shell, /requestKey: crypto\.randomUUID\(\)/);
  assert.match(
    surface,
    /draft\.trim\(\)\.length === 0 \|\| isSending \|\| isComposerBlocked/
  );
  assert.match(shell, /const message = evrySubmissionMessage\(draft\)/);
});

test("the transcript is a live attributed log and renders server-owned context labels", () => {
  assert.match(surface, /role="log"/);
  assert.match(surface, /aria-live="polite"/);
  assert.match(surface, /aria-relevant="additions text"/);
  assert.match(surface, /message\.author === "user" \? "You" : "Evry"/);
  assert.match(surface, /message\.pageContext\.label/);
  assert.doesNotMatch(surface, /CONTEXT_KIND_LABELS/);
});

test("loading remains understandable without motion", () => {
  assert.equal(
    surface.match(/animate-spin motion-reduce:animate-none/g)?.length,
    2
  );
  assert.match(surface, /Opening conversation…/);
  assert.match(surface, /Sending…/);
});

test("removing context removes it from the request body", () => {
  assert.match(surface, /onRemove=\{clearContext\}/);
  assert.match(
    shell,
    /const clearContext = useCallback\(\(\) => setActiveContext\(null\), \[\]\)/
  );
  assert.match(
    shell,
    /const pageContext = activeContext\?\.wire \?\? null[\s\S]*evryConversationRequestBody\(pendingSubmission\)/
  );
  assert.match(interaction, /pageContext: submission\.pageContext/);
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
  assert.match(resolver, /record === null[\s\S]*\? null/);
  assert.match(resolver, /firstName: persons\.firstName/);
  assert.match(resolver, /title: churchMeetings\.title/);
  assert.match(resolver, /name: ministryTeams\.name/);
  assert.match(resolver, /title: tasks\.title/);
  assert.match(resolver, /label: "Launch Sunday"/);
});
