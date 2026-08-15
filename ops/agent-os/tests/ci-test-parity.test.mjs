// `pnpm test:ci` reproduces the hermetic CI test job, and cannot drift from it
// (#263 item 5, via #324 WS2).
//
// THE BUG CLASS. `pnpm test` is
// `tsx --env-file-if-exists=.env.local --test ...`. On any developer machine
// that file exists and carries real credentials, so a local run is NOT the run
// CI performs: a suite that quietly depends on `DATABASE_URL` pointing at a
// live Neon branch, or on `UNSUBSCRIBE_TOKEN_SECRET` being set, passes locally
// and fails in the hermetic job. That is exactly what produced the CI fix in
// PR #251, and nothing stopped it recurring — there was no way to run the CI
// shape at all.
//
// `test:ci` is that way: no env file, and only the two variables the job sets.
//
// WHY THIS TEST AND NOT JUST THE SCRIPT. A second copy of an environment is a
// second thing to forget. The job's `env:` block and the script are two
// literals that mean one thing, so they are asserted equal HERE, in both
// directions — add a variable to CI without adding it to `test:ci` (or the
// reverse) and this fails, naming the missing one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it
// is run from.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKFLOW = path.join(ROOT, ".github/workflows/pull-request-checks.yml");

function scripts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    .scripts;
}

/**
 * The `env:` block of the `validate` job's Test step, as `{KEY: value}`.
 *
 * Read as text rather than parsed: `yaml` is not a dependency of this repo, and
 * both halves under test are literal lines. A restructure of the file breaks
 * this loudly, which is the correct outcome — the parity claim would no longer
 * be checkable.
 */
function ciTestStepEnv() {
  const workflow = fs.readFileSync(WORKFLOW, "utf8");

  const start = workflow.indexOf("      - name: Test\n");
  assert.notEqual(
    start,
    -1,
    "no `- name: Test` step in pull-request-checks.yml — the suite is no longer part of the CI anchor, or the step was renamed"
  );

  const rest = workflow.slice(start + 1);
  const end = rest.indexOf("      - name: ");
  const step = end === -1 ? rest : rest.slice(0, end);

  assert.match(
    step,
    /run: pnpm test(:ci)?$/m,
    "the Test step no longer runs the suite through a `pnpm test*` script"
  );

  const env = {};
  const envBlock = step.slice(step.indexOf("\n        env:"));
  for (const line of envBlock.split("\n")) {
    const match = /^ {10}([A-Z_][A-Z0-9_]*): "(.*)"$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/** The `KEY=value` prefixes of a script, as `{KEY: value}`. */
function inlineEnv(script) {
  const env = {};
  for (const token of script.split(" ")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(token);
    if (!match) break; // The first non-assignment token is the command itself.
    env[match[1]] = match[2];
  }
  return env;
}

test("a `test:ci` script exists and omits the env file", () => {
  const script = scripts()["test:ci"];
  assert.ok(script, "package.json has no `test:ci` script");

  assert.doesNotMatch(
    script,
    /--env-file/,
    "`test:ci` reads an env file — then it is not the hermetic job, it is `pnpm test` with extra steps"
  );
});

test("`test:ci` runs exactly the suites `pnpm test` runs", () => {
  const { test: local, "test:ci": ci } = scripts();

  // The only sanctioned differences are the env file and the inline variables.
  // Anything else — a narrowed glob, a `--test-only`, a different runner — makes
  // "it passed locally in the CI shape" a claim about a different suite.
  const normalised = local.replace(" --env-file-if-exists=.env.local", "");
  const withoutEnv = ci.slice(ci.indexOf("tsx "));

  assert.equal(
    withoutEnv,
    normalised,
    "`test:ci` and `test` no longer run the same command once the env file and the inline variables are removed"
  );
});

test("`test:ci` passes exactly the variables the CI job passes", () => {
  const ci = ciTestStepEnv();
  const script = inlineEnv(scripts()["test:ci"]);

  assert.ok(
    Object.keys(ci).length > 0,
    "the CI Test step declares no env — parse the workflow again, this test is now vacuous"
  );

  assert.deepEqual(
    script,
    ci,
    "`test:ci` and the CI Test step's env have drifted — a local run is no longer structurally equivalent to the hermetic job"
  );
});

test("neither the job nor `test:ci` hands the suite a real credential", () => {
  // The hermetic property itself, not just the parity. `DATABASE_URL` is
  // constructed but never connected to, and the Resend key is only there
  // because `new Resend(...)` runs at module scope; a real value in either
  // would mean the suite could reach production data from a fork's PR.
  for (const [source, env] of [
    ["the CI Test step", ciTestStepEnv()],
    ["`test:ci`", inlineEnv(scripts()["test:ci"])],
  ]) {
    assert.match(
      env.DATABASE_URL ?? "",
      /localhost/,
      `${source} points DATABASE_URL somewhere other than localhost`
    );
    assert.match(
      env.RESEND_API_KEY ?? "",
      /placeholder/,
      `${source} carries a RESEND_API_KEY that does not announce itself as a placeholder`
    );
  }
});
