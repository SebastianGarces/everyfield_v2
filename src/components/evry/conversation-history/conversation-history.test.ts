import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(
  process.cwd(),
  "src/components/evry/conversation-history"
);
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const list = read("history-list.tsx");
const workspace = read("conversation-history-workspace.tsx");
const checkpoint = read("history-checkpoint.tsx");

test("history is a labelled keyboard list with explicit result announcements", () => {
  assert.match(list, /<form[\s\S]*role="search"/);
  assert.match(list, /<label htmlFor="evry-history-search"/);
  assert.match(list, /type="search"/);
  assert.match(list, /<nav aria-label="Conversation history">/);
  assert.match(list, /aria-current=\{selected \? "page" : undefined\}/);
  assert.match(list, /<time[\s\S]*dateTime=\{conversation\.lastActivityAt\}/);
  assert.match(list, /role="status"[\s\S]*aria-live="polite"/);
});

test("the two-pane workspace collapses to one operable pane on narrow screens", () => {
  assert.match(
    workspace,
    /lg:grid-cols-\[minmax\(17rem,21rem\)_minmax\(0,1fr\)\]/
  );
  assert.match(workspace, /hasDetail \? "hidden" : "flex"/);
  assert.match(workspace, /hasDetail \? "flex" : "hidden"/);
  assert.match(workspace, /aria-label="Back to conversations"[\s\S]*lg:hidden/);
  assert.match(list, /\[content-visibility:auto\]/);
});

test("a stale checkpoint offers rebuild and never an active confirm control", () => {
  assert.match(checkpoint, /checkpoint\.rebuildRequired \? \(/);
  assert.match(checkpoint, />\s*Rebuild plan\s*</);
  assert.doesNotMatch(checkpoint, />\s*Confirm\s*</);
  assert.match(
    workspace,
    /latestEvryHistoryCheckpoint\(selectedConversation\)/
  );
  assert.match(
    workspace,
    /messages\.find\(\(\{ author \}\) => author === "user"\)/
  );
  assert.match(workspace, /void sendMessageText\(rebuildMessage\)/);
  assert.match(checkpoint, /disabled=\{disabled\}/);
});

test("conversation changes are blocked while send, load, or direct selection owns the workspace", () => {
  assert.match(
    workspace,
    /const blocked =[\s\S]*isLoading \|\|[\s\S]*isSending \|\|[\s\S]*isConversationNavigationPending \|\|[\s\S]*isNewComposerResetPending/
  );
  assert.match(
    workspace,
    /<ConversationOpeningStatus statusRef=\{detailStatusRef\} \/>/
  );
  assert.match(workspace, /canUseEvryHistoryComposer\(/);
  assert.match(
    workspace,
    /function selectConversation[\s\S]*setRouteConversationId\(nextConversationId\)[\s\S]*window\.history\.pushState/
  );
  assert.match(
    workspace,
    /routeConversationId === conversation\?\.id[\s\S]*void loadConversation\(routeConversationId\)/
  );
  assert.match(list, /aria-disabled=\{blocked \|\| undefined\}/);
  assert.match(list, /if \(blocked\) \{[\s\S]*event\.preventDefault\(\)/);
  assert.match(list, /disabled=\{blocked \|\| isSearchPending\}/);
  assert.match(
    workspace,
    /destinationPane\.contains\(document\.activeElement\)/
  );
  assert.match(workspace, /detailHeadingRef\.current[\s\S]*\.focus\(\)/);
  assert.match(workspace, /historyHeadingRef\.current\?\.focus\(\)/);
});

test("list Back and inherited composer state do not reset each other", () => {
  assert.match(workspace, /shouldRestoreEvryNewComposer\(/);
  assert.match(
    workspace,
    /const selectedConversationId = evryHistorySelectedConversationId\(/
  );
  assert.match(
    workspace,
    /function showConversationList[\s\S]*createdConversationSyncMarkerRef\.current = null;[\s\S]*window\.history\.pushState/
  );
  const showList = workspace.slice(
    workspace.indexOf("function showConversationList"),
    workspace.indexOf("function startNew")
  );
  assert.doesNotMatch(showList, /resetConversation\(\)/);
});
