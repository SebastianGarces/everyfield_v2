import assert from "node:assert/strict";

// Pure receipt assertion. A provider/capture HTTP success alone proves nothing.
export function assertMailDelta(receipts, expected) {
  assert.equal(
    receipts.length,
    expected.length,
    "Missing or unexpected email attempts"
  );
  assert.equal(new Set(receipts.map((item) => item.id)).size, receipts.length);
  assert.equal(
    new Set(expected.map((item) => item.idempotencyKey)).size,
    expected.length
  );
  for (const wanted of expected) {
    const matches = receipts.filter(
      (item) => item.idempotencyKey === wanted.idempotencyKey
    );
    assert.equal(matches.length, 1, "Wrong or duplicate idempotency key");
    const receipt = matches[0];
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.method, "POST");
    assert.equal(receipt.path, "/emails");
    assert.match(receipt.bodySha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(receipt.to, wanted.to, "Wrong recipients");
    assert.equal(receipt.subject, wanted.subject, "Wrong event subject");
  }
}
