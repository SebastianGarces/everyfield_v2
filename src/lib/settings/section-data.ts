import { getChurchPrivacySettings, privacyColumnFor } from "@/lib/auth/access";
import type { PrivacyFeatureKey } from "@/lib/auth/access";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import type { SessionValidationResult } from "@/lib/auth/session";
import { liveEmailChangeRequest } from "@/lib/auth/email-change";
import { isOrgOwner, isPlantOwner, oversightOrgOf } from "@/lib/auth/tenancy";
import { tenancyOf } from "@/lib/auth/tenancy";
import { CHURCH_PROFILE_FIELDS } from "@/lib/churches/profile";
import { formatDate } from "@/lib/datetime";
import { INVITATION_EXPIRY_DAYS } from "@/lib/invitations/core";
import { invitationActorFromSession } from "@/lib/invitations/core";
import { toSeatInvitationListRow } from "@/lib/invitations/list-row";
import { TENANCY_NOUN } from "@/lib/invitations/seat-copy";
import {
  expireLapsedUserInvitations,
  listUserInvitationsFor,
} from "@/lib/invitations/seat";
import { INVITE_ORIGIN_SHARING_CONSENT } from "@/lib/notifications/categories";
import { isAddressSuppressed } from "@/lib/notifications/channels/suppression";
import {
  audienceForTenancy,
  buildPreferenceMatrixView,
  loadUserPreferences,
  preferenceOwnerFromSession,
} from "@/lib/notifications/preferences";
import { accountInitials, userAvatarSrc } from "@/lib/profile-photo";
import {
  listPlantCoaches,
  listSeatRoster,
  seatActorFromSession,
} from "@/lib/seats/roster";
import type {
  SettingsSectionLoad,
  SettingsSectionView,
} from "@/lib/settings/section-view";
import {
  isSettingsSectionId,
  settingsSectionsFor,
  type SettingsSectionId,
} from "@/lib/settings/sections";

import {
  getCurrentAssociations,
  getCurrentNetworkAssociation,
  getPendingInvitationsForPlant,
  getPendingInvitationsForSendingChurch,
  type PendingInvitationView,
} from "@/app/(dashboard)/settings/association/queries";

// ============================================================================
// THE ONE READ BEHIND THE SETTINGS MODAL (#657, ruled 2026-08-22).
//
// Settings is client state over the current screen, so no route renders a
// section and no server component can. This module is what replaced them: the
// browser asks for a section id and gets that section's finished view model
// (`./section-view.ts`) back.
//
// IT IS REACHED THROUGH A ROUTE HANDLER, NOT A SERVER ACTION, and that is a
// correctness requirement rather than a preference — measured on the preview.
// Every server-action response carries a fresh RSC render of the current route,
// which regenerates the `serverRenderId` the modal re-reads on (see
// `settings-modal.tsx`). As an action this read therefore triggered the
// condition it exists to answer: one notification toggle produced an unbounded
// loop at ~7 requests a second. A route handler answers with JSON and re-renders
// nothing, so a write reconciles in exactly one extra read.
//
// SESSION FIRST, THEN THE ID. The id arrives from the browser's address bar, so
// it is untrusted input and is parsed at this boundary; past it every section
// read has a `SettingsSectionId`. The route handler
// (`src/app/api/settings/sections/[section]/route.ts`) refuses a request with no
// session before it reaches this function at all.
//
// IT IS THE GATE, NOT THE NAVIGATION'S COPY OF IT. The layout asks
// `settingsSectionsFor` to decide what the side navigation lists; this asks the
// SAME function again before reading a row, because the list was resolved when
// the page rendered and this call happens whenever the reader asks. A refusal is
// `{ ok: false }` and the modal falls back to the default section — the same
// correction the deleted `/settings/*` routes made with a redirect.
//
// AND IT IS NOT THE REFUSAL THAT MATTERS. Every write behind these controls is
// guarded in its own action (`settings/actions.ts`, `team/actions.ts`,
// `association/actions.ts`, `account/actions.ts`), so a forged POST that never
// called this endpoint meets the same statement the buttons do. What this
// decides is what RENDERS — presentation — which is why the bodies below also
// re-state their own gates rather than trusting this caller.
//
// EVERY DATE LEAVES HERE AS A STRING, formatted against `APP_TIME_ZONE`
// (`memory/invariants.md` → Date & Time Rendering). The section components are
// `"use client"` now, so a `Date` on the wire would be formatted in the
// visitor's zone — the exact hydration mismatch the invariant exists to stop —
// and JSON has no Date at all, so the boundary would hand them a string with no
// meaning rather than fail.
// ============================================================================

