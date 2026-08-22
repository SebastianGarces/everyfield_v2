import type {
  ChurchProfileField,
  ChurchProfileFieldSpec,
} from "@/lib/churches/profile";
import type { SeatTenancyType } from "@/lib/auth/tenancy";
import type { PrivacyFeatureKey } from "@/lib/auth/access";
import type { AssociationOrgType } from "@/db/schema";
import type { PlantCoachViewRow } from "@/components/settings/plant-coach-list";
import type { SeatRosterViewRow } from "@/components/settings/seat-roster";
import type { InvitationListRow } from "@/lib/invitations/list-row";
import type { PreferenceMatrixView } from "@/lib/notifications/preferences";
import type { SettingsSectionId } from "@/lib/settings/sections";

// ============================================================================
// WHAT A SETTINGS SECTION IS, ONCE IT REACHES THE BROWSER (#657).
//
// Every section body is a CLIENT component now, because the modal is client
// state over the current screen and no route renders it (ruled 2026-08-22; the
// PR body carries the measurement that closed the alternative). So each one
// needs its reads done for it, and this file is the shape they arrive in.
//
// IT IS A VIEW MODEL, NOT A ROW. Nothing below is a database shape: dates are
// already strings formatted against `APP_TIME_ZONE` (`memory/invariants.md` →
// Date & Time Rendering — a `Date` formatted in the visitor's zone is a
// hydration mismatch), capability answers are already booleans, and copy that
// lives in a server-only module is already resolved. A section component's only
// job is to draw what is here.
//
// THIS FILE IS THE BOUNDARY (principle: boundary-discipline). `section-data.ts`
// is the one place that turns a session and a set of rows into one of these;
// past it, the client trusts the type and re-validates nothing. The refusal that
// matters is still the server action's, on every write.
//
// ONE TAGGED VARIANT PER SECTION ID, so `SECTION_BODIES` in the modal and
// `SECTION_READS` in the loader are both total maps over `SettingsSectionId` and
// the build names every file a new section needs.
// ============================================================================

export type SettingsSectionView =
  | AccountSectionView
  | ChurchSectionView
  | TeamSectionView
  | AssociationSectionView
  | NotificationsSectionView;

/** The view for one section id — what that section's component takes. */
export type SettingsSectionViewOf<Id extends SettingsSectionId> = Extract<
  SettingsSectionView,
  { section: Id }
>;

/**
 * What the read endpoint answers.
 *
 * THE REFUSAL CARRIES A REASON, because the three ways to fail have nothing in
 * common but their shape:
 *
 *   - `refused` — a section the registry does not list for this account, a body
 *     whose own re-stated gate says no, or a plant that is not there. The remedy
 *     is the section every account can open, and the modal corrects the fragment
 *     to it exactly as the deleted routes corrected the address bar with a
 *     redirect. This is the only reason the SERVER ever sends.
 *   - `unauthorized` — the session ended. The remedy is `/login`, which is what
 *     the rest of the product does.
 *   - `failed` — the read did not come back. The remedy is to say so and offer
 *     a retry.
 *
 * They were one value at first, and the collapse had a silent worst case: a 401
 * read as a refusal bounced to the default section, whose read had already
 * failed and was cached, leaving a skeleton that never resolved.
 */
export type SettingsSectionLoad =
  | { ok: true; view: SettingsSectionView }
  | { ok: false; reason: "refused" | "unauthorized" | "failed" };

// ----------------------------------------------------------------------------
// Account (CS-001 shell, CS-002 / CS-003 / CS-004)
// ----------------------------------------------------------------------------

export type AccountSectionView = {
  section: "account";
  name: string | null;
  email: string;
  initials: string;
  /**
   * The ROUTE this account's picture is served from, or `null` for an account
   * with none. Never the storage key — resolved here for the same reason the
   * dashboard layout resolves the sidebar's.
   */
  avatarSrc: string | null;
  /** The address a live change request is waiting on, or `null`. */
  pendingEmail: string | null;
};

