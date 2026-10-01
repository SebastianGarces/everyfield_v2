"use server";
import { deleteSessionCookie } from "@/lib/auth/cookies";
import { getRequestIp } from "@/lib/auth/rate-limit";
import { resetPassword } from "@/lib/auth/password-reset";
export type ResetPasswordState = {
  success?: boolean;
  error?: string;
  fieldErrors?: { password?: string; confirmPassword?: string };
};
export async function finishPasswordReset(
  _previous: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  try {
    const result = await resetPassword({
      token: String(formData.get("token") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
      ip: await getRequestIp(),
    });
    if (result.ok) {
      await deleteSessionCookie();
      return { success: true };
    }
    return result.field
      ? { fieldErrors: { [result.field]: result.message } }
      : { error: result.message };
  } catch {
    console.error("password reset completion failed");
    return { error: "We could not reset your password. Please try again." };
  }
}
