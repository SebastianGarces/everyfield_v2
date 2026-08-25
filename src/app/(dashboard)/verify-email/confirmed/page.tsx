import type { Metadata } from "next";
import Link from "next/link";

import { settingsSectionUrl } from "@/lib/settings/sections";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth/session";

// ============================================================================
// WHERE A COMPLETED ADDRESS CHANGE LANDS — CS-002 (#616), added by #658.
//
// IT READS THE SESSION AND NOTHING ELSE. No token, no query, no write:
// `/verify-email` owns the redemption and this page owns only the telling, so
// the address it names is the one the account signs in with right now.
// `confirmEmailChangeAction` holds WHY the outcome is a page rather than a pane
// on the asking screen — in short, a spent `?token=` URL cannot survive a
// reload and a pane's sentence had to wait on a transition that never came.
//
// ONE THING IT CLAIMS THAT IT CANNOT CHECK: the second sentence describes an
// EVENT ("your old address no longer works"), and a signed-in reader who simply
// types this URL never had one. Kept deliberately — it is the reassurance the
// reader who DID just move a credential needs, and the arrival it is wrong for
// is one nothing links to. It is a trade, not an oversight.
// ============================================================================

export const dynamic = "force-dynamic";

// One string for the tab, the breadcrumb and the heading — the sibling page
// does the same, and three names for one page is three pages to a reader
// skimming history.
const TITLE = "Your address is confirmed";

export const metadata: Metadata = { title: TITLE };

export default async function EmailChangeConfirmedPage() {
  // The LAYOUT refuses a signed-out reader (see `../page.tsx`); this asks for
  // the session already established, because the address it names is the
  // session's own.
  const { user } = await verifySession();

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: TITLE }]} />
      <PageCanvas context="none" contentFocusTarget>
        <WorkspacePanel className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight">{TITLE}</h1>
          <p className="text-muted-foreground text-pretty">
            You now sign in as <strong>{user.email}</strong>. Your old address
            no longer works, and we have told it about the change.
          </p>
          <Button asChild className="cursor-pointer">
            {/* PATH AND FRAGMENT, not a bare `#settings/account` (#657): this
              page is not a dashboard screen the modal should open OVER — the
              reader is finished here and is going back into the app. A real
              navigation also keeps Next's router holding the fragment, which a
              same-page `#`-link would not. */}
            <Link href={settingsSectionUrl("account")}>Back to settings</Link>
          </Button>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