export async function loadSettingsSection(
  sectionId: string
): Promise<SettingsSectionLoad> {
  const session = await verifySession();

  if (!isSettingsSectionId(sectionId)) return { ok: false, reason: "refused" };
  if (!settingsSectionsFor(session.user).some((s) => s.id === sectionId)) {
    return { ok: false, reason: "refused" };
  }

  const view = await SECTION_READS[sectionId](session);
  return view ? { ok: true, view } : { ok: false, reason: "refused" };
}

/**
 * One read per section id, as a total map rather than a switch.
 *
 * `Record<SettingsSectionId, …>` is the exhaustiveness check: adding an id to
 * the registry fails the build here until it has something to read, which is the
 * one thing the registry cannot supply for itself. Its twin is `SECTION_BODIES`
 * in `settings-modal.tsx`, which fails for the same reason until it can draw it.
 *
 * `null` means "gated out after all" — the body's own re-stated gate, or a plant
 * that is not there. It reaches the reader as the same `{ ok: false }` a
 * registry refusal does, because the remedy is the same.
 */
const SECTION_READS: Record<
  SettingsSectionId,
  (session: SessionValidationResult) => Promise<SettingsSectionView | null>
> = {
  account: readAccount,
  church: readChurch,
  team: readTeam,
  association: readAssociation,
  notifications: readNotifications,
};

// ----------------------------------------------------------------------------
// Account (CS-001 shell, CS-002 / CS-003 / CS-004)
// ----------------------------------------------------------------------------

/**
 * No gate: every signed-in account may edit its own credentials, including a
 * coach holding no seat in any tenancy — which is exactly `self.write`
 * (`seats: null, tenancy: "any"`), the verb both actions are guarded with.
 *
 * THE LIVE REQUEST IS READ HERE and travels down. It is what "check your inbox"
 * reconciles against after `requestEmailChangeAction` calls `refresh()`.
 */
async function readAccount({
  user,
}: SessionValidationResult): Promise<SettingsSectionView> {
  const pending = await liveEmailChangeRequest(user.id);
  return {
    section: "account",
    name: user.name,
    email: user.email,
    initials: accountInitials(user.name, user.email),
    // A ROUTE, NOT A KEY — the same resolution the dashboard layout does for the
    // sidebar, and for the same reason: every field here is in a payload the
    // browser can read.
    avatarSrc: userAvatarSrc(user.avatarKey) ?? null,
    pendingEmail: pending?.newEmail ?? null,
  };
}

// ----------------------------------------------------------------------------
// Church (CS-006 … CS-012)
// ----------------------------------------------------------------------------

/**
 * TWO GATES, NOT ONE. The section is a plant ADMIN's and above
 * (`church.profile`, widened by #618); the SHARING block stays the OWNER's,
 * because consent to open a plant's records to a sending church is not an
 * operational setting an Admin adjusts (ruling 185 (1) and 185 (9)).
 *
 * The sharing gate asks `sharing.toggle` — THE CAPABILITY ITS OWN WRITE IS
 * REFUSED ON — rather than re-deriving the seat, so the question a control asks
 * before rendering and the question the action asks before writing are one
 * string.
 */
