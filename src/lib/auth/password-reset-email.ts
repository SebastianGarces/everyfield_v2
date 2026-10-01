import { createHash } from "node:crypto";
import { formatDateTimeWithZone } from "@/lib/datetime";
import { EMAIL_REPLY_TO, sendEmail } from "@/lib/email/client";
import {
  passwordResetEmail,
  passwordResetNoticeEmail,
} from "@/lib/email/templates/password-reset";
import { appBaseUrl } from "@/lib/notifications/channels/email";

export interface PasswordResetMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string;
  idempotencyKey: string;
}
export interface PasswordResetMailDeps {
  send?: (
    message: PasswordResetMessage
  ) => Promise<{ success: boolean; error?: string }>;
  baseUrl?: string;
}
export interface PasswordResetLinkFacts {
  to: string;
  recipientName: string | null;
  token: string;
  expiresAt: Date;
}
export interface PasswordResetNoticeFacts {
  to: string;
  recipientName: string | null;
  changedAt: Date;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function buildPasswordResetLink(
  facts: PasswordResetLinkFacts,
  baseUrl = appBaseUrl()
): Promise<PasswordResetMessage> {
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(facts.token)}`;
  return {
    to: facts.to,
    ...(await passwordResetEmail({
      recipientName: facts.recipientName?.trim() || null,
      resetUrl,
      expiresLabel: formatDateTimeWithZone(facts.expiresAt),
    })),
    replyTo: EMAIL_REPLY_TO,
    idempotencyKey: `password-reset-link-${digest(facts.token)}`,
  };
}
export async function buildPasswordResetNotice(
  facts: PasswordResetNoticeFacts
): Promise<PasswordResetMessage> {
  return {
    to: facts.to,
    ...(await passwordResetNoticeEmail({
      recipientName: facts.recipientName?.trim() || null,
      changedAtLabel: formatDateTimeWithZone(facts.changedAt),
    })),
    replyTo: EMAIL_REPLY_TO,
    idempotencyKey: `password-reset-notice-${digest(facts.to)}-${facts.changedAt.getTime()}`,
  };
}
async function dispatch(
  build: () => Promise<PasswordResetMessage>,
  deps: PasswordResetMailDeps,
  occasion: "link" | "notice"
): Promise<boolean> {
  try {
    const result = await (deps.send ?? sendEmail)(await build());
    if (!result.success)
      console.error("password reset mail refused", { occasion });
    return result.success;
  } catch {
    // Never log provider errors: they may contain a credential-bearing URL.
    console.error("password reset mail transport failed", { occasion });
    return false;
  }
}
export function sendPasswordResetLink(
  facts: PasswordResetLinkFacts,
  deps: PasswordResetMailDeps = {}
) {
  return dispatch(
    () => buildPasswordResetLink(facts, deps.baseUrl),
    deps,
    "link"
  );
}
export function sendPasswordResetNotice(
  facts: PasswordResetNoticeFacts,
  deps: PasswordResetMailDeps = {}
) {
  return dispatch(() => buildPasswordResetNotice(facts), deps, "notice");
}
