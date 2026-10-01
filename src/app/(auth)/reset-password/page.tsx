import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";
import { isPasswordResetToken } from "@/lib/auth/password-reset-policy";
export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  if (!isPasswordResetToken(token))
    return (
      <Card className="mx-4 w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Reset link unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            That reset link no longer works. Request a new one.
          </p>
          <Link
            href="/forgot-password"
            className="text-primary text-sm hover:underline"
          >
            Request a new reset link
          </Link>
        </CardContent>
      </Card>
    );
  // GET only displays the form; scanners cannot consume or change a credential.
  return <ResetPasswordForm token={token} />;
}
