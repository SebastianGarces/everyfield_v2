import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Configuration proof only. A live chat response still needs its own test. */
export function verifyEvryPreview(deployment, expected) {
  assert.equal(deployment.readyState, "READY", "Preview is not ready");
  assert.equal(deployment.target, null, "Expected a preview, not production");
  assert.equal(deployment.projectId, expected.projectId, "Wrong project");
  assert.equal(
    deployment.gitSource?.type,
    "github",
    "Preview has no Git source"
  );
  assert.equal(deployment.gitSource.ref, expected.branch, "Wrong Git branch");
  assert.equal(deployment.gitSource.sha, expected.sha, "Wrong Git commit");
  assert.ok(
    Array.isArray(deployment.env) && deployment.env.includes("OPENAI_API_KEY"),
    "Preview did not receive OPENAI_API_KEY"
  );
  return {
    status: "configuration_verified",
    deploymentId: deployment.id,
    url: `https://${deployment.url}`,
    branch: expected.branch,
    sha: expected.sha,
    openaiKeyPresent: true,
    chatResponse: "not_tested",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [deploymentId, branch, sha] = process.argv.slice(2);
  try {
    assert.match(deploymentId ?? "", /^dpl_[A-Za-z0-9]+$/);
    assert.ok(branch);
    assert.match(sha ?? "", /^[a-f0-9]{40}$/);
    const { projectId } = JSON.parse(
      readFileSync(".vercel/project.json", "utf8")
    );
    const deployment = JSON.parse(
      execFileSync(
        "vercel",
        ["api", `/v13/deployments/${deploymentId}`, "--raw"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      )
    );
    console.log(
      JSON.stringify(
        verifyEvryPreview(deployment, { projectId, branch, sha }),
        null,
        2
      )
    );
  } catch (error) {
    // Never print the raw API response, command output, environment, or secrets.
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Could not verify preview configuration"
    );
    process.exitCode = 1;
  }
}