// ----------------------------------------------------------------------------
// Church (CS-006 … CS-012)
// ----------------------------------------------------------------------------

export type ChurchSectionView = {
  section: "church";
  /**
   * The profile field list, carried rather than imported.
   *
   * `@/lib/churches/profile` owns it together with the zod schemas that guard
   * the writes, and a client component importing the list would pull those into
   * the dashboard's bundle. One list, on the wire.
   */
  profileFields: readonly (ChurchProfileFieldSpec & {
    id: ChurchProfileField;
  })[];
  /**
   * The stored values, as a total `Record` over the field ids — the last link in
   * the chain that makes "a new field is one schema arm and then whatever stops
   * compiling" true (see `@/lib/churches/profile`).
   */
  profile: Readonly<Record<ChurchProfileField, string | null>>;
  timeZone: string;
  digestSendWeekday: number;
  digestSendHour: number;
  inactivityWarningDays: number;
  inactivityAlertDays: number;
  /**
   * The sharing block, or `null` for a reader who may not consent.
   *
   * ABSENT, NOT DISABLED (ruling 185 (7)) — a plant Admin sees the profile, the
   * clocks and the thresholds and no sharing block at all. `null` is what makes
   * that unrepresentable as "present but off": there is no shape here that
   * renders a switch an Admin could look at.
   */
  sharing: { enabled: Readonly<Record<PrivacyFeatureKey, boolean>> } | null;
};

// ----------------------------------------------------------------------------
// Team (AS-010, AS-014, AS-015, AS-018)
// ----------------------------------------------------------------------------

export type TeamSectionView = {
  section: "team";
  tenancyType: SeatTenancyType;
  /** What this tenancy is called in a sentence — "plant", "sending church". */
  noun: string;
  /** Coaching is a plant's alone, so two blocks below key off this. */
  isPlant: boolean;
  expiryDays: number;
  canManageSeats: boolean;
  canEndAssignments: boolean;
  /**
   * The roster and coach rows are the COMPONENTS' OWN row types, imported rather
   * than restated. A parallel shape here would be a second place to add a
   * column, and the first thing to drift is the one that carries a seat.
   */
  roster: SeatRosterViewRow[];
  coaches: PlantCoachViewRow[];
  seatInvitations: InvitationListRow[];
  coachInvitations: InvitationListRow[];
};

// ----------------------------------------------------------------------------
// Association (OV-004, OV-006, OV-007a, OV-013)
// ----------------------------------------------------------------------------

/** One pending invitation, with both of its dates already read on our clock. */
export type PendingInvitationRow = {
  id: string;
  orgName: string;
  orgType: AssociationOrgType;
  sentLabel: string;
  expiresLabel: string | null;
};

export type CurrentAssociationRow = {
  orgType: AssociationOrgType;
  orgId: string;
  orgName: string;
};

/**
 * TWO ROLES, ONE SURFACE (#304 WS3) — and the two are a union, not two nullable
 * halves. A planter has associations and no network field; a sending church
 * Owner has one network and no list. Neither can be handed the other's shape.
 */
export type AssociationSectionView = {
  section: "association";
  pending: readonly PendingInvitationRow[];
} & (
  | {
      answerer: "plant";
      associations: readonly CurrentAssociationRow[];
      /**
       * CS-013's consent lines, or `null` for a plant that already has an
       * overseer — the same condition the accept's own write makes, made once
       * more where the reader is.
       */
      consent: readonly string[] | null;
    }
  | { answerer: "sending_church"; network: CurrentAssociationRow | null }
);

// ----------------------------------------------------------------------------
// Notifications (N-006, N-027, #324)
// ----------------------------------------------------------------------------

export type NotificationsSectionView = {
  section: "notifications";
  /** Resolved against the same audience the feed and the dispatcher use. */
  matrix: PreferenceMatrixView;
  /** The session's own address, when we have stopped emailing it (#324). */
  suppressedEmail: string | null;
};
