import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { userSeats } from "@/db/schema";

import {
  evryPlantStandingOf,
  requireEvryPlantViewer,
  type EvryPlantStanding,
} from "./viewer";

type SessionUser = Parameters<typeof evryPlantStandingOf>[0];

function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-1",
    churchId: "plant-1",
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
    ...overrides,
  };
}

test("only Owner, Admin, and Member shapes classify as plant-eligible", () => {
  for (const seat of userSeats) {
    assert.deepEqual(evryPlantStandingOf(sessionUser({ seat })), {
      status: "eligible",
      userId: "user-1",
      plantId: "plant-1",
      seat,
    } satisfies EvryPlantStanding);
  }
});

test("pre-tenancy, coach, oversight, and malformed tenancy shapes fail closed", () => {
  const refusedUsers: readonly SessionUser[] = [
    sessionUser({ churchId: null }),
    sessionUser({ churchId: null, seat: null }),
    sessionUser({ seat: null }),
    sessionUser({
      churchId: null,
      sendingChurchId: "sending-church-1",
    }),
    sessionUser({ churchId: null, sendingNetworkId: "network-1" }),
    sessionUser({ sendingNetworkId: "network-1" }),
  ];

  for (const user of refusedUsers) {
    assert.deepEqual(evryPlantStandingOf(user), { status: "ineligible" });
  }
});

test("the exported viewer boundary has no caller-supplied session dependency", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/evry/eligibility/viewer.ts"),
    "utf8"
  );

  assert.equal(requireEvryPlantViewer.length, 0);
  assert.match(
    source,
    /export async function requireEvryPlantViewer\(\): Promise<EvryPlantActor>/
  );
  assert.match(source, /const \{ user \} = await verifySession\(\)/);
  assert.doesNotMatch(source, /ViewerDeps|DEFAULT_DEPS|deps\.verifySession/);
});

test("effect authorization bypasses the cached user snapshot without accepting authority", () => {
  const viewerSource = readFileSync(
    path.join(process.cwd(), "src/lib/evry/eligibility/viewer.ts"),
    "utf8"
  );
  const capabilitySource = readFileSync(
    path.join(process.cwd(), "src/lib/evry/eligibility/capabilities.ts"),
    "utf8"
  );
  const sessionSource = readFileSync(
    path.join(process.cwd(), "src/lib/auth/session.ts"),
    "utf8"
  );
  const effectStart = capabilitySource.indexOf(
    "export async function authorizeEvryEffectCapability"
  );
  const effectBody = capabilitySource.slice(effectStart);

  assert.match(
    sessionSource,
    /export async function verifyFreshSession\(\): Promise<SessionValidationResult>/
  );
  assert.match(
    sessionSource,
    /const authenticated = await verifySession\(\);[\s\S]*validateSessionId\(authenticated\.session\.id\)/
  );
  assert.match(
    viewerSource,
    /export async function requireFreshEvryPlantViewer\(\): Promise<EvryPlantActor>/
  );
  assert.match(effectBody, /actor = await requireFreshEvryPlantViewer\(\)/);
  const effectHeader = effectBody.slice(0, effectBody.indexOf("{") + 1);
  assert.match(effectHeader, /\(\s*identity: string\s*\)/);
  assert.doesNotMatch(
    effectHeader,
    /actor:\s*EvryPlantActor|sessionId:|userId:/
  );
});

test("spend APIs accept identities or record ids, never an actor or mapping", () => {
  const capabilitySource = readFileSync(
    path.join(process.cwd(), "src/lib/evry/eligibility/capabilities.ts"),
    "utf8"
  );
  const repositorySource = readFileSync(
    path.join(process.cwd(), "src/lib/evry/eligibility/repository.ts"),
    "utf8"
  );
  const authorizeStart = capabilitySource.indexOf(
    "export async function authorizeEvryCapability"
  );
  const freshViewer = capabilitySource.indexOf(
    "const actor = await requireEvryPlantViewer()",
    authorizeStart
  );
  const trustedLookup = capabilitySource.indexOf(
    "const registration = REGISTRY.registrationFor(identity)",
    authorizeStart
  );

  assert.equal(authorizeStart >= 0, true);
  assert.equal(freshViewer > authorizeStart, true);
  assert.equal(trustedLookup > freshViewer, true);
  assert.match(
    repositorySource,
    /export async function readEvryPerson\(\s*personId: string/
  );
  assert.match(
    repositorySource,
    /export async function proposeEvryPersonUpdate\(\s*personId: string/
  );
  assert.doesNotMatch(
    repositorySource,
    /export async function \w+\(\s*(?:actor|authorization):/
  );
});

test("spend revalidation and the real request/repository boundary pass", () => {
  const proofPath = path.join(
    process.cwd(),
    "src/lib/evry/eligibility/request-proof.ts"
  );
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      proofPath,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci",
      },
      timeout: 30_000,
    }
  );

  assert.equal(
    proof.status,
    0,
    `request proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Evry eligibility request proof passed/);
});
