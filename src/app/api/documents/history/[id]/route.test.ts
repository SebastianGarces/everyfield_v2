import assert from "node:assert/strict";
import { test } from "node:test";

import type { GeneratedDocument } from "@/db/schema";

import { createGeneratedDocumentDownloadHandler } from "./route";

const DOCUMENT_ID = "10000000-0000-4000-8000-000000000001";
const PLANT_ID = "20000000-0000-4000-8000-000000000001";

function documentRow(): GeneratedDocument {
  return {
    id: DOCUMENT_ID,
    churchId: PLANT_ID,
    userId: "30000000-0000-4000-8000-000000000001",
    templateId: "commitment-card",
    format: "pdf",
    storageKey: `documents/${PLANT_ID}/${DOCUMENT_ID}.pdf`,
    createdAt: new Date("2026-08-30T12:00:00.000Z"),
  };
}

test("document download authorizes before params and keeps refusals neutral", async () => {
  const calls: string[] = [];
  const handler = createGeneratedDocumentDownloadHandler({
    async authorize() {
      calls.push("authorize");
      return null;
    },
    async findDocument() {
      calls.push("find");
      return documentRow();
    },
    async readBytes() {
      calls.push("storage");
      return null;
    },
  });
  const params = {
    then(resolve: (value: { id: string }) => unknown) {
      calls.push("params");
      return Promise.resolve(resolve({ id: DOCUMENT_ID }));
    },
  } as Promise<{ id: string }>;
  const response = await handler(new Request("https://example.test"), {
    params,
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, ["authorize"]);
});

test("document download scopes the lookup and returns bytes without a key or redirect", async () => {
  const calls: string[] = [];
  const row = documentRow();
  const handler = createGeneratedDocumentDownloadHandler({
    async authorize() {
      calls.push("authorize");
      return { actor: { plantId: PLANT_ID } };
    },
    async findDocument(plantId, id) {
      calls.push(`find:${plantId}:${id}`);
      return row;
    },
    async readBytes(key) {
      calls.push(`storage:${key}`);
      return {
        body: Buffer.from("private bytes"),
        contentType: "application/pdf",
      };
    },
  });
  const response = await handler(new Request("https://example.test"), {
    params: Promise.resolve({ id: DOCUMENT_ID }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="commitment-card.pdf"'
  );
  assert.equal(await response.text(), "private bytes");
  assert.equal(
    JSON.stringify(Object.fromEntries(response.headers)).includes(
      row.storageKey
    ),
    false
  );
  assert.deepEqual(calls, [
    "authorize",
    `find:${PLANT_ID}:${DOCUMENT_ID}`,
    `storage:${row.storageKey}`,
  ]);
});
