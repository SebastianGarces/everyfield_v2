import type { Metadata } from "next";

import { HeaderBreadcrumbs } from "@/components/header";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import { verifySession } from "@/lib/auth/session";
import {
  buildPreferenceMatrixView,
  loadUserPreferences,
  preferenceOwnerFromSession,
} from "@/lib/notifications/preferences";

// ============================================================================
// Screen 2 — notification preferences (N-006).
//
// The server resolves the whole screen and hands the client component a
// finished view model: the matrix's rows and columns derived from the code
// registry, every cell resolved against the user's stored rows, and the digest
// cadence. Nothing about the set of categories is written down here — add a
// seventh to `notificationCategories` with its copy in
// `src/lib/notifications/categories.ts` and it appears, with its coded default,
// with no edit to this file.
//
// Preferences are per USER, not per church (a coach across two plants keeps one
// set of choices), so unlike every other dashboard screen this one takes no
// church scope — and unlike every other screen there is no id in the URL to
// scope it by either. The owner is minted from the session and is the only
// thing the reads and writes will accept; see `actions.ts`.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const owner = preferenceOwnerFromSession(await verifySession());
  const view = buildPreferenceMatrixView(await loadUserPreferences(owner));

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Settings" }]} />

      <div className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm">
            How EveryField reaches you.
          </p>
        </div>

        <section
          aria-labelledby="notification-preferences"
          className="space-y-4"
        >
          <div className="space-y-1">
            <h2
              id="notification-preferences"
              className="text-lg font-semibold tracking-tight"
            >
              Notifications
            </h2>
            <p className="text-muted-foreground text-sm">
              Choose what you hear about, and where. Changes save as you make
              them and apply from the next send.
            </p>
          </div>

          <PreferenceMatrix view={view} />
        </section>
      </div>
    </>
  );
}
