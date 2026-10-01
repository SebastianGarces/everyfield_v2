/** Import-free words shared by public recovery forms and the backend. */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "If an account uses that address, we’ll send a password reset link. Check your inbox, or try again later.";
export const PASSWORD_RESET_LINK_DEAD_MESSAGE =
  "That reset link no longer works. Ask for a new password reset link.";
export const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_PASSWORD_MAX_LENGTH = 1024;

export function isPasswordResetToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
