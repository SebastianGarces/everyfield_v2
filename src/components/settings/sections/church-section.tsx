import { ChurchDigestScheduleSelect } from "@/components/settings/church-digest-schedule-select";
import { ChurchInactivityThresholds } from "@/components/settings/church-inactivity-thresholds";
import { ChurchProfileFields } from "@/components/settings/church-profile-fields";
import { ChurchTimeZoneSelect } from "@/components/settings/church-time-zone-select";
import { SharingSwitch } from "@/components/settings/sharing-panel";
import { getChurchPrivacySettings, privacyColumnFor } from "@/lib/auth/access";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { CHURCH_PROFILE_FIELDS } from "@/lib/churches/profile";
import {
  OVERSIGHT_SHARING_FEATURE,
  OVERSIGHT_SHARING_TOGGLE,
} from "@/lib/notifications/categories";
import {
  SHARING_PANEL_INTRO,
  SHARING_PULL_TOGGLES,
} from "@/lib/sharing/toggles";

// ============================================================================
// Church — the plant's own profile, its clocks, and what it shares.
//
// Three blocks, in the order a planter would ask them in: WHAT AND WHERE this
// plant is (CS-006), WHEN its dates, digest and quiet-contact thresholds are
// read (CS-007/008/009), and WHO ELSE sees any of it (CS-010/011/012).
//
// The zone and digest controls were moved here whole by #615 and are unchanged
// again: same components, same actions, same order, and the digest select still
// sits directly under the zone because it is READ on that clock ("4:00 PM" means
// nothing until you know whose afternoon it is).
//
// ----------------------------------------------------------------------------
// TWO GATES, NOT ONE, AND #619 IS WHY THE SECOND ONE HAD TO BE EXACT
// ----------------------------------------------------------------------------
//
// The registry admits a plant ADMIN and above (`church.profile`, widened by
// #618 from the Owner-only gate the old index block had). The SHARING block
// stays the OWNER's, because consent to open a plant's records to a sending
// church is not an operational setting an Admin adjusts (ruling 185 (1); 185 (9)
// rules this exact split — "the church profile opens to plant Admins, while the
// sharing panel stays Owner-only").
//
// So the panel asks `sharing.toggle` — THE CAPABILITY ITS OWN WRITE IS REFUSED
// ON — rather than re-deriving the seat. While this was a teaser it could ask
// `isPlantOwner` and mean the same thing; now that it is seven live controls,
// the question a control asks before rendering and the question the action asks
// before writing must be the same string, or the panel renders a switch
// guaranteed to refuse its reader.
//
// An Admin opening Church sees the profile, the clocks and the thresholds and no
// sharing block at all — ABSENT, not disabled (ruling 185 (7)). A disabled
// switch beside consent copy reads as "we decided this for you", which is the
// opposite of what the panel is for.
//
// ----------------------------------------------------------------------------
// THE SHARING PANEL (CS-010/011/012, #619)
// ----------------------------------------------------------------------------
//
// It ABSORBED `/settings/sharing`, which is deleted — route, registry entry,
// section component and all. Until this issue the panel was a sibling surface
// reached by a teaser sentence, and that teaser is exactly the copy that went
// stale for two rulings while the panel's own copy was being corrected. One
// surface cannot fall behind itself.
//
// SIX PULL ROWS THAT HAD NO EDIT UI ANYWHERE. The `share_*` columns have gated
// the oversight dashboard since migration 0029; a planter could not see them,
// let alone change them — which is also what made CS-013's "accepting starts you
// off sharing" land with no way to walk it back per part. The seventh row is the
// activity push toggle, moved here whole.
//
// THE CONSENT COPY IS `categories.ts`'s AND `@/lib/sharing/toggles`'s, rendered
// unchanged — never a sibling sentence written here. `oversight.test.ts` holds
// every surface in `OVERSIGHT_CONSENT_SURFACES` to the exempt list, and a page
// that writes the promise itself is invisible to that guard.
//
// NOTHING HERE READS OR WRITES LAUNCH SUNDAY (CS-014). `launches` is its only
// owner since migration 0032 dropped `churches.launch_date`, and a second edit
// surface for a date one entity owns is what makes two screens disagree.
// ============================================================================

export async function ChurchSection() {
  // The body re-states its own gate rather than trusting the registry
  // (`settings-surface.tsx` says why). A null church here would be an account
  // with no plant, which `church.profile`'s `tenancy: "plant"` already refused.
  const { user } = await verifySession();
  if (!holdsSeatFor(user, "church.profile")) return null;

  const church = await getCurrentUserChurch();
  if (!church) return null;

  const mayShare = holdsSeatFor(user, "sharing.toggle");

  // The gate's OWN reader, not a second one: an absent row means every toggle
  // closed, and that is `canAccessFeatureData`'s reading of it. A panel with its
  // own idea of what "no row" means is a panel that can show a switch on while
  // the gate reads it off — and since CS-013 writes every toggle ON at an
  // invited plant's acceptance, this is also the only thing that tells the two
  // origins apart on screen.
  const privacy = mayShare ? await getChurchPrivacySettings(church.id) : null;
  const isOn = (feature: Parameters<typeof privacyColumnFor>[0]) =>
    privacy?.[privacyColumnFor(feature)] ?? false;

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

      {mayShare ? (
        <section
          aria-labelledby="church-sharing"
          data-testid="sharing-panel"
          className="space-y-6"
        >
          <div className="space-y-1">
            <h2
              id="church-sharing"
              className="text-lg font-semibold tracking-tight"
            >
              Sharing
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">
              {SHARING_PANEL_INTRO}
            </p>
          </div>

          {/* `role="group"` so the heading is what a screen reader announces
              the switches under — without it "People, switch, off" loses the
              verb that makes "People" mean anything. Same shape as
              `preference-matrix.tsx`. */}
          <div
            role="group"
            aria-labelledby="sharing-pull-heading"
            className="space-y-3"
          >
            <h3
              id="sharing-pull-heading"
              className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
            >
              What your sending church or network can look up
            </h3>
            {SHARING_PULL_TOGGLES.map((toggle) => (
              <SharingSwitch
                key={toggle.feature}
                feature={toggle.feature}
                enabled={isOn(toggle.feature)}
                label={toggle.label}
                summary={toggle.summary}
              />
            ))}
          </div>

          <div
            role="group"
            aria-labelledby="sharing-push-heading"
            className="space-y-3"
          >
            <h3
              id="sharing-push-heading"
              className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
            >
              Updates they receive
            </h3>
            <SharingSwitch
              feature={OVERSIGHT_SHARING_FEATURE}
              enabled={isOn(OVERSIGHT_SHARING_FEATURE)}
              label={OVERSIGHT_SHARING_TOGGLE.label}
              summary={OVERSIGHT_SHARING_TOGGLE.summary}
              detail={OVERSIGHT_SHARING_TOGGLE.detail}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
