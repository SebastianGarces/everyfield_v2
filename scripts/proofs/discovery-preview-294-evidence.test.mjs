import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LEDGER78,
  validateEvidence,
} from "./discovery-preview-294-evidence.mjs";

const RUNTIME_COMMIT = "a".repeat(40);

// Entire suite is offline. Artifacts exist only in each test's owned temp dir.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "d294-evidence-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = "review-run-294";
  const origin = "https://review-294.vercel.app";
  const baseUrl = "https://capture.example.test";
  const serviceId = "capture-service-294";
  const database = {
    host: "development.example.test",
    port: 5432,
    database: "discovery294",
    username: "proof",
  };
  const canary = {
    id: "canary-294",
    recipient: "canary@example.test",
    subject: "Discovery proof canary",
    idempotencyKey: "d294-canary",
  };
  const deployment = {
    run,
    origin,
    runtimeCommit: RUNTIME_COMMIT,
    database: { ...database, scope: "development" },
    captureBaseUrl: baseUrl,
    serviceId,
    backgroundProviderWorkDisabled: true,
  };
  const sink = { run, baseUrl, serviceId, noForward: true, noRedirect: true };
  const receipt = {
    run,
    baseUrl,
    serviceId,
    id: canary.id,
    to: [canary.recipient],
    subject: canary.subject,
    idempotencyKey: canary.idempotencyKey,
    accepted: true,
    forwarded: false,
    redirected: false,
  };
  const evidence = {
    version: 1,
    run,
    origin,
    runtimeCommit: RUNTIME_COMMIT,
    database: { ...database, scope: "development", ledger78: { ...LEDGER78 } },
    capture: {
      baseUrl,
      serviceId,
      noForward: true,
      noRedirect: true,
      canary,
      artifacts: {},
    },
  };
  const manifest = { version: 2, run };
  const approval = {
    run,
    origin,
    rootAuthorized: true,
    developmentDatabaseAuthorized: true,
    runtimeCommit: RUNTIME_COMMIT,
  };
  const connection =
    "postgresql://proof:never-log-this@development.example.test:5432/discovery294?sslmode=require";
  function save(name, data) {
    const path = join(directory, name);
    const bytes = JSON.stringify(data);
    writeFileSync(path, bytes, { mode: 0o600 });
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  function seal() {
    evidence.capture.artifacts = {
      deploymentEnvironment: save("deployment.json", deployment),
      sinkConfiguration: save("sink.json", sink),
      canaryReceipt: save("canary.json", receipt),
    };
    approval.evidence = save("evidence.json", evidence);
  }
  seal();
  return {
    manifest,
    approval,
    origin,
    connection,
    database,
    canary,
    evidence,
    deployment,
    sink,
    receipt,
    seal,
    validate: () =>
      validateEvidence(manifest, approval, origin, connection, RUNTIME_COMMIT),
  };
}

test("accepts matching hashed artifacts and returns only live-check inputs", (t) => {
  const f = fixture(t);
  const actual = f.validate();
  assert.equal(
    actual.captureEvidenceURL,
    "https://capture.example.test/proof/review-run-294"
  );
  assert.deepEqual(actual.canary, f.canary);
  assert.deepEqual(actual.database, {
    ...f.database,
    scope: "development",
    ledger78: LEDGER78,
  });
  assert.ok(!JSON.stringify(actual).includes("never-log-this"));
  assert.deepEqual(
    validateEvidence(
      f.manifest,
      f.approval,
      new URL(f.origin),
      f.database,
      RUNTIME_COMMIT
    ),
    actual
  );
});

