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
 *   GITHUB_FEEDBACK_REPO=<you>/scratch GITHUB_FEEDBACK_TOKEN=$(gh auth token) \
 *     pnpm g3:feedback
 *   GITHUB_FEEDBACK_TOKEN=$(gh auth token) pnpm g3:feedback --live-board
 *   pnpm g3:feedback                      # token unset — proves the skip path
 *
 * A run that would open an issue on the REAL board is REFUSED unless
 * `--live-board` says so: cleanup lives in `finally`, and a killed process
 * leaves a stray issue on a public tracker. `--keep` leaves the issue open and
 * the rows in place for a verifier. It silences the feedback email either way.
 */
import assert from "node:assert/strict";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { churches, feedback, users } from "@/db/schema";
import {
  DEFAULT_FEEDBACK_REPO,
  FEEDBACK_REPO,
  feedbackIssueUrl,
} from "@/lib/feedback/github";
import { notifyNewFeedback } from "@/lib/feedback/notify";
import { createFeedback } from "@/lib/feedback/service";

const KEEP = process.argv.includes("--keep");
const LIVE_BOARD = process.argv.includes("--live-board");

/** The slug half of the page path — authored text, which must not be published. */
const AUTHORED_SLUG = "g3-190-pastor-john-smith-succession";

function step(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 68 - title.length))}`);
}

function id(label: string, value: string | number) {
  console.log(`   ${label}: ${value}`);
}

async function main() {
  const stamp = Date.now();
  const token = process.env.GITHUB_FEEDBACK_TOKEN;

  assert.ok(
    FEEDBACK_REPO !== DEFAULT_FEEDBACK_REPO || LIVE_BOARD || !token,
    "this would open an issue on the REAL board. Set GITHUB_FEEDBACK_REPO to a scratch repo, or pass --live-board to mean it."
  );

  // The email half is the pre-existing notifier and is not what this proves;
  // silencing it keeps a harness run from mailing the team every time.
  delete process.env.FEEDBACK_EMAIL_TO;

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
      pageUrl: `/wiki/leadership/${AUTHORED_SLUG}`,
    });
    id("feedback row", row.id);
    id("page url on the row", row.pageUrl ?? "—");
    assert.equal(row.githubIssueNumber, null, "the row starts unstamped");

    step("2. The product path notifies — the same call the action schedules");
    id("repo", FEEDBACK_REPO);
    await notifyNewFeedback(row, { name: planter.name, email: planter.email });

    const [afterNotify] = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, row.id));

    if (!token) {
      console.log(
        "   GITHUB_FEEDBACK_TOKEN unset — asserting the SKIP path instead."
      );
      assert.equal(
        afterNotify.githubIssueNumber,
        null,
        "no token must leave the row unstamped"
      );
      console.log("   ✓ skipped cleanly; the row is untouched and still holds");
      console.log(
        "     the submission. Re-run with a token for the full path."
      );
      return;
    }

    step("3. The row carries the issue number");
    issueNumber = afterNotify.githubIssueNumber;
    assert.ok(issueNumber, "the bridge stamped no issue number");
    id("issue", feedbackIssueUrl(issueNumber));
    console.log(`   ✓ feedback.github_issue_number = ${issueNumber}`);

    step("4. GitHub holds what we sent, and nothing we owed the submitter");
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

    // The no-PII rule, on a PUBLIC board. The page path is the subtle half: it
    // is attached by the widget, not typed by the submitter, and `/wiki/**`
    // slugs are church-authored text.
    assert.ok(
      !issue.body.includes(planter.email),
      "THE BODY MUST NAME NO PERSON — this repo is public"
    );
    assert.ok(
      !issue.body.includes(plant.name),
      "THE BODY MUST NAME NO CHURCH — this repo is public"
    );
    assert.ok(
      !issue.body.includes(AUTHORED_SLUG),
      "THE BODY MUST NOT CARRY AN AUTHORED SLUG — this repo is public"
    );
    assert.ok(
      issue.body.includes("**Page:** /wiki/…/…"),
      "the route still reaches the triager, redacted"
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
