import { redirect } from "next/navigation";

import { OversightSharingSwitch } from "@/components/settings/oversight-sharing-switch";
import { verifySession } from "@/lib/auth/session";
import { isPlantOwner } from "@/lib/auth/tenancy";
import { OVERSIGHT_SHARING_TOGGLE } from "@/lib/notifications/categories";
import { isSharingActivityWithOversight } from "@/lib/notifications/oversight-sharing";

// ============================================================================
// Sharing — the one plant-side control over what oversight is told (N-026).
//
// A SECTION OF THE SETTINGS MODAL SINCE #615, at its unchanged URL
// `/settings/sharing`, and ABSENT FROM THE SIDE NAVIGATION (`inNav: false` in
// `@/lib/settings/sections`). The ruled section list names five; CS-011 folds
// this panel into the Church section, and until it does this entry is what keeps
// a URL that lives in `OVERSIGHT_CONSENT_SURFACES` and in sent email working.
// The Church section draws the link to it.
//
// Why it is a registry entry rather than the sibling route it used to be: the
// modal intercepts every `/settings/*` path, so a path the registry did not know
// about would have opened as a 404 inside the modal.
//
// The copy comes from `OVERSIGHT_SHARING_TOGGLE`, which sits beside the gate it
// describes, so what this surface promises and what `enqueue` enforces cannot
// drift apart.
// ============================================================================

export async function SharingSection() {
  const { user } = await verifySession();

  // Not an authorisation subtlety: nobody else has a plant whose sharing this
  // section could be about. A coach or an oversight account landing here would
  // be shown a switch with no subject. The registry asks the same question, so
  // this is the surface re-stating its own gate rather than trusting a caller.
  if (!isPlantOwner(user) || !user.churchId) {
    redirect("/settings");
  }

  const enabled = await isSharingActivityWithOversight(user.churchId);

  return (
    <section aria-labelledby="oversight-sharing-heading" className="space-y-4">
      <h2
        id="oversight-sharing-heading"
        className="text-lg font-semibold tracking-tight"
      >
        Your sending church and network
      </h2>
      <p className="text-muted-foreground text-sm">
        Off unless you turn it on. Changes take effect at the next update.
      </p>

      <OversightSharingSwitch
        enabled={enabled}
        label={OVERSIGHT_SHARING_TOGGLE.label}
        summary={OVERSIGHT_SHARING_TOGGLE.summary}
        detail={OVERSIGHT_SHARING_TOGGLE.detail}
      />
    </section>
  );
}
