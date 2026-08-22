import type { Metadata } from "next";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth/session";

// ============================================================================
// WHERE A COMPLETED ADDRESS CHANGE LANDS — CS-002 (#616), added by #658.
//
// ----------------------------------------------------------------------------
// IT PROVES NOTHING AND ASSERTS NOTHING — IT READS THE SESSION
// ----------------------------------------------------------------------------
//
// The sentence names the address the account signs in with RIGHT NOW, taken
// from the session's own row. So it is true for every reader who reaches it,
// including one who arrives by typing the URL, and it cannot drift from the
// swap the way a message carried in a query string could. Nothing here re-reads
// the token, and nothing here writes: `/verify-email` owns the redemption and
// this page owns only the telling.
//
// ----------------------------------------------------------------------------
// WHY THE OUTCOME IS A PAGE AND NOT A PANE ON THE ONE THAT ASKED
// ----------------------------------------------------------------------------
//
// Two reasons, both measured on the pane it replaces (#658).
//
// The change is TERMINAL, and the URL that asked for it is not: `?token=` is
// spent the moment the swap commits, so a reload of the asking page — the first
// thing a reader who is unsure does — earned the dead-link sentence for a change
// that had in fact succeeded. This URL carries no token, so reloading it, or
// coming back to it, says the same thing every time.
//
// And a pane whose text came out of the press had to wait for the press's own
// transition to commit, which — with the tree patch `refresh()` streamed into
// it — never happened: the address moved, the payload arrived, and the button
// stayed on "Confirming…". A server-rendered page is not waiting on anything.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your email address is confirmed",
};

export default async function EmailChangeConfirmedPage() {
  // The LAYOUT refuses a signed-out reader (see `../page.tsx`); this asks for
  // the session already established, because the address it names is the
  // session's own.
  const { user } = await verifySession();

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Your email address" }]} />
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-10">
        <h1 className="text-xl font-semibold tracking-tight">
          Your address is confirmed
        </h1>
        <p className="text-muted-foreground text-pretty">
          You now sign in as <strong>{user.email}</strong>. Your old address no
          longer works, and we have told it about the change.
        </p>
        <Button asChild className="cursor-pointer">
          <Link href="/settings/account">Back to settings</Link>
        </Button>
      </div>
    </>
  );
}
