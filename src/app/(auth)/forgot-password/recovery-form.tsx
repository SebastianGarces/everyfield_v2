"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { forgotPassword, type ForgotPasswordState } from "./actions";
const initial: ForgotPasswordState = {};
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPassword, initial);
  return (
    <Card className="mx-4 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Forgot password?</CardTitle>
        <CardDescription>Enter the email you use to sign in.</CardDescription>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4">
          {state.message && (
            <p role="status" className="text-sm">
              {state.message}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="recovery-email">Email</Label>
            <Input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              aria-invalid={!!state.error}
              aria-describedby={
                state.error ? "recovery-email-error" : undefined
              }
            />
            {state.error && (
              <p
                role="alert"
                id="recovery-email-error"
                className="text-destructive text-sm"
              >
                {state.error}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full cursor-pointer"
            disabled={pending}
          >
            {pending ? "Requesting..." : "Send reset link"}
          </Button>
          <Link href="/login" className="text-primary text-sm hover:underline">
            Back to sign in
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
