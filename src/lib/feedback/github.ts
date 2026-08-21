// ============================================================================
// The GitHub side of the feedback bridge (#190), and NOTHING else.
//
// Deliberately dependency-free — no database, no `next/*` — so the payload
// builder is importable by a test with neither a token nor a connection string.
// The row that links back is stamped by `./notify`, which owns both notifiers.
// ============================================================================
import type { FeedbackCategory } from "@/db/schema";

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
 * submitter and the church — and holds the untouched `page_url`.
 *
 * The description itself is the submitter's own words and ships verbatim —
 * without it the issue is not actionable. The feedback widget's copy is what
 * tells them where it goes. Everything the SYSTEM attaches on their behalf is
 * the platform's disclosure rather than theirs, and stays off the board.
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
    `- **Page:** ${publishablePath(input.pageUrl)}`,
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

const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ROUTE, never the authored tail.
 *
 * One route embeds text a church wrote: `/wiki/[...slug]` slugs are authored
 * content, not sanitised identifiers (`@/lib/wiki/href`), so a planter who
 * opens the widget while reading an article they titled after a person would
 * publish that person's name on a public board — the one leak the no-person
 * rule above could not see, because the widget attaches the path, not the user.
 *
 * Redacted by CONSTRUCTION rather than by a `/wiki/` denylist: the first
 * segment and any uuid survive, everything else becomes `…`. A route added next
 * year is safe without anyone remembering this. The full path is on the
 * `feedback` row, one backlink away.
 */
function publishablePath(pageUrl: string | null): string {
  if (!pageUrl) return "—";

  const [first, ...rest] = pageUrl.split("/").filter(Boolean);
  if (!first) return "/";

  return `/${[first, ...rest.map((s) => (UUID_SEGMENT.test(s) ? s : "…"))].join("/")}`;
}

/** Where a bridged issue lives, for the admin triage view. */
export function feedbackIssueUrl(issueNumber: number): string {
  return `https://github.com/${FEEDBACK_REPO}/issues/${issueNumber}`;
}

// ============================================================================
// The network boundary
// ============================================================================

/**
 * Open the issue, and answer `null` when the bridge is not configured.
 *
 * `null` vs a throw is the whole contract: an unset token is an ENVIRONMENT
 * that does not bridge (local dev, a preview, any deploy without the PAT), not
 * a failure, and it must read differently from a GitHub outage. Every other
 * refusal throws, carrying the status and body GitHub returned — a bad token
 * and a missing label fail differently, and the message is the only way to tell.
 *
 * One-way for alpha: nothing here reads GitHub back.
 */
export async function createFeedbackIssue(
  input: FeedbackIssueInput
): Promise<number | null> {
  const token = process.env.GITHUB_FEEDBACK_TOKEN;

  if (!token) {
    console.warn(
      "[FEEDBACK] GITHUB_FEEDBACK_TOKEN unset — skipping the GitHub bridge."
    );
    return null;
  }

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
