/**
 * G3 harness for the FEEDBACK → GITHUB BRIDGE (#190). Real database, real
 * GitHub API.
 *
 * ----------------------------------------------------------------------------
 * What it proves, and why a script rather than a browser pass
 * ----------------------------------------------------------------------------
 *
 * The bridge's acceptance criteria are about an ISSUE that appears on a board
 * and a COLUMN that gets stamped — neither is on a screen, and the one screen
 * involved (`/admin/feedback`) can only show what this already wrote. So this
 * runs the real product path against a real database and reads both sides back:
 * the `feedback` row's `github_issue_number`, and the issue GitHub actually
 * holds (title, labels, body).
 *
 * It follows the rules `scripts/g3-association-lifecycle.ts` set:
 *
 *   * IT PRINTS EVERY ID IT USES, so the evidence names rows and issues that
 *     existed;
 *   * IT MUTATES THROUGH THE PRODUCT PATH — `createFeedback` and
 *     `bridgeFeedbackToGithub`, the same two functions `submitFeedbackAction`
 *     calls. The only raw writes are the fixtures and the cleanup, both
 *     announced;
 *   * IT LEAVES BOTH SYSTEMS AS FOUND. It creates its own church, user and
 *     feedback row and deletes exactly those; the issue it opens is CLOSED as
 *     `not_planned` with a comment saying what opened it (GitHub has no delete
 *     over the API).
 *
 *   GITHUB_FEEDBACK_TOKEN=$(gh auth token) pnpm g3:feedback
 *   GITHUB_FEEDBACK_TOKEN=$(gh auth token) pnpm g3:feedback --keep
 *   pnpm g3:feedback                      # token unset — proves the skip path
 *
 * `--keep` leaves the issue open and the rows in place for a verifier.
 * Point `GITHUB_FEEDBACK_REPO` at a scratch repo to keep the real board clean.
 */
import assert from "node:assert/strict";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { churches, feedback, users } from "@/db/schema";
import {
  FEEDBACK_REPO,
  bridgeFeedbackToGithub,
  feedbackIssueUrl,
} from "@/lib/feedback/github";
import { createFeedback } from "@/lib/feedback/service";

const KEEP = process.argv.includes("--keep");

