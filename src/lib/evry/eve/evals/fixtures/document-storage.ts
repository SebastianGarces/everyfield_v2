import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { documentReviewFiles } from "./document-review";

export type DocumentFixtureTransport = (
  files: ReturnType<typeof documentReviewFiles>
) => Promise<() => Promise<void>>;

/** Configure these env values before importing storage.ts or spawning the host. */
export async function startDocumentFixtureStorage(
  options: { allowNativeUploads?: boolean } = {}
) {
  const objects = new Map<string, Uint8Array>();
  const requestedKeys: string[] = [];
  const server = createServer(async (request, response) => {
    if (
      request.method !== "GET" &&
      !(request.method === "PUT" && options.allowNativeUploads)
    ) {
      response.writeHead(405).end();
      return;
    }
    const key = decodeURIComponent(
      new URL(request.url!, "http://fixture.invalid").pathname
    ).replace(/^\/evry-fixture\//, "");
    requestedKeys.push(key);
    if (request.method === "PUT") {
      if (
        !/^evry-inputs\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-zA-Z0-9/._-]+$/.test(
          key
        ) ||
        key.includes("..")
      ) {
        response.writeHead(403).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 3 * 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      if (objects.has(key) && request.headers["if-none-match"] === "*") {
        response.writeHead(412).end();
        return;
      }
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200).end();
      return;
    }
    const body = objects.get(key);
    if (!body) {
      response
        .writeHead(404, { "content-type": "application/xml" })
        .end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    response
      .writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": body.length,
      })
      .end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const prepareFiles: DocumentFixtureTransport = async (files) => {
    for (const file of files)
      assert.ok(!objects.has(file.key), "Fixture object key must be unique");
    for (const file of files) objects.set(file.key, new Uint8Array(file.body));
    return async () => {
      for (const file of files) objects.delete(file.key);
    };
  };
  return {
    environment: {
      AWS_BUCKET_NAME: "evry-fixture",
      AWS_REGION: "us-east-1",
      AWS_ENDPOINT_URL_S3: `http://127.0.0.1:${address.port}`,
      AWS_ACCESS_KEY_ID: "isolated-fixture",
      AWS_SECRET_ACCESS_KEY: "isolated-fixture-secret",
    },
    prepareFiles,
    requestedKeys,
    async cleanup() {
      objects.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
