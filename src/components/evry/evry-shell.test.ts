import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(`src/components/evry/${file}`, "utf8");

test("production shell uses Eve native transport, not the retired model/run endpoints", () => {
  assert.match(read("eve-client/session.tsx"), /useEveAgent/);
  assert.match(read("eve-client/session.tsx"), /optimistic: true/);
  assert.doesNotMatch(read("evry-shell.tsx"), /readEvryConversationStream|reconnectEvryRun|\/api\/evry\/(?:requests|runs|conversations)|attachments\/plan/);
});

test("chat keeps one shared surface, floating composer, bounded reading width and no streaming-follow effect", () => {
  const surface = read("conversation-surface.tsx");
  assert.match(read("evry-panel.tsx"), /<ConversationSurface \/>/);
  assert.match(read("evry-workspace.tsx"), /conversationSurface=\{<ConversationSurface \/>\}/);
  assert.match(surface, /max-w-3xl/);
  assert.match(surface, /data-slot="evry-composer"/);
  assert.match(surface, /\[overflow-anchor:none\]/);
  assert.match(surface, /positionedResponseRef.current !== responseKey/);
  assert.match(surface, /projectEveMessage\(message\)/);
  assert.doesNotMatch(surface, /JSON.stringify\(.*(?:part|output)|reasoning/);
});

test("exact confirmation remains outside the native model response path", () => {
  const artifact = read("artifacts/production-artifact.tsx");
  assert.match(artifact, /\/api\/evry\/eve\/plans\//);
  assert.match(artifact, /JSON.stringify\(\{ fingerprint, action \}\)/);
  assert.doesNotMatch(artifact, /respondToQuestion|\.respond\(/);
});
