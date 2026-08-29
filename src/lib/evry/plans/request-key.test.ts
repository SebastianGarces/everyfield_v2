import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveEvryPlanRequestKey } from "./request-key";

test("derived plan request keys are stable and length-prefix every part", () => {
  const first = deriveEvryPlanRequestKey("people-add-note", ["a", "b:c"]);
  assert.equal(
    first,
    deriveEvryPlanRequestKey("people-add-note", ["a", "b:c"])
  );
  assert.notEqual(
    first,
    deriveEvryPlanRequestKey("people-add-note", ["a:b", "c"])
  );
  assert.notEqual(
    first,
    deriveEvryPlanRequestKey("people-other", ["a", "b:c"])
  );
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test("derived plan request keys reject an ambiguous namespace", () => {
  assert.throws(
    () => deriveEvryPlanRequestKey("people\u001fadd-note", ["a"]),
    /Invalid Evry plan request-key namespace/
  );
});
