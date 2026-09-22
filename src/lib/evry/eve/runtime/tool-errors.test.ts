import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ForbiddenError } from "eve/channels/auth";
import { mockModel } from "eve/evals";
import { generateText, streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
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

test("returned preparation refusals and successful reviews retain their identity", async () => {
  for (const result of [
    {
      status: "invalid_input",
      issues: [{ path: "title", message: "Required" }],
    },
    { status: "unavailable", reason: "not_authorized" },
    { status: "needs_resolution", question: "Which meeting?" },
    { status: "awaiting_confirmation", title: "Review meeting changes" },
  ]) {
    assert.equal(
      await withSafeEveToolErrors(undefined, async () => result),
      result
    );
  }
});

test("both native entry points protect scope setup and all direct capabilities", () => {
  const direct = readFileSync("agent/tools/capability.ts", "utf8");
  assert.match(direct, /const execute = \(\) =>\s*withEveRuntimeScope/);
  assert.match(
    direct,
    /return withSafeEveToolErrors\(toolContext.abortSignal, execute\)/
  );
  assert.doesNotMatch(direct, /\bisRead\b/);
  const executor = direct.slice(
    direct.indexOf("execute: (input, toolContext) =>"),
    direct.indexOf("toModelOutput:")
  );
  assert.doesNotMatch(executor, /\bentry\b/);
  const composed = readFileSync("agent/tools/code_mode.ts", "utf8");
  assert.match(
    composed,
    /withSafeEveToolErrors\(ctx.abortSignal, \(\) =>\s*withEveRuntimeScope/
  );
});

test("installed Eve rejects a captured schema entry but persists canonical names", () => {
  // Use shipped Eve modules under plain Node, without tsx transforming them.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import assert from 'node:assert/strict';
       import { createRequire } from 'node:module';
       import { pathToFileURL } from 'node:url';
       import { defineTool } from 'eve/tools';
       import { z } from 'zod';
       const require = createRequire(import.meta.url);
       const moduleUrl = new URL('../../context/dynamic-tool-lifecycle.js', pathToFileURL(require.resolve('eve/tools')));
       const { validateDurableDynamicToolCallbacks } = await import(moduleUrl.href);
       const owner = {sessionId:'safe-error-capture-proof',scope:'step',resolverSlug:'capability',entryKey:'meetings_query',name:'meetings_query'};
       function authored(closure) {
         const callback = () => null;
         Object.defineProperty(callback, Symbol.for('eve:durable-dynamic-callback'), {value:{callback,closure}});
         return defineTool({description:'Read records',inputSchema:{type:'object',properties:{}},execute:callback});
       }
       assert.throws(() => validateDurableDynamicToolCallbacks('meetings_query', authored({entry:{effect:'read',inputSchema:z.object({})},name:'meetings.query'}), owner), /non-serializable capture/);
       for (const name of ['meetings.query','actions.prepare']) {
         const metadata = validateDurableDynamicToolCallbacks('meetings_query', authored({name}), owner);
         assert.deepEqual(metadata.execute.closure, {name});
       }`,
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: "" },
    }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const toolName of ["meetings_query", "actions_prepare"] as const)
  for (const mode of ["generate", "stream"] as const)
    test(`installed SDK ${mode} sends the exact ${toolName} failure to the next provider`, async () => {
      let modelCalls = 0;
      let verifiedFailures = 0;
      let successfulOutputProjections = 0;
      const model = mockModel({
        respond(request) {
          modelCalls++;
          if (modelCalls === 1)
            return {
              toolCalls: [
                { id: "failed-capability", name: toolName, input: {} },
              ],
            };
          assert.deepEqual(request.toolResults, [
            {
              id: "failed-capability",
              name: toolName,
              isError: true,
              output: `Error: ${EVE_TOOL_FAILURE_MESSAGE}`,
            },
          ]);
          assert.doesNotMatch(
            JSON.stringify(request),
            /private_column|private_table|private-value|params:/
          );
          verifiedFailures++;
          return "The source was unavailable.";
        },
      });
      const options = {
        model,
        prompt: "Read the meeting records.",
        stopWhen: stepCountIs(2),
        tools: {
          [toolName]: tool({
            inputSchema: z.object({}).strict(),
            execute: (): Promise<unknown> =>
              withSafeEveToolErrors(undefined, async () => {
                throw fault();
              }),
            toModelOutput: () => {
              successfulOutputProjections++;
              return { type: "text", value: "Unexpected success projection" };
            },
          }),
        },
      };
      const result =
        mode === "generate" ? await generateText(options) : streamText(options);
      if (mode === "stream" && "consumeStream" in result)
        await result.consumeStream();
      assert.equal(await result.text, "The source was unavailable.");
      assert.equal(modelCalls, 2);
      assert.equal(verifiedFailures, 1);
      assert.equal(successfulOutputProjections, 0);
    });
