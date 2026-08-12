import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { isDevLoginEnabled, listDevAccounts } from "./dev-accounts";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

function LoginFormSkeleton() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Local-development-only account switcher. Renders nothing (and queries
 * nothing) unless the app is running on a dev machine — see dev-accounts.ts.
 */
async function DevAccountSwitcherSlot({ redirectTo }: { redirectTo: string }) {
  // Compared against a literal so the bundler can fold this to `true` in a
  // production build and drop everything below — including the dynamic import,
  // which is what keeps the switcher component out of the client bundle
  // entirely. A call to `isDevLoginEnabled()` here would still guard correctly
  // at runtime, but the bundler cannot see through the function call and the
  // component would ship as unreachable dead weight.
  if (process.env.NODE_ENV !== "development") return null;
  if (!isDevLoginEnabled()) return null;

  const accounts = await listDevAccounts();
  if (accounts.length === 0) return null;

  const { DevAccountSwitcher } = await import("./dev-account-switcher");
  return <DevAccountSwitcher accounts={accounts} redirectTo={redirectTo} />;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = safeRedirectPath(redirect);

  // The auth layout is a flex row; stack so the dev switcher sits BELOW the
  // form rather than beside it.
  return (
    <div className="flex w-full max-w-md flex-col items-center">
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm />
      </Suspense>
      <DevAccountSwitcherSlot redirectTo={redirectTo} />
    </div>
  );
}
