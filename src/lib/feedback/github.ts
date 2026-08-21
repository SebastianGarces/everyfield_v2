import type { FeedbackCategory } from "@/db/schema";

import { setFeedbackGithubIssue } from "./service";

// ============================================================================
// Configuration
// ============================================================================

/**
 * The board every piece of in-app feedback lands on. Overridable so a fork or a
 * scratch repo can take the traffic; the default is this repo, which is where
 * the dispatch loop already reads from.
 */
export const DEFAULT_FEEDBACK_REPO = "SebastianGarces/everyfield_v2";

export const FEEDBACK_REPO =
  process.env.GITHUB_FEEDBACK_REPO ?? DEFAULT_FEEDBACK_REPO;

/**
 * Applied to every bridged issue, and deliberately NOT `feature` — that one
 * marks an FRD's parent issue on the board. Created by `ops/setup-labels.sh`.
 */
export const FEEDBACK_LABEL = "feedback";

/**
 * Category → the one extra label. `other` adds nothing: an unclassified report
 * is better left unlabelled than filed under a label that says the wrong thing.
 */
const CATEGORY_LABEL: Record<FeedbackCategory, string | null> = {
  bug: "bug",
  suggestion: "enhancement",
  question: "question",
  other: null,
};

/** GitHub renders long titles badly; the body carries the full description. */
const TITLE_MAX_LENGTH = 100;

const GITHUB_API_VERSION = "2022-11-28";

/** An outbound call inside `after()` holds the function alive; bound it. */
const REQUEST_TIMEOUT_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

export interface FeedbackIssueInput {
  /** The `feedback` row this issue mirrors — the backlink, and the only id a triager needs. */
  feedbackId: string;
  category: FeedbackCategory;
  description: string;
  pageUrl: string | null;
  churchId: string | null;
  userId: string;
}

export interface FeedbackIssuePayload {
  title: string;
  body: string;
  labels: string[];
}

// ============================================================================
// Payload
// ============================================================================

/**
 * Build the issue GitHub receives. Pure, so the shape is testable without a
 * token and without the network.
 *
 * THE BODY NAMES NO PERSON (ruled #190). This repo is PUBLIC, so the submitter's
 * name, their email and their church's name would be published the moment the
 * issue is created. The context ships as opaque uuids instead: they resolve for
 * anyone holding database access, and say nothing to anyone who does not. The
 * human route is the backlink to `/admin/feedback`, which already joins the
 * submitter and the church.
 *
 * The description itself is the submitter's own words and ships verbatim —
 * without it the issue is not actionable. The feedback widget's copy is what
 * tells them where it goes.
 */
export function buildFeedbackIssue(
  input: FeedbackIssueInput
): FeedbackIssuePayload {
  const firstLine =
    input.description.split("\n").find((line) => line.trim().length > 0) ?? "";
  const trimmed = firstLine.trim();
  const summary =
    trimmed.length > TITLE_MAX_LENGTH
      ? `${trimmed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
      : trimmed;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const triageLink = appUrl
    ? `[/admin/feedback](${appUrl}/admin/feedback)`
    : "/admin/feedback";

  const body = [
    input.description,
    "",
    "---",
    "",
    `- **Category:** ${input.category}`,
    `- **Page:** ${input.pageUrl ?? "—"}`,
    `- **Feedback id:** \`${input.feedbackId}\``,
    `- **Church id:** \`${input.churchId ?? "—"}\``,
    `- **User id:** \`${input.userId}\``,
    "",
    `Submitted through the in-app feedback widget. Triage at ${triageLink} —`,
    "the feedback row is the source of truth, and closing or labelling this",
    "issue does not change it.",
  ].join("\n");

  const categoryLabel = CATEGORY_LABEL[input.category];

  return {
    title: `[${input.category}] ${summary}`,
    body,
    labels: categoryLabel ? [FEEDBACK_LABEL, categoryLabel] : [FEEDBACK_LABEL],
  };
}

/** Where a bridged issue lives, for the admin triage view. */
export function feedbackIssueUrl(issueNumber: number): string {
  return `https://github.com/${FEEDBACK_REPO}/issues/${issueNumber}`;
}

// ============================================================================
// Bridge
// ============================================================================

/**
 * Mirror one feedback submission onto the board and record the issue number on
 * the row.
 *
 * Fire-and-forget by contract: the caller schedules this and logs the failure.
 * The `feedback` row is written first and stays the source of truth, so a
 * missing token, a GitHub outage or a rejected payload costs the board an issue
 * and costs the submitter nothing.
 *
 * One-way for alpha: nothing reads GitHub back. The status lifecycle stays in
 * `/admin/feedback`.
 */
export async function bridgeFeedbackToGithub(
  input: FeedbackIssueInput
): Promise<number | null> {
  const token = process.env.GITHUB_FEEDBACK_TOKEN;

  if (!token) {
    console.warn(
      "[FEEDBACK] GITHUB_FEEDBACK_TOKEN unset — skipping the GitHub bridge."
    );
    return null;
  }

  const issueNumber = await createFeedbackIssue(input, token);
  await setFeedbackGithubIssue(input.feedbackId, issueNumber);

  return issueNumber;
}

/**
 * POST the issue. Throws on any non-2xx so the caller's `.catch` logs a body
 * GitHub actually returned — a bad token and a missing label fail differently
 * and the message is the only way to tell.
 *
 * Exported as the network boundary: the token never reaches the payload builder
 * and the DB write never reaches this, so a test can pin the request GitHub
 * receives without a database.
 */
export async function createFeedbackIssue(
  input: FeedbackIssueInput,
  token: string
): Promise<number> {
  const payload = buildFeedbackIssue(input);

  const response = await fetch(
    `https://api.github.com/repos/${FEEDBACK_REPO}/issues`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GitHub issue creation failed (${response.status} ${response.statusText}): ${detail.slice(0, 500)}`
    );
  }

  const created: unknown = await response.json();

  if (
    typeof created !== "object" ||
    created === null ||
    typeof (created as { number?: unknown }).number !== "number"
  ) {
    throw new Error("GitHub issue creation returned no issue number.");
  }

  return (created as { number: number }).number;
}
