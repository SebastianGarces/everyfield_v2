import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { fixtureMessageSchema } from "../http/transcript";
import type { CapturedCall } from "./host-capture";
import {
  commitmentDocumentQuestion,
  observedCommitmentDocumentEvidence,
  observedCommitmentDocument,
} from "./commitment-document";
import { createFixtureManifest } from "./manifest";

const person = "11111111-1111-4111-8111-111111111111";
const commitment = "22222222-2222-4222-8222-222222222222";
const href = `/api/evry/people/files/commitments/${commitment}`;
const artifact = {
  kind: "read",
  title: "Commitment document",
  counts: { matched: 1, returned: 1, excluded: 0 },
  filters: [],
  exclusions: [],
  sourceLinks: [],
  items: [
    {
      id: commitment,
      label: "Core Group commitment",
      facts: [{ label: "Signed", value: "2026-08-01" }],
      sourceLink: { label: "Download commitment", href },
    },
  ],
};
const history: CapturedCall = {
  id: "history",
  name: "people.history.query",
  input: { resource: { kind: "commitments" } },
  output: {
    kind: "read",
    counts: { matched: 3 },
    items: [
      {
        id: commitment,
        label: "Alex Rivera",
        facts: [{ label: "person_id", value: person }],
      },
    ],
  },
};
const download: CapturedCall = {
  id: "download",
  name: "people.commitment-download",
  input: { commitmentId: commitment },
  output: artifact,
};
const message = (shown = true) =>
  fixtureMessageSchema.parse({
    id: "a0",
    role: "assistant",
    metadata: { turnId: "turn_0", status: "complete" },
    parts: [
      {
        type: "dynamic-tool",
        toolName: download.name.replaceAll(".", "_"),
        toolCallId: "download",
        state: "output-available",
        input: download.input,
        output: {
          data: artifact,
          presentation: {
            version: 1,
            turnId: "turn_0",
            results: [{ reference: "download", artifacts: [artifact] }],
          },
        },
      },
      {
        type: "text",
        text: shown ? "[[evry-result:download]]" : "I found the record.",
      },
    ],
  });
const expected = {
  personIds: [person],
  documentIds: [commitment],
  downloadLinks: [href],
};
const empty = { personIds: [], documentIds: [], downloadLinks: [] };

test("commitment document keeps the original lookup question", () => {
  assert.deepEqual(questions.find((q) => q.id === "commitments-03")!.turns, [
    commitmentDocumentQuestion,
  ]);
});
test("the shown authorized document joins to recorded person history without requiring every unrelated page", () => {
  assert.deepEqual(
    observedCommitmentDocumentEvidence([history, download], [message()]),
    expected
  );
  const prose = fixtureMessageSchema.parse({
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: `[Download Alex's commitment](${href})` }],
  });
  assert.deepEqual(
    observedCommitmentDocumentEvidence([history, download], [prose]),
    expected
  );
});
test("a guessed link, absent history, wrong resource or late history is not a resolved document", () => {
  assert.deepEqual(
    observedCommitmentDocumentEvidence([history], [message()]),
    empty
  );
  assert.deepEqual(
    observedCommitmentDocumentEvidence([download], [message()]),
    empty
  );
  assert.deepEqual(
    observedCommitmentDocumentEvidence([download, history], [message()]),
    empty
  );
  assert.deepEqual(
    observedCommitmentDocumentEvidence(
      [{ ...history, input: { resource: { kind: "interviews" } } }, download],
      [message()]
    ),
    empty
  );
  assert.deepEqual(
    observedCommitmentDocumentEvidence(
      [
        {
          ...history,
          output: {
            kind: "read",
            counts: { matched: 1 },
            items: [{ id: commitment, label: "Alex" }],
          },
        },
        download,
      ],
      [message()]
    ),
    empty
  );
});
test("hidden, foreign-shaped, unavailable and failed-refreshed links do not pass", () => {
  assert.deepEqual(
    observedCommitmentDocumentEvidence([history, download], [message(false)]),
    empty
  );
  for (const output of [
    {
      ...artifact,
      items: [
        {
          ...artifact.items[0]!,
          sourceLink: {
            label: "Wrong",
            href: "https://bucket.example.test/private.pdf",
          },
        },
      ],
    },
    { ...artifact, counts: { matched: 0 }, items: [] },
    { error: "unavailable" },
  ]) {
    const failed = { ...download, id: "refresh", output };
    assert.deepEqual(
      observedCommitmentDocumentEvidence(
        [history, download, failed],
        [message()]
      ),
      empty
    );
  }
});
test("private-key exposure is detected in actual outputs and visible prose, not just returned links", () => {
  const key = "commitments/private-fixture/secret.pdf";
  const input = {
    manifest: createFixtureManifest("commitments-03", 0),
    store: { query: () => [{ document_url: key }] },
    calls: [history, download],
    messages: [message()],
  };
  assert.equal(observedCommitmentDocument(input).facts.storageKeysHidden, true);
  assert.equal(
    observedCommitmentDocument({
      ...input,
      calls: [
        ...input.calls,
        {
          id: "leak",
          name: "people.query",
          input: {},
          output: { privateKey: key },
        },
      ],
    }).facts.storageKeysHidden,
    false
  );
  assert.equal(
    observedCommitmentDocument({
      ...input,
      messages: [
        ...input.messages,
        fixtureMessageSchema.parse({
          id: "leak",
          role: "assistant",
          parts: [{ type: "text", text: key }],
        }),
      ],
    }).facts.storageKeysHidden,
    false
  );
});
