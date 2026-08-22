"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { login, type LoginState } from "./actions";
import { PreviewAccountPicker } from "./preview-account-picker";
import type { PreviewAccount } from "./preview-accounts";

const initialState: LoginState = {};

const readHash = () => window.location.hash;

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * `redirectTo` arrives as a prop, already through `safeRedirectPath` on the
 * page. The form used to read `?redirect=` itself with `useSearchParams`, which
 * made it a SECOND reader of the param and the only ungated one — harmless
 * because the action re-checks the field it submits, but it is one round trip
 * and it should have one gate (#503).
 *
 * THE FRAGMENT IS CARRIED BACK BY THIS COMPONENT, because nothing else can
 * (#657). A browser never sends one to a server, so `loginPathFor` writes a
 * path-and-query `?redirect=` and says in its own header that preserving a
 * fragment is a client-side job — this is that job. It matters now that settings
 * is addressed by one: a notification email links to
 * `/dashboard#settings/notifications`, and a recipient who is signed out reaches
 * `/login?redirect=%2Fdashboard` with `#settings/notifications` still on THIS
 * document's URL. Without re-attaching it they sign in and land on the dashboard
 * with no modal, one section short of where the mail sent them.
 *
 * `useSyncExternalStore` with an empty server snapshot, and never `useEffect`:
 * the fragment is browser-only state, so the server renders the bare path and
 * the client corrects it on hydration with no mismatch. It subscribes to
 * `hashchange` for the same reason anything reading `location.hash` does — the
 * value can change under a mounted form.
 *
 * `previewAccounts` is empty everywhere but a Vercel preview, where it carries
 * the seeded QA roster (`preview-accounts.ts`). The picker it feeds only WRITES
 * THESE TWO FIELDS — this component owns both values, the form action below is
 * the same one a hand-typed login submits, and there is no second path to a
 * session. Both inputs are controlled for exactly that reason: an autofill that
 * reached around into the DOM would be a second owner of the field, and the
 * value React submits is the one in this state.
 */
export function LoginForm({
  redirectTo,
  previewAccounts,
}: {
  redirectTo: string;
  previewAccounts: PreviewAccount[];
}) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [picked, setPicked] = useState<PreviewAccount | null>(null);
  const hash = useSyncExternalStore(subscribeToHash, readHash, () => "");

  return (
    <>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Enter your credentials to sign in to your account
          </CardDescription>
        </CardHeader>
        <form action={formAction}>
          {/* `safeRedirectPath` has already gated the path half on the server
              and gates it again on the way back; a fragment adds nothing it can
              refuse, since it must still start with `/` and carry no control
              characters. */}
          <input type="hidden" name="redirect" value={`${redirectTo}${hash}`} />
          <CardContent className="space-y-4">
            {state.error && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                {state.error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                value={email}
                // Typing drops the pick, so the picker never names an account
                // whose credentials are no longer the ones in these fields.
                onChange={(event) => {
                  setEmail(event.target.value);
                  setPicked(null);
                }}
                aria-invalid={!!state.fieldErrors?.email}
              />
              {state.fieldErrors?.email && (
                <p className="text-destructive text-sm">
                  {state.fieldErrors.email}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPicked(null);
                }}
                aria-invalid={!!state.fieldErrors?.password}
              />
              {state.fieldErrors?.password && (
                <p className="text-destructive text-sm">
                  {state.fieldErrors.password}
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
              {pending ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>

      {/*
        Below the Sign in button, a sibling of the card — the same slot the dev
        account switcher occupies in `page.tsx` (owner ruling, 2026-08-20). It
        still only WRITES the two controlled values above; it is not in the
        form, has no field of its own, and nothing about the submit changed.
      */}
      <PreviewAccountPicker
        accounts={previewAccounts}
        picked={picked}
        onPick={(account) => {
          setPicked(account);
          setEmail(account.email);
          // `null` means the password is not in the repo. Clear the field
          // rather than leaving a stale one from the previous pick, so what
          // is on screen is what will be submitted.
          setPassword(account.password ?? "");
        }}
      />
    </>
  );
}
