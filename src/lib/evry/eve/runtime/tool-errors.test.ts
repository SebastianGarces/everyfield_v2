import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ForbiddenError } from "eve/channels/auth";
import {
  isUnauthorized,
  UnauthorizedError,
  SESSION_EXPIRED_DIGEST,
} from "@/lib/auth/unauthorized";
import { EvryPlantViewerRefusalError } from "@/lib/evry/eligibility/viewer";
import { EVE_TOOL_FAILURE_MESSAGE, withSafeEveToolErrors } from "./tool-errors";

const secret =
  "select private_column from private_table; params: ['private-value']";
const fault = () =>
  Object.assign(new Error(secret, { cause: new Error(secret) }), {
    params: [secret],
  });

test("tool boundary strips exception messages, causes and properties without returning success", async () => {
  for (const error of [
    fault(),
    secret,
    { message: secret, cause: secret },
    null,
  ]) {
    await assert.rejects(
      withSafeEveToolErrors(undefined, async () => {
        throw error;
      }),
      (safe) => {
        assert.ok(safe instanceof Error);
        assert.equal(safe.message, EVE_TOOL_FAILURE_MESSAGE);
        assert.equal(safe.cause, undefined);
        assert.deepEqual(Object.keys(safe), []);
        assert.ok(!String(safe.stack).includes(secret));
        return true;
      }
    );
  }
});

test("known authentication refusals retain their classification but no attached details", async () => {
  for (const refusal of [
    new UnauthorizedError(),
    new ForbiddenError({ message: secret }),
    new EvryPlantViewerRefusalError(),
  ]) {
    Object.assign(refusal, { cause: fault(), params: [secret] });
    await assert.rejects(
      withSafeEveToolErrors(undefined, async () => {
        throw refusal;
      }),
      (safe) => {
        assert.ok(safe instanceof Error);
        assert.notEqual(safe, refusal);
        assert.equal(safe.cause, undefined);
        assert.ok(!JSON.stringify(safe).includes(secret));
        assert.ok(!safe.message.includes(secret));
        if (isUnauthorized(refusal)) {
          assert.ok(isUnauthorized(safe));
          assert.ok(safe instanceof UnauthorizedError);
          assert.equal(safe.digest, SESSION_EXPIRED_DIGEST);
        } else if (refusal instanceof ForbiddenError)
          assert.ok(safe instanceof ForbiddenError);
        else assert.ok(safe instanceof EvryPlantViewerRefusalError);
        return true;
      }
    );
  }
});

test("cancellation is safe before dispatch and after work rejects", async () => {
  const controller = new AbortController();
  controller.abort(fault());
  let invoked = false;
  await assert.rejects(
    withSafeEveToolErrors(controller.signal, async () => {
      invoked = true;
    }),
    { name: "AbortError", message: "The request was cancelled." }
  );
  assert.equal(invoked, false);
  const during = new AbortController();
  await assert.rejects(
    withSafeEveToolErrors(during.signal, async () => {
      during.abort(secret);
      throw fault();
    }),
    { name: "AbortError", message: "The request was cancelled." }
  );
  await assert.rejects(
    withSafeEveToolErrors(undefined, async () => {
      throw new DOMException(secret, "AbortError");
    }),
    { name: "AbortError", message: "The request was cancelled." }
  );
});

test("a failed scope/read stays rejected while successful peer results remain unchanged", async () => {
  const original = { status: "unavailable", reason: "not_authorized" };
  const results = await Promise.allSettled([
    withSafeEveToolErrors(undefined, async () => {
      throw fault();
    }),
    withSafeEveToolErrors(undefined, async () => original),
  ]);
  assert.equal(results[0]?.status, "rejected");
  assert.deepEqual(results[1], { status: "fulfilled", value: original });
});

test("both native entry points protect scope setup; direct preparation is unchanged", () => {
  const direct = readFileSync("agent/tools/capability.ts", "utf8");
  assert.match(direct, /const execute = \(\) =>\s*withEveRuntimeScope/);
  assert.match(
    direct,
    /entry.effect === "read"\s*\? withSafeEveToolErrors\(toolContext.abortSignal, execute\)\s*: execute\(\)/
  );
  const composed = readFileSync("agent/tools/code_mode.ts", "utf8");
  assert.match(
    composed,
    /withSafeEveToolErrors\(ctx.abortSignal, \(\) =>\s*withEveRuntimeScope/
  );
});
