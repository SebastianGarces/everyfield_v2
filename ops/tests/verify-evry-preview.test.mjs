import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyEvryPreview } from "../../scripts/verify-evry-preview.mjs";

const expected = {
  projectId: "project",
  branch: "codex/evry",
  sha: "a".repeat(40),
};
const ready = {
  id: "dpl_fixture",
  url: "fixture.vercel.app",
  projectId: expected.projectId,
  target: null,
  readyState: "READY",
  gitSource: { type: "github", ref: expected.branch, sha: expected.sha },
  env: ["OPENAI_API_KEY"],
};

test("ready preview proves configuration without claiming a chat response", () => {
  const result = verifyEvryPreview(ready, expected);
  assert.equal(result.openaiKeyPresent, true);
  assert.equal(result.chatResponse, "not_tested");
  assert.equal("env" in result, false);
});

test("metadata-only upload and missing key cannot pass preview handoff", () => {
  assert.throws(
    () =>
      verifyEvryPreview(
        {
          ...ready,
          gitSource: null,
          meta: { githubCommitRef: expected.branch },
        },
        expected
      ),
    /no Git source/
  );
  assert.throws(
    () => verifyEvryPreview({ ...ready, env: [] }, expected),
    /did not receive/
  );
});

test("wrong branch, commit, project, environment or unfinished build is rejected", () => {
  for (const change of [
    { gitSource: { ...ready.gitSource, ref: "main" } },
    { gitSource: { ...ready.gitSource, sha: "b".repeat(40) } },
    { projectId: "another-project" },
    { target: "production" },
    { readyState: "BUILDING" },
  ])
    assert.throws(() => verifyEvryPreview({ ...ready, ...change }, expected));
});
