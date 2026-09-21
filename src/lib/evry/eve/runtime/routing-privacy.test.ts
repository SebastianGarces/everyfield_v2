import assert from "node:assert/strict";
import { test } from "node:test";
import { scrubJevRoutingPayload } from "./routing-privacy";

test("recognized headers and complete quoted credentials never enter routing text", () => {
  for (const text of [
    "Cookie: session=fixture-secret-cookie; csrf=fixture-secret-csrf",
    "Authorization: Basic Zml4dHVyZTpwYXNzd29yZA==",
    "Authorization: Basic\n Zml4dHVyZTpwYXNzd29yZA==",
    "Proxy-Authorization: Digest fixture-secret-digest",
    "Set-Cookie: session=fixture-secret-cookie; HttpOnly",
    'password: "two word secret"',
    "password: 'two\nline secret'",
    'password: "escaped \\"secret\\" words"',
    "api_key=fixture-secret-api-key",
    "session=fixture-secret-session",
  ]) {
    const output = String(
      scrubJevRoutingPayload(
        `Review launch.\n${text}\nKeep the meeting at 10am.`
      )
    );
    assert.doesNotMatch(
      output,
      /fixture-secret|Zml4dHVyZTpwYXNzd29yZA==|two word|line secret|escaped|words/
    );
    assert.match(output, /redacted credential/);
    assert.match(output, /Review launch/);
    assert.match(output, /Keep the meeting at 10am/);
  }
});

test("an unterminated quoted credential is removed through the end of the routing string", () => {
  const output = scrubJevRoutingPayload(
    'Review launch. password: "private words\nprivate continuation'
  );
  assert.equal(output, "Review launch. password=[redacted credential]");
});

test("structured facts and nested credentials are scrubbed without discarding authorized personal context", () => {
  const result = scrubJevRoutingPayload({
    request: "Invite Alice to orientation",
    taskState: {
      facts: [
        { key: "password", value: "private words", source: "user" },
        { key: "meeting-time", value: "10am", source: "user" },
      ],
      selectedRecords: [
        { id: "person-1", label: "Alice Jones", kind: "person" },
      ],
      authorization: { scheme: "Basic", value: "private header" },
      other: [
        '{"Cookie": "session=private cookie"}',
        'password: "private\nmultiline value"',
      ],
    },
  });
  const text = JSON.stringify(result);
  assert.doesNotMatch(
    text,
    /private words|private header|private cookie|private\\nmultiline value/
  );
  assert.match(text, /Alice Jones/);
  assert.match(text, /10am/);
});