const mutations = {
  "old manifest version": (f) => {
    f.manifest.version = 1;
  },
  "approval for another run": (f) => {
    f.approval.run = "another-run";
  },
  "missing authorization": (f) => {
    f.approval.rootAuthorized = false;
  },
  "missing development database authorization": (f) => {
    f.approval.developmentDatabaseAuthorized = false;
  },
  "wrong runtime": (f) => {
    f.evidence.runtimeCommit = "0".repeat(40);
  },
  "wrong deployment": (f) => {
    f.deployment.origin = "https://other.vercel.app";
  },
  "wrong database": (f) => {
    f.evidence.database.database = "production";
  },
  "environment points at another database": (f) => {
    f.deployment.database = { ...f.database, host: "production.example.test" };
  },
  "production database evidence": (f) => {
    f.evidence.database.scope = "production";
  },
  "customer database evidence": (f) => {
    f.evidence.database.scope = "customer";
  },
  "missing database scope": (f) => {
    delete f.evidence.database.scope;
  },
  "deployment environment customer scope": (f) => {
    f.deployment.database.scope = "customer";
  },
  "wrong ledger hash": (f) => {
    f.evidence.database.ledger78.hash = "0".repeat(64);
  },
  "wrong ledger timestamp": (f) => {
    f.evidence.database.ledger78.when++;
  },
  "provider default base": (f) => {
    f.evidence.capture.baseUrl = "https://api.resend.com";
  },
  "provider trailing dot": (f) => {
    f.evidence.capture.baseUrl = "https://api.resend.com.";
  },
  "nonHTTPS sink": (f) => {
    f.evidence.capture.baseUrl = "http://capture.example.test";
  },
  "credentials in sink URL": (f) => {
    f.evidence.capture.baseUrl = "https://token@capture.example.test";
  },
  "query-bearing sink": (f) => {
    f.evidence.capture.baseUrl =
      "https://capture.example.test?redirect=https://api.resend.com";
  },
  "path-bearing sink": (f) => {
    f.evidence.capture.baseUrl = "https://capture.example.test/proxy";
  },
  "mismatched environment sink": (f) => {
    f.deployment.captureBaseUrl = "https://other.example.test";
  },
  "forward-enabled sink": (f) => {
    f.sink.noForward = false;
  },
  "redirect-enabled sink": (f) => {
    f.sink.noRedirect = false;
  },
  "wrong service": (f) => {
    f.sink.serviceId = "other-service";
  },
  "unscoped canary": (f) => {
    f.receipt.run = "other-run";
  },
  "wrong canary ID": (f) => {
    f.receipt.id = "other-canary";
  },
  "wrong canary recipient": (f) => {
    f.receipt.to = ["other@example.test"];
  },
  "extra canary recipient": (f) => {
    f.receipt.to.push("extra@example.test");
  },
  "wrong idempotency key": (f) => {
    f.receipt.idempotencyKey = "other-key";
  },
  "forwarded canary": (f) => {
    f.receipt.forwarded = true;
  },
  "redirected canary": (f) => {
    f.receipt.redirected = true;
  },
  "rejected canary": (f) => {
    f.receipt.accepted = false;
  },
  "background provider enabled": (f) => {
    f.deployment.backgroundProviderWorkDisabled = false;
  },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects correctly hashed but inconsistent evidence: ${name}`, (t) => {
    const f = fixture(t);
    mutate(f);
    f.seal();
    assert.throws(f.validate, {
      message: "Discovery preview evidence rejected",
    });
  });
}

for (const artifact of [
  "envelope",
  "deploymentEnvironment",
  "sinkConfiguration",
  "canaryReceipt",
]) {
  test(`rejects changed bytes after root hash pinning: ${artifact}`, (t) => {
    const f = fixture(t);
    const reference =
      artifact === "envelope"
        ? f.approval.evidence
        : f.evidence.capture.artifacts[artifact];
    writeFileSync(reference.path, readFileSync(reference.path, "utf8") + "\n");
    assert.throws(f.validate, {
      message: "Discovery preview evidence rejected",
    });
  });
}

test("rejects absent evidence rather than trusting boolean attestations", (t) => {
  const f = fixture(t);
  delete f.approval.evidence;
  assert.throws(f.validate, { message: "Discovery preview evidence rejected" });
});

test("rejects connection target overrides without exposing connection credentials", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      validateEvidence(
        f.manifest,
        f.approval,
        f.origin,
        f.connection + "&host=production",
        RUNTIME_COMMIT
      ),
    { message: "Discovery preview evidence rejected" }
  );
});

for (const runtime of [
  undefined,
  null,
  "",
  "main",
  "a".repeat(39),
  "0".repeat(40),
  "b".repeat(40),
]) {
  test(`rejects missing, invalid or unreviewed runtime ${String(runtime)}`, (t) => {
    const f = fixture(t);
    assert.throws(
      () =>
        validateEvidence(
          f.manifest,
          f.approval,
          f.origin,
          f.connection,
          runtime
        ),
      { message: "Discovery preview evidence rejected" }
    );
  });
}

test("accepts a new reviewed release only when all runtime records match", (t) => {
  const f = fixture(t);
  const runtime = "b".repeat(40);
  f.approval.runtimeCommit = runtime;
  f.evidence.runtimeCommit = runtime;
  f.seal();
  assert.throws(() =>
    validateEvidence(f.manifest, f.approval, f.origin, f.connection, runtime)
  );
  f.deployment.runtimeCommit = runtime;
  f.seal();
  assert.equal(
    validateEvidence(f.manifest, f.approval, f.origin, f.connection, runtime)
      .serviceId,
    f.evidence.capture.serviceId
  );
});
