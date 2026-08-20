import { LoginForm } from "./login-form";
import { isDevLoginEnabled, listDevAccounts } from "./dev-accounts";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

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
  // The ONE place the incoming `?redirect=` is read on this page, handed to
  // both forms below. The Suspense boundary that used to wrap the form went
  // with the `useSearchParams` inside it: this page already awaits
  // `searchParams`, so nothing below it suspends and the skeleton never showed.
  const { redirect } = await searchParams;
  const redirectTo = safeRedirectPath(redirect);

  // The auth layout is a flex row; stack so the dev switcher sits BELOW the
  // form rather than beside it.
  return (
    <div className="flex w-full max-w-md flex-col items-center">
      <LoginForm redirectTo={redirectTo} />
      <DevAccountSwitcherSlot redirectTo={redirectTo} />
    </div>
  );
}
