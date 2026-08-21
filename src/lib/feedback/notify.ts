// ============================================================================
// What happens AFTER a feedback row is written (#190).
//
// Two notifiers, one owner. No `"use server"` directive: this is a helper the
// action schedules, not a POSTable endpoint (`memory/invariants.md` →
// Authentication).
// ============================================================================
import { db } from "@/db";
import { churches, type Feedback } from "@/db/schema";
import { sendEmail } from "@/lib/email/client";
import { feedbackNotificationEmail } from "@/lib/email/templates/feedback-notification";
import { eq } from "drizzle-orm";

import { createFeedbackIssue } from "./github";
import { setFeedbackGithubIssue } from "./service";

/** Who submitted it. The row holds the id; the email needs the human fields. */
export interface FeedbackSubmitter {
  name: string | null;
  email: string;
}

/**
 * Mail the team and open the board issue.
 *
 * FIRE-AND-FORGET BY CONTRACT, and it is the contract that matters: the
 * `feedback` row is already written and is the record, so neither notifier may
 * fail a submission. Both failures are caught and logged here rather than
 * thrown, and this function never rejects — the caller schedules it and walks
 * away.
 *
 * The two run CONCURRENTLY. They share nothing, and `after` has a bounded
 * post-response budget: awaiting an unbounded Resend call before even starting
 * the GitHub one would let a stalled email cost the board its issue, silently.
 */
export async function notifyNewFeedback(
  row: Feedback,
  submitter: FeedbackSubmitter
): Promise<void> {
  await Promise.all([notifyByEmail(row, submitter), openBoardIssue(row)]);
}

async function notifyByEmail(row: Feedback, submitter: FeedbackSubmitter) {
  const to = process.env.FEEDBACK_EMAIL_TO;
  if (!to) return;

  try {
    // The email goes to the team's own mailbox, so unlike the public issue it
    // may name the submitter and the church.
    let churchName: string | null = null;
    if (row.churchId) {
      const [church] = await db
        .select({ name: churches.name })
        .from(churches)
        .where(eq(churches.id, row.churchId))
        .limit(1);
      churchName = church?.name ?? null;
    }

    const { subject, html, text } = await feedbackNotificationEmail({
      category: row.category,
      description: row.description,
      pageUrl: row.pageUrl,
      userName: submitter.name ?? "Unknown",
      userEmail: submitter.email,
      churchName,
      submittedAt: row.createdAt.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }),
    });

    await sendEmail({ to, subject, html, text });
  } catch (error) {
    console.error("[FEEDBACK] Email notification failed:", error);
  }
}

async function openBoardIssue(row: Feedback) {
  try {
    const issueNumber = await createFeedbackIssue({
      feedbackId: row.id,
      category: row.category,
      description: row.description,
      pageUrl: row.pageUrl,
      churchId: row.churchId,
      userId: row.userId,
    });

    // null = no token, so there is nothing to stamp and nothing went wrong.
    if (issueNumber !== null) {
      await setFeedbackGithubIssue(row.id, issueNumber);
    }
  } catch (error) {
    console.error("[FEEDBACK] GitHub issue creation failed:", error);
  }
}