async function readChurch({
  user,
}: SessionValidationResult): Promise<SettingsSectionView | null> {
  if (!holdsSeatFor(user, "church.profile")) return null;

  const church = await getCurrentUserChurch();
  if (!church) return null;

  const mayShare = holdsSeatFor(user, "sharing.toggle");
  // THE GATE'S OWN READER, not a second one: an absent row means every toggle
  // closed, and that is `canAccessFeatureData`'s reading of it. A panel with its
  // own idea of what "no row" means is a panel that can show a switch on while
  // the gate reads it off.
  const privacy = mayShare ? await getChurchPrivacySettings(church.id) : null;
  const isOn = (feature: PrivacyFeatureKey) =>
    privacy?.[privacyColumnFor(feature)] ?? false;

  return {
    section: "church",
    profileFields: CHURCH_PROFILE_FIELDS,
    profile: {
      name: church.name,
      streetAddress: church.streetAddress,
      city: church.city,
      stateRegion: church.stateRegion,
      country: church.country,
    },
    timeZone: church.timeZone,
    digestSendWeekday: church.digestSendWeekday,
    digestSendHour: church.digestSendHour,
    inactivityWarningDays: church.inactivityWarningDays,
    inactivityAlertDays: church.inactivityAlertDays,
    sharing: mayShare
      ? {
          // WRITTEN OUT, NOT DERIVED FROM A KEY LIST. `satisfies` makes this a
          // total map the compiler checks, so an eighth privacy feature fails
          // the build here rather than rendering as a switch that is silently
          // off.
          enabled: {
            people: isOn("people"),
            meetings: isOn("meetings"),
            tasks: isOn("tasks"),
            financials: isOn("financials"),
            ministry_teams: isOn("ministry_teams"),
            facilities: isOn("facilities"),
            oversight_activity: isOn("oversight_activity"),
          } satisfies Record<PrivacyFeatureKey, boolean>,
        }
      : null,
  };
}

// ----------------------------------------------------------------------------
// Team (AS-010, AS-014, AS-015, AS-018)
// ----------------------------------------------------------------------------

/**
 * ONE SURFACE FOR ALL THREE TENANCIES (#500). What differs is the NOUN and the
 * two plant-only blocks; the reads, the guards and the actions are one set.
 *
 * TWO CAPABILITIES ARE ASKED BEYOND THE GATE, and neither is the gate: the gate
 * is `seat.invitation.manage`, while `seat.manage` (Owner-only, AS-015) and
 * `coach.assignment.manage` (an Admin's, AS-018) decide which CONTROLS render.
 *
 * SCOPING IS THE LEAK GUARD: every read below puts the actor's own tenancy in
 * its WHERE, so nothing on this surface names a plant by parameter.
 */
async function readTeam(
  session: SessionValidationResult
): Promise<SettingsSectionView | null> {
  if (!holdsSeatFor(session.user, "seat.invitation.manage")) return null;

  // WHICH TEAM THIS IS. `seat.invitation.manage` is `tenancy: "tenancy"`, so
  // every account past the gate names exactly one — read rather than asserted,
  // because the same resolution is what scopes every query below.
  const tenancy = tenancyOf(session.user);
  if (!tenancy) return null;

  const isPlant = tenancy.type === "church";
  const actor = invitationActorFromSession(session);

  // LAZY EXPIRY, and it is idempotent: it only moves `pending` rows whose window
  // has closed, so a second look changes nothing the first did. Without it a
  // lapsed invitation keeps its Resend and Revoke controls — offering an action
  // whose own guard is guaranteed to refuse it.
  await expireLapsedUserInvitations(actor);

  // PARTITIONED BY KIND, NOT MIXED (#496). An Admin reading one list of pending
  // addresses could not tell which was being offered a seat and which a coaching
  // assignment, and `InvitationListRow` deliberately carries no `kind`.
  const invitations = await listUserInvitationsFor(actor);

  const seatActor = seatActorFromSession(session);
  const [roster, coaches] = await Promise.all([
    listSeatRoster(seatActor),
    // NOT CALLED FOR AN ORG. `listPlantCoaches` throws for a tenancy that is not
    // a plant, deliberately — a coach list scoped by a network's id against
    // `coach_assignments.church_id` would read as an answer and be none.
    isPlant ? listPlantCoaches(seatActor) : Promise.resolve([]),
  ]);

  return {
    section: "team",
    tenancyType: tenancy.type,
    noun: TENANCY_NOUN[tenancy.type],
    isPlant,
    expiryDays: INVITATION_EXPIRY_DAYS,
    canManageSeats: holdsSeatFor(session.user, "seat.manage"),
    // `coach.assignment.manage` is `tenancy: "plant"`, so this reads false for
    // an org account — which is why the coach blocks key off `isPlant` and never
    // off this flag alone.
    canEndAssignments: holdsSeatFor(session.user, "coach.assignment.manage"),
    roster: roster.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      seat: row.seat,
      joinedLabel: formatDate(row.joinedAt, "short"),
      isSelf: row.userId === session.user.id,
    })),
    coaches: coaches.map((row) => ({
      assignmentId: row.assignmentId,
      name: row.name,
      email: row.email,
      assignedLabel: formatDate(row.assignedAt, "short"),
    })),
    seatInvitations: invitations
      .filter((row) => row.kind === "seat")
      .map(toSeatInvitationListRow),
    coachInvitations: invitations
      .filter((row) => row.kind === "coach")
      .map(toSeatInvitationListRow),
  };
}