function step(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 68 - title.length))}`);
}

function id(label: string, value: string | number) {
  console.log(`   ${label}: ${value}`);
}

async function main() {
  const stamp = Date.now();
  const token = process.env.GITHUB_FEEDBACK_TOKEN;

  step("Fixtures");
  const [plant] = await db
    .insert(churches)
    .values({
      name: `G3 Feedback Plant ${stamp}`,
      onboardingCompletedAt: new Date(),
    })
    .returning();
  id("church", plant.id);

  const [planter] = await db
    .insert(users)
    .values({
      email: `g3-feedback-${stamp}@example.test`,
      passwordHash: "x",
      seat: "owner" as const,
      churchId: plant.id,
    })
    .returning();
  id("planter (owner seat)", planter.id);

  let issueNumber: number | null = null;

  try {
    step("1. The product path writes the feedback row");
    const row = await createFeedback(planter.id, plant.id, {
      category: "bug",
      description: `G3 #190 harness ${stamp} — the launch countdown is off by a day.\n\nSecond paragraph, so the title truncation has something to ignore.`,
      pageUrl: "/launch",
    });
    id("feedback row", row.id);
    assert.equal(row.githubIssueNumber, null, "the row starts unstamped");

    step("2. The bridge opens the issue");
    if (!token) {
      console.log(
        "   GITHUB_FEEDBACK_TOKEN unset — asserting the SKIP path instead."
      );
      assert.equal(
        await bridgeFeedbackToGithub({
          feedbackId: row.id,
          category: row.category,
          description: row.description,
          pageUrl: row.pageUrl,
          churchId: row.churchId,
          userId: row.userId,
        }),
        null,
        "no token must return null, not throw"
      );

      const [unstamped] = await db
        .select()
        .from(feedback)
        .where(eq(feedback.id, row.id));
      assert.equal(unstamped.githubIssueNumber, null);
      console.log("   ✓ skipped cleanly; the row is untouched and still holds");
      console.log(
        "     the submission. Re-run with a token for the full path."
      );
      return;
    }

    id("repo", FEEDBACK_REPO);
    issueNumber = await bridgeFeedbackToGithub({
      feedbackId: row.id,
      category: row.category,
      description: row.description,
      pageUrl: row.pageUrl,
      churchId: row.churchId,
      userId: row.userId,
    });
    assert.ok(issueNumber, "the bridge returned no issue number");
    id("issue", feedbackIssueUrl(issueNumber));

    step("3. The row carries the issue number");
    const [stamped] = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, row.id));
    assert.equal(stamped.githubIssueNumber, issueNumber);
    console.log(`   ✓ feedback.github_issue_number = ${issueNumber}`);

    step("4. GitHub holds what we sent");
    const issue = await fetchIssue(issueNumber, token);
    id("title", issue.title);
    id("labels", issue.labels.map((l) => l.name).join(", "));

    assert.ok(
      issue.title.startsWith("[bug] G3 #190 harness"),
      `unexpected title: ${issue.title}`
    );
    assert.deepEqual(
      issue.labels.map((l) => l.name).sort(),
      ["bug", "feedback"],
      "category → labels mapping"
    );
    assert.ok(issue.body.includes(row.id), "the body backlinks the row");
    assert.ok(issue.body.includes(plant.id), "the body carries the church id");
    assert.ok(issue.body.includes(planter.id), "the body carries the user id");
    assert.ok(issue.body.includes("/launch"), "the body carries the page");
    assert.ok(
      !issue.body.includes(planter.email),
      "THE BODY MUST NAME NO PERSON — this repo is public"
    );
    assert.ok(
      !issue.body.includes(plant.name),
      "THE BODY MUST NAME NO CHURCH — this repo is public"
    );
    console.log("   ✓ payload, labels and the no-PII rule all hold");
  } finally {
    if (KEEP) {
      step("Cleanup skipped (--keep)");
    } else {
      step("Cleanup");
      if (issueNumber && token) {
        await closeIssue(issueNumber, token);
        console.log(`   closed issue #${issueNumber} as not_planned`);
      }
      await db.delete(feedback).where(eq(feedback.userId, planter.id));
      await db.delete(users).where(inArray(users.id, [planter.id]));
      await db.delete(churches).where(eq(churches.id, plant.id));
      console.log("   deleted the feedback row, the user and the church");
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub reads/writes the harness makes on its own behalf (never the product's)
// ---------------------------------------------------------------------------

interface IssueView {
  title: string;
  body: string;
  labels: { name: string }[];
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchIssue(number: number, token: string): Promise<IssueView> {
  const response = await fetch(
    `https://api.github.com/repos/${FEEDBACK_REPO}/issues/${number}`,
    { headers: githubHeaders(token) }
  );
  assert.ok(response.ok, `reading issue #${number} failed: ${response.status}`);
  return (await response.json()) as IssueView;
}

async function closeIssue(number: number, token: string) {
  await fetch(
    `https://api.github.com/repos/${FEEDBACK_REPO}/issues/${number}/comments`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({
        body: "Opened by `pnpm g3:feedback`, the #190 bridge harness. Not a real report — closing.",
      }),
    }
  );

  const response = await fetch(
    `https://api.github.com/repos/${FEEDBACK_REPO}/issues/${number}`,
    {
      method: "PATCH",
      headers: githubHeaders(token),
      body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
    }
  );
  assert.ok(response.ok, `closing issue #${number} failed: ${response.status}`);
}

main()
  .then(() => {
    console.log("\n✓ G3 feedback bridge: PASS\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ G3 feedback bridge: FAIL\n", error);
    process.exit(1);
  });
