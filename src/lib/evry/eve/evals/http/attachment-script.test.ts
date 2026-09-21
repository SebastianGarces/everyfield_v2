import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fixtureAttachmentReferencesHidden,
  resolveScriptedAttachmentInput,
} from "./attachment-script";

const attachmentId = "eb7fc8d5-3a68-48d7-a0ed-8e269c178e06";
const messages = [
  { text: `Uploaded file: ${JSON.stringify({ attachmentId })}` },
];

test("the exact scripted sentinel resolves only after the actual request contains its binding", () => {
  const input = {
    operation: "people.import_file",
    input: { attachmentId: "$attachment:0" },
    values: ["$attachment:0"],
  };
  assert.deepEqual(
    resolveScriptedAttachmentInput(input, attachmentId, messages),
    {
      operation: "people.import_file",
      input: { attachmentId },
      values: [attachmentId],
    }
  );
  assert.equal(
    input.input.attachmentId,
    "$attachment:0",
    "fixture definition remains immutable"
  );
  assert.throws(
    () => resolveScriptedAttachmentInput(input, attachmentId, []),
    /was not visible/
  );
  assert.throws(
    () => resolveScriptedAttachmentInput(input, undefined, messages),
    /was not visible/
  );
  assert.throws(
    () =>
      resolveScriptedAttachmentInput(input, attachmentId, [
        { text: "Uploaded file name only" },
      ]),
    /was not visible/
  );
});

test("script substitution never rewrites code, prose, keys or other placeholders", () => {
  const input = {
    "$attachment:0": "prefix $attachment:0",
    program: 'return tools.call({attachmentId: "$attachment:0"})',
    untouched: "$attachment:1",
    values: [null, true, 4],
  };
  assert.deepEqual(resolveScriptedAttachmentInput(input, undefined, []), input);
  assert.equal(
    resolveScriptedAttachmentInput(undefined, undefined, []),
    undefined
  );
});

test("signed references cannot escape in any captured result or error field", () => {
  const reference = "signed-fixture-reference.private-payload.signature";
  assert.equal(
    fixtureAttachmentReferencesHidden(
      { attachmentId, digest: "fixture-digest" },
      [reference]
    ),
    true
  );
  for (const output of [
    reference,
    { nested: [{ output: reference }] },
    { phase: `Failure: ${reference}` },
  ])
    assert.equal(fixtureAttachmentReferencesHidden(output, [reference]), false);
  const escaped = 'signed-"private"-reference';
  assert.equal(
    fixtureAttachmentReferencesHidden({ error: escaped }, [escaped]),
    false
  );
  assert.equal(fixtureAttachmentReferencesHidden({}, []), true);
  assert.equal(fixtureAttachmentReferencesHidden({}, [""]), false);
});
