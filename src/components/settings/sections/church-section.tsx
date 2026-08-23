"use client";

import { ChurchDigestScheduleSelect } from "@/components/settings/church-digest-schedule-select";
import { ChurchInactivityThresholds } from "@/components/settings/church-inactivity-thresholds";
import { ChurchProfileFields } from "@/components/settings/church-profile-fields";
import { ChurchTimeZoneSelect } from "@/components/settings/church-time-zone-select";
import {
  SettingsBlock,
  SettingsHeading,
} from "@/components/settings/settings-block";
import { SharingSwitch } from "@/components/settings/sharing-panel";
import {
  OVERSIGHT_SHARING_FEATURE,
  OVERSIGHT_SHARING_TOGGLE,
} from "@/lib/notifications/categories";
import type { ChurchSectionView } from "@/lib/settings/section-view";
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
// The zone and digest controls were moved here whole by #615 — same components,
// same actions, same order, and the digest select still sits directly under the
// zone because it is READ on that clock ("4:00 PM" means nothing until you know
// whose afternoon it is). What the 2026-08-23 review changed is only their
// CONTAINER: the three clock controls share one `SettingsBlock` instead of
// drawing a border each.
//
// ----------------------------------------------------------------------------
// TWO GATES, NOT ONE, AND THE SECOND ONE IS NOW A SHAPE
// ----------------------------------------------------------------------------
//
// The registry admits a plant ADMIN and above (`church.profile`, widened by
// #618 from the Owner-only gate the old index block had). The SHARING block
// stays the OWNER's, because consent to open a plant's records to a sending
// church is not an operational setting an Admin adjusts (ruling 185 (1); 185 (9)
// rules this exact split — "the church profile opens to plant Admins, while the
// sharing panel stays Owner-only").
//
// `readChurch` asks `sharing.toggle` — THE CAPABILITY THE PANEL'S OWN WRITE IS
// REFUSED ON — and an Admin's view arrives with `sharing: null`. So the split is
// not a condition this file evaluates: there is no shape reaching this component
// that carries toggle state an Admin could be shown. ABSENT, NOT DISABLED
// (ruling 185 (7)) — a disabled switch beside consent copy reads as "we decided
// this for you", which is the opposite of what the panel is for.
//
// ----------------------------------------------------------------------------
// THE SHARING PANEL (CS-010/011/012, #619)
// ----------------------------------------------------------------------------
//
// It ABSORBED `/settings/sharing`, which is deleted — route, registry entry,
// section component and all. Until #619 the panel was a sibling surface reached
// by a teaser sentence, and that teaser is exactly the copy that went stale for
// two rulings while the panel's own copy was being corrected. One surface cannot
// fall behind itself.
//
// THE CONSENT COPY IS `categories.ts`'s AND `@/lib/sharing/toggles`'s, rendered
// unchanged — never a sibling sentence written here. `oversight.test.ts` holds
// every surface in `OVERSIGHT_CONSENT_SURFACES` to the exempt list, and a page
// that writes the promise itself is invisible to that guard.
//
// NOTHING HERE READS OR WRITES LAUNCH SUNDAY (CS-014). `launches` is its only
// owner since migration 0032 dropped `churches.launch_date`, and a second edit
// surface for a date one entity owns is what makes two screens disagree.
//
// THE FIELD LIST ARRIVES AS DATA (#657). `@/lib/churches/profile` owns it
// alongside the zod schemas that guard the writes, so importing it here would
// pull those into the dashboard's client bundle — the same reason it travelled
// as a prop while this was a server component.
// ============================================================================

export function ChurchSection({ view }: { view: ChurchSectionView }) {
  const sharing = view.sharing;

  return (
    <div className="space-y-8">
      <section aria-labelledby="church-profile" className="space-y-4">
        <SettingsHeading id="church-profile">Profile</SettingsHeading>
        <ChurchProfileFields
          fields={view.profileFields}
          values={view.profile}
        />
      </section>

      {/* ONE BLOCK FOR THE THREE CLOCKS, not three boxes. The digest schedule
          only means anything read on the zone above it ("4:00 PM" needs whose
          afternoon it is), and three borders 16px apart drew a stronger break
          between the controls than the 16px of padding inside each — so the eye
          read three unrelated settings rather than one clock. They separate on
          rhythm inside one surface instead. */}
      <section aria-labelledby="church-clock" className="space-y-4">
        <SettingsHeading id="church-clock">Dates and times</SettingsHeading>
        <SettingsBlock className="gap-6">
          <ChurchTimeZoneSelect timeZone={view.timeZone} />
          <ChurchDigestScheduleSelect
            weekday={view.digestSendWeekday}
            hour={view.digestSendHour}
            timeZone={view.timeZone}
          />
          <ChurchInactivityThresholds
            warningDays={view.inactivityWarningDays}
            alertDays={view.inactivityAlertDays}
          />
        </SettingsBlock>
      </section>

      {sharing ? (
        <section
          aria-labelledby="church-sharing"
          data-testid="sharing-panel"
          className="space-y-6"
        >
          <SettingsHeading
            id="church-sharing"
            description={SHARING_PANEL_INTRO}
          >
            Sharing
          </SettingsHeading>

          {/* `role="group"` so the heading is what a screen reader announces
              the switches under — without it "People, switch, off" loses the
              verb that makes "People" mean anything. Same shape as
              `preference-matrix.tsx`.

              THE GROUP HEADING IS THE SAME 14px AS THE SWITCH LABELS IT HEADS,
              never the smaller uppercase token it used to be: a heading lighter
              and shorter than its own contents inverts the rank it is there to
              state. */}
          <div
            role="group"
            aria-labelledby="sharing-pull-heading"
            className="space-y-3"
          >
            <h3 id="sharing-pull-heading" className="text-sm font-medium">
              What your sending church or network can look up
            </h3>
            {SHARING_PULL_TOGGLES.map((toggle) => (
              <SharingSwitch
                key={toggle.feature}
                feature={toggle.feature}
                enabled={sharing.enabled[toggle.feature]}
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
            <h3 id="sharing-push-heading" className="text-sm font-medium">
              Updates they receive
            </h3>
            <SharingSwitch
              feature={OVERSIGHT_SHARING_FEATURE}
              enabled={sharing.enabled[OVERSIGHT_SHARING_FEATURE]}
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
