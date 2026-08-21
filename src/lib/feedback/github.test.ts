import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FEEDBACK_REPO,
  FEEDBACK_LABEL,
  buildFeedbackIssue,
  createFeedbackIssue,
  feedbackIssueUrl,
  type FeedbackIssueInput,
} from "./github";

// ----------------------------------------------------------------------------
// Feedback → GitHub bridge (#190)
//
// The bridge is fire-and-forget over a PUBLIC board, so three things are pinned
// here: the payload GitHub receives (title, labels, ids), the redaction of the
// one route that carries authored text, and the refusal path when the token is
// unset — which must return rather than throw, because a submission may never
// fail on the bridge.
// ----------------------------------------------------------------------------

const FEEDBACK_ID = "11111111-1111-4111-8111-111111111111";
const CHURCH_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function input(
  overrides: Partial<FeedbackIssueInput> = {}
): FeedbackIssueInput {
  return {
    feedbackId: FEEDBACK_ID,
    category: "bug",
    description: "The launch countdown is off by a day.",
    pageUrl: "/launch",
    churchId: CHURCH_ID,
    userId: USER_ID,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Title
// ----------------------------------------------------------------------------

test("the title names the category and the first line of the description", () => {
  const { title } = buildFeedbackIssue(input());
  assert.equal(title, "[bug] The launch countdown is off by a day.");
});

test("the title skips leading blank lines", () => {
  const { title } = buildFeedbackIssue(
    input({ description: "\n\n  Tasks will not reorder.\nSecond line." })
  );
  assert.equal(title, "[bug] Tasks will not reorder.");
});

test("a long first line is truncated in the title, never in the body", () => {
  const long = "a".repeat(400);
  const { title, body } = buildFeedbackIssue(input({ description: long }));

  assert.ok(title.length < 120, `title too long: ${title.length}`);
  assert.ok(title.endsWith("…"));
  assert.ok(body.includes(long), "the body keeps the full description");
});

// ----------------------------------------------------------------------------
// Labels
// ----------------------------------------------------------------------------

test("every category carries the feedback label", () => {
  for (const category of ["bug", "suggestion", "question", "other"] as const) {
    const { labels } = buildFeedbackIssue(input({ category }));
    assert.ok(
      labels.includes(FEEDBACK_LABEL),
      `${category} is missing ${FEEDBACK_LABEL}`
    );
  }
});

test("the category maps to exactly one extra label, and `other` to none", () => {
  assert.deepEqual(buildFeedbackIssue(input({ category: "bug" })).labels, [
    "feedback",
    "bug",
  ]);
  assert.deepEqual(
    buildFeedbackIssue(input({ category: "suggestion" })).labels,
    ["feedback", "enhancement"]
  );
  assert.deepEqual(buildFeedbackIssue(input({ category: "question" })).labels, [
    "feedback",
    "question",
  ]);
  assert.deepEqual(buildFeedbackIssue(input({ category: "other" })).labels, [
    "feedback",
  ]);
});

test("the bridge never applies `feature` — that label marks an FRD parent", () => {
  for (const category of ["bug", "suggestion", "question", "other"] as const) {
    const { labels } = buildFeedbackIssue(input({ category }));
    assert.ok(!labels.includes("feature"));
  }
});

// ----------------------------------------------------------------------------
// Body
// ----------------------------------------------------------------------------

test("the body carries the description, the page and all three ids", () => {
  const { body } = buildFeedbackIssue(input());

  assert.ok(body.includes("The launch countdown is off by a day."));
  assert.ok(body.includes("/launch"));
  assert.ok(body.includes(FEEDBACK_ID), "the backlink to the feedback row");
  assert.ok(body.includes(CHURCH_ID));
  assert.ok(body.includes(USER_ID));
});

test("a church-less submission and a page-less one still build", () => {
  const { body } = buildFeedbackIssue(input({ churchId: null, pageUrl: null }));

  assert.ok(body.includes("**Church id:** `—`"));
  assert.ok(body.includes("**Page:** —"));
});

test("the body says the issue is one-way", () => {
  const { body } = buildFeedbackIssue(input());
  assert.ok(body.includes("/admin/feedback"));
  assert.ok(body.toLowerCase().includes("source of truth"));
});

// ----------------------------------------------------------------------------
// The page path, which the SYSTEM attaches — not the submitter
// ----------------------------------------------------------------------------

test("a wiki slug never reaches the public body — it is authored text", () => {
  const { body } = buildFeedbackIssue(
    input({ pageUrl: "/wiki/leadership/pastor-john-smith-succession" })
  );

  assert.ok(!body.includes("pastor-john-smith-succession"));
  assert.ok(!body.includes("leadership"));
  assert.ok(body.includes("**Page:** /wiki/…/…"));
});

test("a uuid segment survives — it names a row, not a person", () => {
  const { body } = buildFeedbackIssue(
    input({ pageUrl: `/people/${CHURCH_ID}` })
  );
  assert.ok(body.includes(`**Page:** /people/${CHURCH_ID}`));
});

test("a top-level route is published whole", () => {
  const { body } = buildFeedbackIssue(input({ pageUrl: "/launch" }));
  assert.ok(body.includes("**Page:** /launch"));
});

test("a route added later is redacted without anyone remembering to", () => {
  const { body } = buildFeedbackIssue(
    input({ pageUrl: "/some-new-route/whatever-a-church-typed" })
  );
  assert.ok(!body.includes("whatever-a-church-typed"));
  assert.ok(body.includes("**Page:** /some-new-route/…"));
});

// ----------------------------------------------------------------------------
// Issue URL
// ----------------------------------------------------------------------------

test("the issue url points at the configured repo", (t) => {
  if (process.env.GITHUB_FEEDBACK_REPO) {
    t.skip("GITHUB_FEEDBACK_REPO overrides the default this asserts");
    return;
  }

  assert.equal(DEFAULT_FEEDBACK_REPO, "SebastianGarces/everyfield_v2");
  assert.equal(
    feedbackIssueUrl(190),
    "https://github.com/SebastianGarces/everyfield_v2/issues/190"
  );
});

// ----------------------------------------------------------------------------
// The request GitHub receives
// ----------------------------------------------------------------------------

test("the POST carries the token, the API version and the payload", async () => {
  const realFetch = globalThis.fetch;
  const realToken = process.env.GITHUB_FEEDBACK_TOKEN;
  let url: string | undefined;
  let init: RequestInit | undefined;

  process.env.GITHUB_FEEDBACK_TOKEN = "ghp_test_token";
  globalThis.fetch = (async (requestUrl: string, requestInit: RequestInit) => {
    url = requestUrl;
    init = requestInit;
    return new Response(JSON.stringify({ number: 4242 }), { status: 201 });
  }) as unknown as typeof fetch;

  try {
    const number = await createFeedbackIssue(input());
    assert.equal(number, 4242);
  } finally {
    globalThis.fetch = realFetch;
    restoreToken(realToken);
  }

  assert.ok(url?.endsWith("/issues"), url);
  assert.ok(url?.includes("api.github.com/repos/"), url);
  assert.equal(init?.method, "POST");

  const headers = init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer ghp_test_token");
  assert.equal(headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(headers.Accept, "application/vnd.github+json");

  const sent = JSON.parse(String(init?.body)) as {
    title: string;
    labels: string[];
  };
  assert.equal(sent.title, "[bug] The launch countdown is off by a day.");
  assert.deepEqual(sent.labels, ["feedback", "bug"]);
});

test("a refused POST throws with GitHub's own status and body", async () => {
  const realFetch = globalThis.fetch;
  const realToken = process.env.GITHUB_FEEDBACK_TOKEN;

  process.env.GITHUB_FEEDBACK_TOKEN = "ghp_bad";
  globalThis.fetch = (async () =>
    new Response('{"message":"Bad credentials"}', {
      status: 401,
      statusText: "Unauthorized",
    })) as unknown as typeof fetch;

  try {
    await assert.rejects(
      () => createFeedbackIssue(input()),
      /401 Unauthorized[\s\S]*Bad credentials/
    );
  } finally {
    globalThis.fetch = realFetch;
    restoreToken(realToken);
  }
});

// ----------------------------------------------------------------------------
// Graceful failure (G3: the token unset)
//
// `null`, not a throw: an environment without the PAT is one that does not
// bridge, which must read differently from a GitHub outage.
// ----------------------------------------------------------------------------

test("with no token the bridge returns null, hits no network and never throws", async () => {
  const realToken = process.env.GITHUB_FEEDBACK_TOKEN;
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  let called = false;

  delete process.env.GITHUB_FEEDBACK_TOKEN;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("the bridge must not call GitHub without a token");
  }) as unknown as typeof fetch;
  console.warn = () => {};

  try {
    assert.equal(await createFeedbackIssue(input()), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    restoreToken(realToken);
  }
});

function restoreToken(value: string | undefined) {
  if (value === undefined) delete process.env.GITHUB_FEEDBACK_TOKEN;
  else process.env.GITHUB_FEEDBACK_TOKEN = value;
}
