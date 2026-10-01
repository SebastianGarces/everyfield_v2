"use server";
import { after } from "next/server";
import { isMailableAddress } from "@/lib/auth/account-email";
import { getRequestIp } from "@/lib/auth/rate-limit";
import { requestPasswordReset } from "@/lib/auth/password-reset";
import { PASSWORD_RESET_REQUEST_MESSAGE } from "@/lib/auth/password-reset-policy";
export type ForgotPasswordState = { message?: string; error?: string };
export async function forgotPassword(
  _previous: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const requestedEmail = String(formData.get("email") ?? "").trim();
  if (requestedEmail.length > 254 || !isMailableAddress(requestedEmail))
    return { error: "Enter a valid email address" };
  const started = Date.now();
  try {
    await requestPasswordReset({
      requestedEmail,
      ip: await getRequestIp(),
      deferSend: (send) => after(send),
    });
  } catch {
    // Generic response even for storage/provider failures; no account or link in logs.
    console.error("password reset request failed");
  }
  // Dispatch happens after the response, removing provider latency as an account oracle.
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 500 - (Date.now() - started)))
  );
  return { message: PASSWORD_RESET_REQUEST_MESSAGE };
}
