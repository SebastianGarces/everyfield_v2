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
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { finishPasswordReset, type ResetPasswordState } from "./actions";
const initial: ResetPasswordState = {};
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(finishPasswordReset, initial);
  if (state.success)
    return (
      <Card className="mx-4 w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Password reset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="status" className="text-sm">
            Your password was changed and all existing sessions were signed out.
          </p>
          <Link href="/login" className="text-primary text-sm hover:underline">
            Sign in with your new password
          </Link>
        </CardContent>
      </Card>
    );
  return (
    <Card className="mx-4 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Choose a new password</CardTitle>
        <CardDescription>
          Use at least {MIN_PASSWORD_LENGTH} characters. You will sign in again
          afterward.
        </CardDescription>
      </CardHeader>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <CardContent className="space-y-4">
          {state.error && (
            <p role="alert" className="text-destructive text-sm">
              {state.error}{" "}
              <Link href="/forgot-password" className="underline">
                Request a new reset link
              </Link>
            </p>
          )}
          {(
            [
              { name: "password", label: "New password" },
              { name: "confirmPassword", label: "Confirm new password" },
            ] as const
          ).map(({ name, label }) => (
            <div key={name} className="space-y-2">
              <Label htmlFor={`reset-${name}`}>{label}</Label>
              <Input
                id={`reset-${name}`}
                name={name}
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={1024}
                aria-invalid={!!state.fieldErrors?.[name]}
                aria-describedby={
                  state.fieldErrors?.[name] ? `reset-${name}-error` : undefined
                }
              />
              {state.fieldErrors?.[name] && (
                <p
                  id={`reset-${name}-error`}
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {state.fieldErrors[name]}
                </p>
              )}
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full cursor-pointer"
            type="submit"
            disabled={pending}
          >
            {pending ? "Resetting..." : "Reset password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
