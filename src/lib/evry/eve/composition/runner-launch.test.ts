import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompositionBudget, runEvryComposition } from "./runner";
import { selectRuntimeTools } from "../runtime/tool-selection";

test("captured launch composition rejects flat arguments and succeeds with the discovered query wrapper after direct-tool replacement", async () => {
  process.env.DATABASE_URL ??=
    "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  process.env.RESEND_API_KEY ??= "re_isolated_fixture_no_delivery";
  const { eveRuntimeToolSchema } = await import("../runtime/tool-schemas");
  const descriptions = ["launch.query", "teams.get_many"].map((name) => ({
    name,
    description: name,
    effect: "read" as const,
    inputSchema: eveRuntimeToolSchema(name),
  }));
  // load_tools replaces provider discovery, not the authorized composition registry.
  const selected = selectRuntimeTools(["teams.get_many"], descriptions);
  assert.deepEqual(selected, ["teams.get_many"]);
  const calls: { name: string; input: unknown }[] = [];
  const registry = {
    describe: () => descriptions,
    invoke: async (name: string, input: unknown) => {
      calls.push({ name, input });
      return { fixture: "milestones" };
    },
  };
  const options = {
    registry,
    callId: "launch-repro",
    budget: createCompositionBudget(),
  };
  const rejected = await runEvryComposition({
    ...options,
    js: "const r = await tools['launch.query']({resource:'milestones', completion:'open', limit:50, offset:0}); return r;",
  });
  assert.deepEqual(rejected, {
    status: "failed",
    reason: "invalid_input",
    toolName: "launch.query",
    requiredFields: ["query"],
    calls: 0,
  });
  assert.deepEqual(calls, []);
  assert.equal(options.budget.used, 0);
  const corrected = await runEvryComposition({
    ...options,
    js: "const r = await tools['launch.query']({query:{resource:'milestones', completion:'open', limit:50, offset:0}}); return r;",
  });
  assert.deepEqual(corrected, {
    status: "completed",
    output: { fixture: "milestones" },
    calls: 1,
  });
  assert.deepEqual(calls, [
    {
      name: "launch.query",
      input: {
        query: {
          resource: "milestones",
          mode: "list",
          limit: 50,
          offset: 0,
          completion: "open",
          blockedByOverdueTask: false,
          groupBy: "status",
        },
      },
    },
  ]);
  assert.deepEqual(selected, ["teams.get_many"]);
});
