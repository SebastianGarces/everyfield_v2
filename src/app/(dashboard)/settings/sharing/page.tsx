import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { OversightSharingSwitch } from "@/components/settings/oversight-sharing-switch";
import { verifySession } from "@/lib/auth/session";
import { isPlantOwner } from "@/lib/auth/tenancy";
import { OVERSIGHT_SHARING_TOGGLE } from "@/lib/notifications/categories";
import { isSharingActivityWithOversight } from "@/lib/notifications/oversight-sharing";

// ============================================================================
// Sharing — the one plant-side control over what oversight is told (N-026).
//
// Its own screen, not a section of `/settings`. `/settings` is about how
// EveryField reaches YOU and is per user; this is about what leaves your plant
// and is per church, planter-only. Putting a church-wide consent decision in a
// list of personal notification preferences would make it look like one more
// switch about email volume, which is the one thing it must not look like.
//
// The copy comes from `OVERSIGHT_SHARING_TOGGLE`, which sits beside the gate it
// describes, so what this page promises and what `enqueue` enforces cannot
// drift apart.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sharing",
};

export default async function SharingSettingsPage() {
  const { user } = await verifySession();

  // Not an authorisation subtlety: nobody else has a plant whose sharing this
  // page could be about. A coach or an oversight account landing here would be
  // shown a switch with no subject.
  if (!isPlantOwner(user) || !user.churchId) {
    redirect("/settings");
  }

  const enabled = await isSharingActivityWithOversight(user.churchId);

  return (
    <>
      <HeaderBreadcrumbs
        items={[{ label: "Settings", href: "/settings" }, { label: "Sharing" }]}
      />

      <div className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sharing</h1>
          <p className="text-muted-foreground text-sm">
            What your sending church or network hears about this plant.
          </p>
        </div>

        <section
          aria-labelledby="oversight-sharing-heading"
          className="space-y-4"
        >
          <div className="space-y-1">
            <h2
              id="oversight-sharing-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Your sending church and network
            </h2>
            <p className="text-muted-foreground text-sm">
              Off unless you turn it on. Changes take effect at the next update.
            </p>
          </div>

          <OversightSharingSwitch
            enabled={enabled}
            label={OVERSIGHT_SHARING_TOGGLE.label}
            summary={OVERSIGHT_SHARING_TOGGLE.summary}
            detail={OVERSIGHT_SHARING_TOGGLE.detail}
          />
        </section>
      </div>
    </>
  );
}
