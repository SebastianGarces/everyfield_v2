import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { readsAsAnImperative } from "@/lib/auth/read-only-surfaces";

import {
  ADMINS_SEND_THE_MESSAGES,
  communicationEmptyStateLine,
  communicationHubSubtitle,
} from "./presentation";

// ============================================================================
// #666 — the Communication Hub stops telling a Member to send messages.
//
// The hub's subtitle read "Send messages and track communication with your
// people" to every seat. `communication.send` is ADMIN_PLUS, so a plant Member
// was being instructed to do the one thing `requireSeat` refuses them, on a
// page whose own empty state already told them who sends.
// ============================================================================

test("the subtitle asks the sender to send and tells everyone else what they can read", () => {
  const sender = communicationHubSubtitle(true);
  assert.ok(
    readsAsAnImperative(sender),
    "the seat that holds `communication.send` is the one the header may address"
  );

  const member = communicationHubSubtitle(false);
  assert.ok(
    !readsAsAnImperative(member),
    `a Member reads "${member}" — an imperative for a write they do not hold is the #666 defect`
  );
  // Not merely non-imperative: it has to say what the page is FOR them, or the
  // fix is a header that has gone quiet rather than one that has been matched.
  assert.match(member, /sent/);
  assert.notEqual(member, sender);
});

test("the empty state states who sends rather than inviting a refused send", () => {
  assert.ok(readsAsAnImperative(communicationEmptyStateLine(true)));

  const member = communicationEmptyStateLine(false);
  assert.equal(member, ADMINS_SEND_THE_MESSAGES);
  assert.ok(
    !readsAsAnImperative(member),
    "the empty state invited a Member to send a first message they would be refused"
  );
});

test("the two Member sentences answer the same question without repeating it", () => {
  // Both render together on an empty hub. #659's defect was two surfaces
  // DISAGREEING about who acts; the failure mode in the other direction is a
  // page that says the same sentence twice, which reads as a bug.
  assert.notEqual(
    communicationHubSubtitle(false),
    communicationEmptyStateLine(false)
  );
});

test("no communication surface spells this copy itself", () => {
  // The condition is one fact. A second literal in a page or a component is the
  // drift this module exists to prevent, and these two directories are where it
  // would grow back.
  const roots = [
    path.join(process.cwd(), "src", "app", "(dashboard)", "communication"),
    path.join(process.cwd(), "src", "components", "communication"),
  ];

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        files.push(full);
      }
    }
  };
  roots.forEach(walk);
  assert.ok(files.length > 0, "found no communication surfaces to scan");

  const sentences = [
    ADMINS_SEND_THE_MESSAGES,
    communicationHubSubtitle(true),
    communicationHubSubtitle(false),
    communicationEmptyStateLine(true),
  ];

  const offenders: string[] = [];
  for (const file of files) {
    // Comments off: a doc comment that QUOTES a sentence is documentation, not
    // a second spelling of it.
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    for (const sentence of sentences) {
      if (code.includes(sentence)) {
        offenders.push(`${path.relative(process.cwd(), file)}: "${sentence}"`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files spell the capability-matched copy themselves instead of importing it from presentation.ts:\n${offenders.join("\n")}`
  );
});
