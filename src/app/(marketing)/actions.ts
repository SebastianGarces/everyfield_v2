"use server";

import { z } from "zod";

import { sendEmail } from "@/lib/email/client";

export type RequestInviteState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const requestInviteSchema = z.object({
  email: z.email(),
  // Honeypot: any value means a bot filled the hidden field.
  website: z.literal("").or(z.undefined()),
});

/**
 * Interest capture for the invite-gated alpha (#188). No account, no DB row —
 * the request lands in the platform admins' inbox (ADMIN_EMAILS).
 */
export async function requestInviteAction(
  _prev: RequestInviteState,
  formData: FormData
): Promise<RequestInviteState> {
  const parsed = requestInviteSchema.safeParse({
    email: formData.get("email"),
    website: formData.get("website") || undefined,
  });

  if (!parsed.success) {
    // Honeypot hits get a quiet success; a real bad email gets an honest error.
    if (
      typeof formData.get("website") === "string" &&
      formData.get("website")
    ) {
      return { status: "success" };
    }
    return {
      status: "error",
      message: "That email doesn't look right — mind checking it?",
    };
  }

  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (admins.length === 0) {
    console.error("[INVITE] ADMIN_EMAILS is not configured");
    return {
      status: "error",
      message: "Something went wrong on our end. Please try again later.",
    };
  }

  const { email } = parsed.data;
  const result = await sendEmail({
    to: admins,
    subject: `Invite request — ${email}`,
    html: `<p>Someone requested an EveryField invite from the landing page.</p><p><b>${email}</b></p>`,
    text: `Someone requested an EveryField invite from the landing page.\n\n${email}`,
    idempotencyKey: `invite-request/${email.toLowerCase()}`,
  });

  if (!result.success) {
    return {
      status: "error",
      message: "Something went wrong on our end. Please try again later.",
    };
  }

  return { status: "success" };
}
