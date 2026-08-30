import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

test("Communication effects require one current admin-plus plant tenancy", () => {
  const effect = source("src/lib/communication/evry-effect.ts");
  const send = source("src/lib/communication/evry-send.ts");

  assert.match(
    effect,
    /join users actor[\s\S]*actor\.id = a\.actor_user_id[\s\S]*actor\.church_id = a\.church_id[\s\S]*actor\.sending_church_id is null[\s\S]*actor\.sending_network_id is null[\s\S]*actor\.seat in \('owner', 'admin'\)/
  );
  assert.match(
    effect,
    /actorStillHoldsCommunicationSend\(input\.execution\)[\s\S]*status: "refused"[\s\S]*input\.targetIsCurrent/
  );
  assert.ok(
    send.match(/actorStillHoldsCommunicationSend\(input\.effect\.execution\)/g)
      ?.length === 3,
    "send preparation, token rendering, and provider dispatch stay authority-gated"
  );
});
