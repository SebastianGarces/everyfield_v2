import Link from "next/link";

import { ChurchDigestScheduleSelect } from "@/components/settings/church-digest-schedule-select";
import { ChurchTimeZoneSelect } from "@/components/settings/church-time-zone-select";
import { getCurrentUserChurch } from "@/lib/auth/session";
import { OVERSIGHT_SHARING_TEASER } from "@/lib/notifications/categories";

// ============================================================================
// Church — the timezone and the digest schedule, MOVED WHOLE (#615, from #187).
//
// These two controls lived under a "Church" heading on the old `/settings`
// index, which carried the forward reference this change is redeeming: "#187
// will own the broader church settings page and absorbs this section whole
// rather than reconciling a second church-settings surface." Nothing about
// either control changed — same components, same actions, same order, and the
// digest select still sits directly under the zone because it is READ on that
// clock ("4:00 PM" means nothing until you know whose afternoon it is).
//
// The church profile fields CS-006 names (name, city, address) are that issue's;
// this section is the shell they land in.
//
// THE SHARING TEASER IS A LINK, NOT AN INLINED SWITCH, and its sentence is
// `OVERSIGHT_SHARING_TEASER` rendered unchanged — never a sibling sentence
// written here. `oversight.test.ts` holds every consent surface in
// `OVERSIGHT_CONSENT_SURFACES` to the exempt list, and a page that writes the
// promise itself is invisible to that guard: that is exactly how `/settings`
// went stale for two rulings, telling a planter their DECLINE and their
// DEPARTURE were covered by a switch that has never gated either.
// ============================================================================

export async function ChurchSection() {
  // Safe to read unguarded: the registry gates this section on
  // `isPlanterWithPlant`, and `settings-surface.tsx` refuses the section before
  // it renders for anyone else. A null here would be an account with no plant,
  // which that gate has already turned away.
  const church = await getCurrentUserChurch();
  if (!church) return null;

  return (
    <div className="space-y-8">
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
      </section>

      <section aria-labelledby="church-sharing" className="space-y-1">
        <h2
          id="church-sharing"
          className="text-lg font-semibold tracking-tight"
        >
          Sharing
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {OVERSIGHT_SHARING_TEASER}{" "}
          <Link
            href="/settings/sharing"
            replace
            className="cursor-pointer font-medium underline underline-offset-4"
          >
            Choose what you share
          </Link>
        </p>
      </section>
    </div>
  );
}
