import { Resend } from "resend";

// Initialize Resend client
// RESEND_API_KEY must be set in environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

export { resend };

// Default sender configuration
export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "EveryField <notifications@everyfield.com>";

/**
 * Send a single email via Resend
 * Includes error handling and logging
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  idempotencyKey,
}: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      headers,
    });

    if (error) {
      console.error("[EMAIL] Send failed:", error);
      return { success: false, error: error.message };
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[EMAIL] Sent:", { to, subject, id: data?.id });
    }

    return { success: true, id: data?.id };
  } catch (err) {
    console.error("[EMAIL] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
