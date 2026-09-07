import assert from "node:assert/strict";
import { test } from "node:test";

import { createFileIfAbsent } from "./storage";

test("conditional object create uses If-None-Match and maps 412 to exists", async () => {
  const commands: unknown[] = [];
  const result = await createFileIfAbsent(
    "evry-inputs/plant/actor/chunk.part",
    Buffer.from("chunk"),
    "application/octet-stream",
    async (command) => {
      commands.push(command.input);
      throw { $metadata: { httpStatusCode: 412 } };
    }
  );

  assert.equal(result, "exists");
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], {
    ...(process.env.AWS_BUCKET_NAME
      ? { Bucket: process.env.AWS_BUCKET_NAME }
      : { Bucket: undefined }),
    Key: "evry-inputs/plant/actor/chunk.part",
    Body: Buffer.from("chunk"),
    ContentType: "application/octet-stream",
    IfNoneMatch: "*",
  });
});

test("conditional 409 races retry until the provider gives a truthful result", async () => {
  let sends = 0;
  const result = await createFileIfAbsent(
    "evry-inputs/plant/actor/chunk.part",
    Buffer.from("chunk"),
    "application/octet-stream",
    async (command) => {
      sends += 1;
      assert.equal(command.input.IfNoneMatch, "*");
      if (sends === 1) throw { $metadata: { httpStatusCode: 409 } };
      throw { $metadata: { httpStatusCode: 412 } };
    }
  );

  assert.equal(result, "exists");
  assert.equal(sends, 2);
});

test("unresolved conditional conflicts fail instead of claiming success", async () => {
  let sends = 0;
  await assert.rejects(
    createFileIfAbsent(
      "evry-inputs/plant/actor/chunk.part",
      Buffer.from("chunk"),
      "application/octet-stream",
      async () => {
        sends += 1;
        throw { $metadata: { httpStatusCode: 409 } };
      }
    )
  );
  assert.equal(sends, 3);
});
