import type { Metadata } from "next";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import { verifySession } from "@/lib/auth/session";
import {
  audienceForRole,
  buildPreferenceMatrixView,
  loadUserPreferences,
  preferenceOwnerFromSession,
} from "@/lib/notifications/preferences";
// ⚠️ PROTOTYPE — DISPOSABLE. Four presentations of the ineligible category rows
// (#369 decision 2), to be ruled by operating them on the preview. Delete this
// import, the constant and both blocks in the JSX with the ruling.
import { OversightEligibilityPrototypeSwitcher } from "@/components/notifications/oversight-eligibility-prototype";

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

// ⚠️ PROTOTYPE — DISPOSABLE (#369). Inlined rather than imported:
// `prototypeInitScript` is exported from a "use client" module, so a Server
// Component cannot call it. It re-applies the stored choice before first paint,
// so a reload does not flash the as-built rows over the variant being judged.
const ELIGIBILITY_PROTO_INIT = `try{var p=localStorage.getItem("oversight-elig-proto");document.documentElement.setAttribute("data-oversight-elig-proto",["now","a","b","c"].includes(p)?p:"now")}catch(e){document.documentElement.setAttribute("data-oversight-elig-proto","now")}`;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await verifySession();
  const owner = preferenceOwnerFromSession(session);
  // The matrix must be resolved against the SAME audience the feed, the badge
  // and the dispatcher resolve against, or an absent row renders as one value
  // here and behaves as another there (N-027).
  const view = buildPreferenceMatrixView(
    await loadUserPreferences(owner),
    audienceForRole(session.user.role)
  );

  const isPlanterWithPlant =
    session.user.role === "planter" && Boolean(session.user.churchId);

  // ⚠️ PROTOTYPE — DISPOSABLE (#369). The four candidates differ only for a
  // reader who has ineligible rows, so the switcher is offered only to one —
  // a planter would otherwise get a floating pill with nothing behind it.
  const hasPrototypeToOperate = view.ineligibleNote !== null;

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Settings" }]} />

      {/* ⚠️ PROTOTYPE — DISPOSABLE (#369) — start. */}
      {hasPrototypeToOperate && (
        <script dangerouslySetInnerHTML={{ __html: ELIGIBILITY_PROTO_INIT }} />
      )}
      {/* ⚠️ PROTOTYPE — DISPOSABLE (#369) — end. */}

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

        {/* The one setting on the neighbouring screen, linked rather than
            inlined. It is a different KIND of decision — church-wide, about
            what leaves the plant, and the planter's alone — and folding it into
            a personal notification matrix would make a consent choice read as
            one more switch about email volume (N-026). Shown only to a planter
            with a plant, which is exactly who the target screen serves.

            The copy names the exception rather than omitting it. This toggle
            gates what is PUSHED to oversight — the digest and the two gated
            milestones — but NOT "your invitation was accepted", which is
            exempt (ruled 2026-08-01) because it is the inviting org's own
            event. "No updates unless you turn sharing on" was therefore false
            for the one message a planter is most likely to have already
            caused. It is also not "nothing": the oversight dashboard already
            lists the plant with its name, current stage and launch date,
            ungated — see the header of OVERSIGHT_SHARING_TOGGLE. A teaser that
            promises more than the setting delivers is the one way this feature
            can fail its own purpose. */}
        {isPlanterWithPlant && (
          <section aria-labelledby="sharing-link" className="space-y-1">
            <h2
              id="sharing-link"
              className="text-lg font-semibold tracking-tight"
            >
              Sharing
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">
              Apart from being told you accepted their invitation, your sending
              church and network get no updates about this plant unless you turn
              sharing on.{" "}
              <Link
                href="/settings/sharing"
                className="cursor-pointer font-medium underline underline-offset-4"
              >
                Choose what you share
              </Link>
            </p>
          </section>
        )}

        {/* ⚠️ PROTOTYPE — DISPOSABLE (#369) — start. The floating pill that
            switches the four presentations of the ineligible rows. It is
            evaluation scaffolding and never ships as live UI. */}
        {hasPrototypeToOperate && <OversightEligibilityPrototypeSwitcher />}
        {/* ⚠️ PROTOTYPE — DISPOSABLE (#369) — end. */}
      </div>
    </>
  );
}