// ----------------------------------------------------------------------------
// Association (OV-004, OV-006, OV-007a, OV-013)
// ----------------------------------------------------------------------------

/**
 * TWO ROLES, ONE SURFACE (#304 WS3, ruled 2026-08-09) — a planter answering for
 * their plant, a sending church Owner answering for their org. Whoever can act
 * on neither gets `null`, because there would be nothing on the screen for them;
 * every write behind it refuses them again server-side regardless.
 */
async function readAssociation({
  user,
}: SessionValidationResult): Promise<SettingsSectionView | null> {
  if (isPlantOwner(user) && user.churchId) {
    const [pending, associations] = await Promise.all([
      getPendingInvitationsForPlant(user.churchId),
      getCurrentAssociations(user.churchId),
    ]);
    return {
      section: "association",
      answerer: "plant",
      pending: pending.map(toPendingInvitationRow),
      associations,
      // ONLY WHERE THE COPY IS TRUE. It says accepting "starts you off sharing",
      // and the write behind it fires only for a plant whose two oversight FKs
      // are still null. Same condition, stated where the reader is;
      // `associations` is already loaded, so this costs no query.
      consent: associations.length === 0 ? INVITE_ORIGIN_SHARING_CONSENT : null,
    };
  }

  // BOTH HALVES (#500). An org has Members now, and every write on this surface
  // is Owner-only by ruling 185 (1), so the tenancy alone would render three
  // controls whose own guards are guaranteed to refuse the reader.
  const org = oversightOrgOf(user);
  if (org?.type === "sending_church" && isOrgOwner(user)) {
    const [pending, network] = await Promise.all([
      getPendingInvitationsForSendingChurch(org.id),
      getCurrentNetworkAssociation(org.id),
    ]);
    return {
      section: "association",
      answerer: "sending_church",
      pending: pending.map(toPendingInvitationRow),
      network,
    };
  }

  return null;
}

function toPendingInvitationRow(invitation: PendingInvitationView) {
  return {
    id: invitation.id,
    orgName: invitation.orgName,
    orgType: invitation.orgType,
    sentLabel: formatDate(invitation.createdAt, "short"),
    expiresLabel: invitation.expiresAt
      ? formatDate(invitation.expiresAt, "short")
      : null,
  };
}

// ----------------------------------------------------------------------------
// Notifications (N-006, N-027, #324)
// ----------------------------------------------------------------------------

/**
 * Preferences are per USER, not per church (a coach across two plants keeps one
 * set of choices), so this read takes no tenancy scope. The owner is minted from
 * the session and is the only thing the reads and writes will accept.
 */
async function readNotifications(
  session: SessionValidationResult
): Promise<SettingsSectionView> {
  const owner = preferenceOwnerFromSession(session);

  // Resolved against the SAME audience the feed, the badge and the dispatcher
  // resolve against, or an absent row renders as one value here and behaves as
  // another there (N-027).
  const matrix = buildPreferenceMatrixView(
    await loadUserPreferences(owner),
    audienceForTenancy(session.user)
  );

  // #324. Asked for the SESSION'S OWN address and nowhere else. Absent a
  // suppression the read returns false, so the ordinary case costs one bounded
  // query and shows no notice.
  const suppressed = await isAddressSuppressed(session.user.email);

  return {
    section: "notifications",
    matrix,
    suppressedEmail: suppressed ? session.user.email : null,
  };
}
