import assert from "node:assert/strict";
import { test } from "node:test";

import { EVRY_POLICY_MODEL_ID, getEvryPolicyModel } from "./provider";

test("the benchmark-selected Evry policy model is the production model", () => {
  assert.equal(EVRY_POLICY_MODEL_ID, "gpt-5.6-luna");
});

test("the provider resolves lazily and fails explicitly without a key", () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => getEvryPolicyModel(), /OPENAI_API_KEY is not set/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test("the provider returns the selected model when configured", () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  try {
    const model = getEvryPolicyModel();
    assert.notEqual(typeof model, "string");
    if (typeof model !== "string") {
      assert.equal(model.modelId, EVRY_POLICY_MODEL_ID);
    }
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});
