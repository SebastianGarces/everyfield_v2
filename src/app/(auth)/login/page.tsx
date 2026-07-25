import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DevAccountSwitcher } from "./dev-account-switcher";
import { isDevLoginEnabled, listDevAccounts } from "./dev-accounts";

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
  if (!isDevLoginEnabled()) return null;

  const accounts = await listDevAccounts();
  return <DevAccountSwitcher accounts={accounts} redirectTo={redirectTo} />;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo =
    typeof redirect === "string" && redirect.startsWith("/")
      ? redirect
      : "/dashboard";

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
