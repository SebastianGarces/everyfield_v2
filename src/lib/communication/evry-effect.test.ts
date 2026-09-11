import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

test("Communication effects require one current admin-plus plant tenancy", () => {
  const effect = source("src/lib/communication/evry-effect.ts");
  const databaseEffect = source("src/lib/evry/executor/database-effect.ts");
  const send = source("src/lib/communication/evry-send.ts");

  assert.match(
    effect,
    /eligibility: sql`[\s\S]*exists \([\s\S]*from users actor[\s\S]*actor\.id = \$\{input\.execution\.actorUserId\}[\s\S]*actor\.church_id = \$\{input\.execution\.plantId\}[\s\S]*actor\.sending_church_id is null[\s\S]*actor\.sending_network_id is null[\s\S]*actor\.seat in \('owner', 'admin'\)/
  );
  assert.match(
    effect,
    /actorStillHoldsCommunicationSend\(input\.execution\)[\s\S]*input\.targetIsCurrent/
  );
  assert.match(
    databaseEffect,
    /and \(\$\{input\.eligibility \?\? sql`true`\}\)[\s\S]*and not exists \(select 1 from existing\)/
  );
  assert.ok(
    send.match(/actorStillHoldsCommunicationSend\(input\.effect\.execution\)/g)
      ?.length === 3,
    "reconciliation, preparation, and per-recipient rendering stay authority-gated"
  );
  assert.equal(
    send.match(/currentCommunicationSendAuthority\(input\.effect\.execution\)/g)
      ?.length,
    1,
    "local exclusions atomically require exact authority"
  );
  assert.match(
    send,
    /with eligible_actor as materialized[\s\S]*for update[\s\S]*update communication_recipients recipient[\s\S]*returning recipient\.id/,
    "provider marker acquisition locks exact authority and requires the dispatchable row"
  );
  assert.match(
    send,
    /insert into communications[\s\S]*from users actor[\s\S]*actor\.church_id = [\s\S]*actor\.sending_church_id is null[\s\S]*actor\.sending_network_id is null[\s\S]*actor\.seat in \('owner', 'admin'\)/
  );
  assert.match(
    send,
    /insert into communication_recipients[\s\S]*from users actor[\s\S]*join communications message[\s\S]*actor\.sending_church_id is null[\s\S]*actor\.sending_network_id is null[\s\S]*actor\.seat in \('owner', 'admin'\)/
  );
  assert.doesNotMatch(effect, /insert into evry_execution_outcomes/);
});
