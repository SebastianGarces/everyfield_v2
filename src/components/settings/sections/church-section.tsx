import Link from "next/link";

import { ChurchDigestScheduleSelect } from "@/components/settings/church-digest-schedule-select";
import { ChurchInactivityThresholds } from "@/components/settings/church-inactivity-thresholds";
import { ChurchProfileFields } from "@/components/settings/church-profile-fields";
import { ChurchTimeZoneSelect } from "@/components/settings/church-time-zone-select";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { isPlantOwner } from "@/lib/auth/tenancy";
import { CHURCH_PROFILE_FIELDS } from "@/lib/churches/profile";
import { OVERSIGHT_SHARING_TEASER } from "@/lib/notifications/categories";

// ============================================================================
// Church — the plant's own profile, its clocks, and what it shares.
//
// Three blocks, and they are in the order a planter would ask them in: WHAT AND
// WHERE this plant is (CS-006), WHEN its dates, digest and quiet-contact
// thresholds are read (CS-007/008/009), and WHO ELSE sees any of it (CS-011,
// still a link).
//
// The zone and digest controls were moved here whole by #615 and are unchanged
// again: same components, same actions, same order, and the digest select still
// sits directly under the zone because it is READ on that clock ("4:00 PM" means
// nothing until you know whose afternoon it is).
//
// ----------------------------------------------------------------------------
// TWO GATES, NOT ONE, AND THAT IS THE POINT OF THIS SECTION NOW
// ----------------------------------------------------------------------------
//
// The registry admits a plant ADMIN and above (`church.profile`, widened here
// from the Owner-only gate the old index block had — see `sections.ts`). The
// SHARING teaser stays the OWNER's, because consent to send a plant's activity
// to a sending church is not an operational setting an Admin adjusts; it is the
// same decision `/settings/sharing` itself has always been Owner-only for
// (`isPlanterWithPlant` in the registry gates that section too).
//
// So an Admin opening Church sees the profile, the clocks and the thresholds
// and no sharing paragraph at all — not a disabled one. A control beside an
// action guaranteed to refuse it is the visible half of a permission drift, and
// a promise about privacy the reader cannot act on is worse than absent.
//
// THE TEASER IS A LINK, NOT AN INLINED SWITCH, and its sentence is
// `OVERSIGHT_SHARING_TEASER` rendered unchanged — never a sibling sentence
// written here. `oversight.test.ts` holds every consent surface in
// `OVERSIGHT_CONSENT_SURFACES` to the exempt list, and a page that writes the
// promise itself is invisible to that guard: that is exactly how `/settings`
// went stale for two rulings, telling a planter their DECLINE and their
// DEPARTURE were covered by a switch that has never gated either.
//
// NOTHING HERE READS OR WRITES LAUNCH SUNDAY (CS-014). `launches` is its only
// owner since migration 0032 dropped `churches.launch_date`, and a second edit
// surface for a date one entity owns is what makes two screens disagree. The
// link below is the whole of this section's relationship with it.
// ============================================================================

export async function ChurchSection() {
  // The body re-states its own gate rather than trusting the registry
  // (`settings-surface.tsx` says why). A null church here would be an account
  // with no plant, which `church.profile`'s `tenancy: "plant"` already refused.
  const { user } = await verifySession();
  if (!holdsSeatFor(user, "church.profile")) return null;

  const church = await getCurrentUserChurch();
  if (!church) return null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="church-profile" className="space-y-4">
        <h2
          id="church-profile"
          className="text-lg font-semibold tracking-tight"
        >
          Profile
        </h2>
        {/* The field list travels as a PROP so the client bundle never imports
            the module that owns it — and so there is exactly one list, not a
            server copy and a browser copy. */}
        <ChurchProfileFields
          fields={CHURCH_PROFILE_FIELDS}
          values={{
            name: church.name,
            streetAddress: church.streetAddress,
            city: church.city,
            stateRegion: church.stateRegion,
            country: church.country,
          }}
        />
      </section>

      <section aria-labelledby="church-clock" className="space-y-4">
        <h2 id="church-clock" className="text-lg font-semibold tracking-tight">
          Dates and times
        </h2>
        <ChurchTimeZoneSelect timeZone={church.timeZone} />
        <ChurchDigestScheduleSelect
          weekday={church.digestSendWeekday}
          hour={church.digestSendHour}
          timeZone={church.timeZone}
        />
        <ChurchInactivityThresholds
          warningDays={church.inactivityWarningDays}
          alertDays={church.inactivityAlertDays}
        />
      </section>

      {isPlantOwner(user) ? (
        <section aria-labelledby="church-sharing" className="space-y-1">
          <h2
            id="church-sharing"
            className="text-lg font-semibold tracking-tight"
          >
            Sharing
          </h2>
          <p className="text-muted-foreground text-sm text-pretty">
            {OVERSIGHT_SHARING_TEASER}{" "}
            {/* A PLAIN PUSH, never `replace`. The modal owns the history policy
                for the section navigation it draws; a section body spelling its
                own gets it wrong, because it cannot see whether anything is
                behind the modal. `replace` here overwrote the only entry a
                cold-loaded reader had, and Close — a `back()` into an empty
                stack — then did nothing at all, leaving them shut inside the
                modal. */}
            <Link
              href="/settings/sharing"
              className="cursor-pointer font-medium underline underline-offset-4"
            >
              Choose what you share
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
