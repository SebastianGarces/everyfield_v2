import type { Metadata } from "next";
import { ForgotPasswordForm } from "./recovery-form";
export const metadata: Metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
