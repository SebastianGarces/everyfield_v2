// Offline validation only. No database, HTTP, authentication or provider calls.
// Root pins reviewed bytes by SHA256. This is integrity binding, not a signature
// or proof that a remote deployment is configured as those files describe.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export const LEDGER78 = Object.freeze({
  hash: "430c2f5881e6237e0e1df6755cfa3e06b75050a2ae5b00d4a2dbea0594e566d2",
  when: 1789502632040,
});

const check = (condition) => {
  if (!condition) throw new Error("Discovery preview evidence rejected");
};
const text = (value) => typeof value === "string" && value.length > 0;
const equal = (left, right) => check(left === right);

function readArtifact(reference) {
  check(reference && isAbsolute(reference.path ?? ""));
  check(/^[a-f0-9]{64}$/.test(reference.sha256 ?? ""));
  const stat = statSync(reference.path);
  check(stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024);
  const bytes = readFileSync(reference.path);
  equal(createHash("sha256").update(bytes).digest("hex"), reference.sha256);
  return JSON.parse(bytes.toString("utf8"));
}

function httpsOrigin(value) {
  check(text(value));
  const url = new URL(value);
  equal(url.protocol, "https:");
  check(!url.username && !url.password && !url.search && !url.hash);
  equal(url.pathname, "/");
  check(url.port === "" || url.port === "443");
  // Neither the default provider nor a lookalike subdomain is an inert sink.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  check(hostname !== "resend.com" && !hostname.endsWith(".resend.com"));
  return url.origin;
}

function databaseIdentity(value) {
  if (typeof value === "string" || value instanceof URL) {
    const url = new URL(value);
    check(url.protocol === "postgres:" || url.protocol === "postgresql:");
    // Query parameters must not redirect the connection to a different target.
    for (const key of url.searchParams.keys())
      check(
        [
          "sslmode",
          "channel_binding",
          "application_name",
          "connect_timeout",
        ].includes(key)
      );
    value = {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.slice(1)),
      username: decodeURIComponent(url.username),
    };
  }
  check(
    value && text(value.host) && text(value.database) && text(value.username)
  );
  check(Number.isInteger(value.port) && value.port > 0 && value.port <= 65535);
  return {
    host: value.host,
    port: value.port,
    database: value.database,
    username: value.username,
  };
}

function sameDatabase(actual, expected) {
  const normalized = databaseIdentity(actual);
  for (const key of Object.keys(expected))
    equal(normalized[key], expected[key]);
}

/**
 * Validate root-pinned local evidence before any live operation.
 * reviewedRuntimeCommit is the independently reviewed release SHA, supplied explicitly.
 * Never infer it from the deployment or evidence documents being validated.
 *
 * approval.evidence is {path,sha256} for a JSON document containing version:1,
 * run, origin, runtimeCommit, database:{host,port,database,username,scope:"development",
 * ledger78:{hash,when}}, capture:{baseUrl,serviceId,noForward:true,noRedirect:true,
 * canary:{id,recipient,subject,idempotencyKey}, artifacts:{deploymentEnvironment,
 * sinkConfiguration,canaryReceipt}}. Each artifact reference is {path,sha256}.
 *
 * deploymentEnvironment JSON: run,origin,runtimeCommit,database (identity plus scope:"development"),
 * captureBaseUrl,serviceId,backgroundProviderWorkDisabled:true.
 * sinkConfiguration JSON: run,baseUrl,serviceId,noForward:true,noRedirect:true.
 * canaryReceipt JSON: run,baseUrl,serviceId,id,to:[recipient],subject,
 * idempotencyKey,accepted:true,forwarded:false,redirected:false.
 * Never include provider credentials in these documents.
 *
 * Caller MUST then read the live DB identity and ledger against `database`,
 * and challenge captureEvidenceURL with a freshly generated nonce, a separate
 * proof auth token and redirect:'error'. Require {run,serviceId,nonce,canary,
 * requests} matching these values, before launching the browser. Check receipts
 * after actions against that baseline; local file validation alone is not proof.
 */
