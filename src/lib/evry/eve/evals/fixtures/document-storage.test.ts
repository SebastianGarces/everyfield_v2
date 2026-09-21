import assert from "node:assert/strict";
import { test } from "node:test";
import { startDocumentFixtureStorage } from "./document-storage";

const key =
  "evry-inputs/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/upload/chunk-0";
test("fixture storage rejects uploads by default", async () => {
  const storage = await startDocumentFixtureStorage();
  try {
    const response = await fetch(
      `${storage.environment.AWS_ENDPOINT_URL_S3}/evry-fixture/${key}`,
      { method: "PUT", body: "data" }
    );
    assert.equal(response.status, 405);
  } finally {
    await storage.cleanup();
  }
});

test("opt-in fixture uploads preserve exact bytes and conditional creation", async () => {
  const storage = await startDocumentFixtureStorage({
    allowNativeUploads: true,
  });
  try {
    const url = `${storage.environment.AWS_ENDPOINT_URL_S3}/evry-fixture/${key}`;
    const first = await fetch(url, {
      method: "PUT",
      headers: { "if-none-match": "*" },
      body: "original",
    });
    assert.equal(first.status, 200);
    const duplicate = await fetch(url, {
      method: "PUT",
      headers: { "if-none-match": "*" },
      body: "replacement",
    });
    assert.equal(duplicate.status, 412);
    assert.equal(await (await fetch(url)).text(), "original");
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    assert.equal(
      (
        await fetch(
          `${storage.environment.AWS_ENDPOINT_URL_S3}/evry-fixture/documents/file`,
          { method: "PUT", body: "wrong namespace" }
        )
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${url}/oversize`, {
          method: "PUT",
          body: new Uint8Array(3 * 1024 * 1024 + 1),
        })
      ).status,
      413
    );
  } finally {
    await storage.cleanup();
  }
});
