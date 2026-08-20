import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";
import { isDevLoginEnabled, listDevAccounts } from "./dev-accounts";
import { listPreviewAccounts } from "./preview-accounts";
import { getCurrentSession } from "@/lib/auth";
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
  const { redirect: redirectParam } = await searchParams;
  const redirectTo = safeRedirectPath(redirectParam);

  // The already-signed-in bounce, which the proxy used to do off `/login` and
  // can no longer do correctly (#503). It branches on the session COOKIE, and a
  // cookie that no longer verifies is exactly the reader the layout sends here
  // — so the proxy sent them back, forever. This asks the SESSION instead, so a
  // dead cookie falls through to the form that fixes it and only a live session
  // is bounced. `redirectTo` is already through `safeRedirectPath`.
  const { user } = await getCurrentSession();
  if (user) {
    redirect(redirectTo);
  }

  // The auth layout is a flex row; stack so the two scaffolding blocks — the
  // preview picker (rendered by `LoginForm` as a sibling of its card) and the
  // dev switcher — sit BELOW the form rather than beside it.
  //
  // `listPreviewAccounts()` is empty everywhere but a Vercel preview, so on
  // production this passes `[]` and the picker renders nothing — and because
  // the roster only ever crosses to the browser as this prop, no seeded address
  // is in a production client chunk. It is a plain in-repo constant, not a
  // query: there is no second thing to gate.
  return (
    <div className="flex w-full max-w-md flex-col items-center">
      <LoginForm
        redirectTo={redirectTo}
        previewAccounts={listPreviewAccounts()}
      />
      <DevAccountSwitcherSlot redirectTo={redirectTo} />
    </div>
  );
}