export function validateEvidence(
  manifest,
  approval,
  origin,
  connection,
  reviewedRuntimeCommit
) {
  try {
    check(
      typeof reviewedRuntimeCommit === "string" &&
        /^[a-f0-9]{40}$/.test(reviewedRuntimeCommit) &&
        !/^0+$/.test(reviewedRuntimeCommit)
    );
    equal(manifest.version, 2);
    check(/^[a-z0-9][a-z0-9-]{7,39}$/.test(manifest.run));
    equal(approval.run, manifest.run);
    equal(approval.rootAuthorized, true);
    equal(approval.developmentDatabaseAuthorized, true);
    equal(approval.runtimeCommit, reviewedRuntimeCommit);
    const deploymentOrigin = httpsOrigin(
      origin instanceof URL ? origin.href : origin
    );
    equal(approval.origin, deploymentOrigin);
    const evidence = readArtifact(approval.evidence);
    equal(evidence.version, 1);
    equal(evidence.run, manifest.run);
    equal(evidence.origin, deploymentOrigin);
    equal(evidence.runtimeCommit, reviewedRuntimeCommit);
    equal(evidence.database.scope, "development");
    equal(evidence.database.ledger78.hash, LEDGER78.hash);
    equal(evidence.database.ledger78.when, LEDGER78.when);
    const identity = databaseIdentity(evidence.database);
    sameDatabase(connection, identity);
    const capture = evidence.capture;
    const captureBaseUrl = httpsOrigin(capture.baseUrl);
    check(captureBaseUrl !== deploymentOrigin);
    check(/^[a-zA-Z0-9_-]{8,128}$/.test(capture.serviceId));
    equal(capture.noForward, true);
    equal(capture.noRedirect, true);
    const canary = capture.canary;
    for (const field of ["id", "recipient", "subject", "idempotencyKey"])
      check(text(canary[field]));
    check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(canary.recipient));
    const deployment = readArtifact(capture.artifacts.deploymentEnvironment);
    equal(deployment.run, manifest.run);
    equal(deployment.origin, deploymentOrigin);
    equal(deployment.runtimeCommit, reviewedRuntimeCommit);
    sameDatabase(deployment.database, identity);
    equal(deployment.database.scope, "development");
    equal(httpsOrigin(deployment.captureBaseUrl), captureBaseUrl);
    equal(deployment.serviceId, capture.serviceId);
    equal(deployment.backgroundProviderWorkDisabled, true);
    const sink = readArtifact(capture.artifacts.sinkConfiguration);
    const receipt = readArtifact(capture.artifacts.canaryReceipt);
    for (const artifact of [sink, receipt]) {
      equal(artifact.run, manifest.run);
      equal(artifact.serviceId, capture.serviceId);
      equal(httpsOrigin(artifact.baseUrl), captureBaseUrl);
    }
    equal(sink.noForward, true);
    equal(sink.noRedirect, true);
    equal(receipt.id, canary.id);
    equal(receipt.subject, canary.subject);
    equal(receipt.idempotencyKey, canary.idempotencyKey);
    check(Array.isArray(receipt.to) && receipt.to.length === 1);
    equal(receipt.to[0], canary.recipient);
    equal(receipt.accepted, true);
    equal(receipt.forwarded, false);
    equal(receipt.redirected, false);
    return {
      captureBaseUrl,
      captureEvidenceURL: new URL(`/proof/${manifest.run}`, captureBaseUrl)
        .href,
      serviceId: capture.serviceId,
      canary: {
        id: canary.id,
        recipient: canary.recipient,
        subject: canary.subject,
        idempotencyKey: canary.idempotencyKey,
      },
      database: {
        ...identity,
        scope: "development",
        ledger78: { ...LEDGER78 },
      },
      evidenceSha256: approval.evidence.sha256,
    };
  } catch {
    // Paths, connection strings and artifact contents must never reach logs.
    throw new Error("Discovery preview evidence rejected");
  }
}
