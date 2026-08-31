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
const evryPage = read("app", "(dashboard)", "evry", "page.tsx");
const historyWorkspace = read(
  "components",
  "evry",
  "conversation-history",
  "conversation-history-workspace.tsx"
);
const historyList = read(
  "components",
  "evry",
  "conversation-history",
  "history-list.tsx"
);
const surface = read("components", "evry", "conversation-surface.tsx");
const workStatus = read("components", "evry", "streaming", "work-status.tsx");
const runRecoveryFixture = read(
  "components",
  "evry",
  "streaming",
  "run-recovery-browser-fixture.tsx"
);
const runRecoveryPreviewRoute = read(
  "app",
  "api",
  "evry",
  "runs",
  "preview-fixture",
  "route.ts"
);
const runRecoveryPreviewService = read(
  "lib",
  "evry",
  "runs",
  "preview-fixture.ts"
);
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
const conversationService = read("lib", "evry", "conversations", "service.ts");

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
  assert.match(workspace, /<ConversationHistoryWorkspace/);
  assert.match(workspace, /conversationSurface=\{<ConversationSurface \/>\}/);
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

test("New keeps modifier navigation and uses a shallow current-tab transition", () => {
  assert.match(evryPage, /params\.new === "1"/);
  assert.match(evryPage, /newConversation=\{newConversation\}/);
  assert.match(
    historyWorkspace,
    /newConversationHref=\{evryHistoryHref\(\{[\s\S]*newConversation: true/
  );
  assert.match(
    historyList,
    /<a[\s\S]*href=\{newConversationHref\}[\s\S]*event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey[\s\S]*event\.altKey/
  );
  assert.match(historyList, /event\.preventDefault\(\);[\s\S]*onNew\(\)/);
  assert.match(historyWorkspace, /window\.history\.pushState/);
});

test("workspace URL sync cannot compete with App Router navigation and loads use the latest-attempt gate", () => {
  assert.match(
    historyWorkspace,
    /syncEvryWorkspaceConversationHistory\([\s\S]*window\.history\.state,[\s\S]*window\.History\.prototype\.replaceState\.call\([\s\S]*window\.history,[\s\S]*null,[\s\S]*decision\.conversationIdToSync/
  );
  assert.doesNotMatch(workspace, /useRouter|router\.replace|router\.push/);
  assert.doesNotMatch(workspace, /loadConversation/);
  assert.doesNotMatch(historyWorkspace, /previousConversationIdRef/);
  assert.match(
    historyWorkspace,
    /ownsNewConversation \|\|[\s\S]*routeConversationId === null \|\|[\s\S]*routeConversationId === conversation\?\.id/
  );
  assert.match(
    historyWorkspace,
    /\}, \[conversation\?\.id, routeConversationId, searchQuery\]\);/
  );
  assert.match(
    historyWorkspace,
    /setRouteConversationId\(nextConversationId\)[\s\S]*loadConversation\(nextConversationId\)/
  );
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
  assert.match(shell, /if \(isSending \|\| isWorking\) return/);
  assert.match(
    shell,
    /\[conversation\?\.id, isSending, isWorking, presentWork\]\s*\)/
  );
  assert.match(
    shell,
    /setConversation\(loadedConversation\);[\s\S]*presentWork\([\s\S]*evryWorkStateForConversation\(loadedConversation\)/,
    "durable progress is presented without turning a finished load into pending work"
  );
  assert.match(
    shell,
    /const beginWork = useCallback\([\s\S]*pendingWorkRequestIdRef\.current = requestId;[\s\S]*setPendingWorkRequestId\(requestId\)/,
    "only locally initiated work should block conversation navigation"
  );
});

test("the mounted workspace owns query sync and send preserves in-flight edits", () => {
  assert.match(
    shell,
    /setDraft\(evryDraftAfterSubmission\(draftRef\.current, message\)\)/
  );
  assert.match(
    interaction,
    /urlConversationId !== null \|\| mountedConversationId === null[\s\S]*params\.set\("conversation", mountedConversationId\)/
  );
  assert.match(interaction, /nativeReplaceState\(historyState, "", href\)/);
  assert.match(
    interaction,
    /currentDraft === submittedDraft \? "" : currentDraft/
  );
  assert.match(
    shell,
    /mountedConversationIdRef = useRef<string \| null>\(null\)/
  );
  assert.match(
    shell,
    /mountedConversationId !== loadedConversationId[\s\S]*This conversation changed before the message was sent/
  );
  assert.match(
    shell,
    /pendingEvrySubmissionFor\([\s\S]*conversationId: mountedConversationId,[\s\S]*writeEvryRunRecoveryMarker\([\s\S]*conversationId: mountedConversationId/
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
    /const streamed = await readEvryConversationStream\(response,[\s\S]*pendingSubmissionRef\.current = null/
  );
  assert.doesNotMatch(shell, /requestKey: crypto\.randomUUID\(\)/);
  assert.match(
    surface,
    /draft\.trim\(\)\.length === 0 \|\| isSending \|\| isComposerBlocked/
  );
  assert.match(shell, /const message = evrySubmissionMessage\(draft\)/);
});

test("the transcript is an attributed review log and one dedicated status owns announcements", () => {
  assert.match(surface, /role="log"/);
  assert.match(surface, /aria-live="off"/);
  assert.match(surface, /aria-relevant="additions text"/);
  assert.match(workStatus, /role="status" aria-live="polite"/);
  assert.match(workStatus, /role="alert"[\s\S]*aria-live="assertive"/);
  assert.doesNotMatch(workStatus, /aria-busy=/);
  assert.doesNotMatch(historyWorkspace, /role="status"|aria-live=/);
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

test("the synthetic streaming lifecycle is preview-only and split from the production bundle", () => {
  assert.match(
    evryPage,
    /process\.env\.VERCEL_ENV === "preview"[\s\S]*params\.artifactFixture === "streaming-states"/
  );
  assert.match(
    workspace,
    /const EvryStreamingBrowserFixture = dynamic\(\(\) =>[\s\S]*import\("@\/components\/evry\/streaming\/browser-fixture"\)/
  );
});

test("the reconnect fixture is preview-only and uses server-owned durable proof", () => {
  assert.match(
    evryPage,
    /process\.env\.VERCEL_ENV === "preview"[\s\S]*params\.artifactFixture === "stream-reconnect"/
  );
  assert.match(
    workspace,
    /const EvryRunRecoveryBrowserFixture = dynamic\(\(\) =>[\s\S]*import\("@\/components\/evry\/streaming\/run-recovery-browser-fixture"\)/
  );
  assert.match(
    runRecoveryPreviewRoute,
    /process\.env\.VERCEL_ENV !== "preview"/
  );
  assert.match(runRecoveryPreviewRoute, /requireEvryPlantViewer\(\)/);
  assert.match(runRecoveryFixture, /\/api\/evry\/runs\/preview-fixture/);
  assert.match(runRecoveryFixture, /writeEvryRunRecoveryMarker/);
  assert.match(runRecoveryFixture, /window\.location\.reload\(\)/);
  assert.doesNotMatch(runRecoveryFixture, /starts:\s*1|effectCount:\s*1/);
  assert.match(runRecoveryPreviewService, /runs\.claim\(/);
  assert.match(runRecoveryPreviewService, /startExecution\(/);
  assert.match(runRecoveryPreviewService, /recordStep\(/);
  assert.match(runRecoveryPreviewService, /append\(/);
  assert.match(runRecoveryFixture, /data-testid="reconnect-work-starts"/);
  assert.match(runRecoveryFixture, /data-testid="reconnect-effect-count"/);
  assert.match(runRecoveryFixture, /data-testid="reconnect-attempt-id"/);
  assert.match(runRecoveryFixture, /data-testid="reconnect-result"/);
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

test("conversation writes authenticate first and continuation replay precedes context resolution", () => {
  const createAuth = createRoute.indexOf(
    "const actor = await requireEvryPlantViewer()"
  );
  const createBody = createRoute.indexOf("body = await request.json()");
  const createResolution = createRoute.indexOf(
    "const pageContext = await resolvePageContext"
  );
  const createWrite = createRoute.indexOf("create({");
  assert.ok(
    createAuth >= 0 &&
      createBody > createAuth &&
      createResolution > createBody &&
      createWrite > createResolution
  );

  const appendAuth = appendRoute.indexOf(
    "const actor = await requireEvryPlantViewer()"
  );
  const appendBody = appendRoute.indexOf("body = await request.json()");
  const deferredResolution = appendRoute.indexOf(
    "const resolveRequestPageContext = () =>"
  );
  const appendWrite = appendRoute.indexOf("continueConversation({");
  assert.ok(
    appendAuth >= 0 &&
      appendBody > appendAuth &&
      deferredResolution > appendBody &&
      appendWrite > deferredResolution
  );

  const replayCheck = conversationService.indexOf(
    "hasDurableEvryCapabilityConversationResult"
  );
  const resolution = conversationService.indexOf(
    "const pageContext = input.resolvePageContext"
  );
  const persistence = conversationService.indexOf(
    "let appended = await appendTrustedEvryConversationMessage"
  );
  assert.ok(
    replayCheck >= 0 && resolution > replayCheck && persistence > resolution
  );

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
