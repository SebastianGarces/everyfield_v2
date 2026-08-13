// ============================================================================
// Oversight plants directory + detail — the shared type contract (OV-001 /
// OV-002, FRD `product-docs/features/oversight/frd.md`).
//
// THE GOVERNING CONSTRAINT, encoded in the types rather than left to review:
// an oversight surface renders AGGREGATE METRICS ONLY (memory/invariants.md →
// Hierarchical Access Control). Every gated section below therefore resolves to
// a list of `OversightStat` — a label and an already-formatted value — and
// there is no shape anywhere in this module that can carry a row from
// `persons`. A future section that wanted to name somebody would have to change
// the type, which is exactly the review moment the invariant deserves.
//
// The one identity these types do carry is the PLANTER's name, on the plant
// header. That is not a person record: the planter is the org's counterparty —
// the account it invited by email and whose acceptance created the association
// (`organization_invitations.invitee_email` is already on the invitations
// surface) — and OV-001 requires it by name. Their contact details are not
// here, and nothing from the plant's own people/CRM ever is.
// ============================================================================

import type { PersonStatus } from "@/db/schema";

// ----------------------------------------------------------------------------
// Association provenance (OV-001) — how this plant came to be ours.
// ----------------------------------------------------------------------------

/** Which kind of oversight org the caller is reading as. */
export type OversightOrgType = "sending_church" | "network";

/**
 * Where the association came from, for the caller's own org.
 *
 * `associatedAt` is null when no accepted invitation is on record — associations
 * can predate the invitation system or come from seeding (the same fact
 * `association_events.source_invitation_id` records as null). That is a fact to
 * state, not a gap to hide, so the UI says "no invitation on record" rather
 * than rendering a blank date.
 */
export interface OversightAssociationProvenance {
  orgType: OversightOrgType;
  /** The caller's own organization — never another org's name. */
  orgName: string;
  /**
   * For a network admin: the sending church this plant also belongs to, when
   * there is one. Null for a sending-church admin (they ARE the sending church)
   * and for a plant with no sending church.
   */
  viaSendingChurchName: string | null;
  /** When the invitation that created this association was accepted. */
  associatedAt: Date | null;
}

// ----------------------------------------------------------------------------
// Portfolio index row (#241) — `/oversight`.
// ----------------------------------------------------------------------------

/**
 * One plant on the oversight INDEX: a link target, a name, a phase.
 *
 * Three fields, and the type is the projection's contract: the index reads the
 * three columns it renders and no more, so a field added here is a column added
 * to the statement in `./read.ts` — a deliberate act, not a `select()` dragging
 * the whole `churches` row across the wire. `read.test.ts` renders that
 * statement and asserts the two agree.
 */
export interface OversightPortfolioPlant {
  id: string;
  name: string;
  currentPhase: number;
}

// ----------------------------------------------------------------------------
// Directory row (OV-001).
// ----------------------------------------------------------------------------

/**
 * One plant in `/oversight/plants`. Deliberately NOT privacy-gated: the roster
 * is visible to the associated org regardless of the six `share_*` toggles,
 * which gate the feature data INSIDE a plant and not the plant's existence
 * (memory/invariants.md → Hierarchical Access Control; the same rule
 * `getOversightPlantHealth` follows).
 */
export interface OversightPlantSummary {
  churchId: string;
  name: string;
  /** "Austin, Texas, US" — composed from whichever location parts are set. */
  location: string | null;
  /** The plant's lead planter, or null when none is assigned yet. */
  planterName: string | null;
  currentPhase: number;
  /** yyyy-mm-dd, or null when the plant has set no launch date. */
  launchDate: string | null;
  /** Whole days from "now" to the launch date; negative once past. */
  daysUntilLaunch: number | null;
  provenance: OversightAssociationProvenance;
}

// ----------------------------------------------------------------------------
// Sending-church roster row (OV-009) — network admins only.
// ----------------------------------------------------------------------------

/**
 * One member sending church in `/oversight/sending-churches`.
 *
 * Two counts and a name, and nothing that could grow into a person: this is a
 * network admin reading a MEMBER ORG's shape, one level further from the plants
 * than the directory row above, so the aggregates-only rule binds harder here
 * rather than less. `plantCount` is scoped to the caller's own network — see
 * `listNetworkSendingChurches` rule 2 — so these counts partition
 * `/oversight/plants` instead of describing plants the network cannot open.
 */
export interface NetworkSendingChurchSummary {
  sendingChurchId: string;
  name: string;
  /** Plants in the caller's network attributed to this sending church. */
  plantCount: number;
  /** Invitations this sending church has out that are still live. */
  pendingInvitationCount: number;
}

// ----------------------------------------------------------------------------
// Aggregates — the only feature data an oversight user may pull, and only
// where the plant's corresponding `share_*` toggle is on.
// ----------------------------------------------------------------------------

/** Pipeline counts. Counts only: never who is in a stage. */
export interface PeopleAggregate {
  total: number;
  byStatus: { status: PersonStatus; count: number }[];
}

/** Meeting cadence and attendance averages. Never an attendee list. */
export interface MeetingsAggregate {
  completedCount: number;
  upcomingCount: number;
  lastCompletedAt: Date | null;
  daysSinceLastCompleted: number | null;
  /** Mean gap between recent completed meetings; null with fewer than two. */
  averageCadenceDays: number | null;
  /** Mean recorded attendance across completed meetings; null when unrecorded. */
  averageAttendance: number | null;
}

/** Task throughput. Never a title, an assignee, or a due item. */
export interface TasksAggregate {
  total: number;
  open: number;
  completed: number;
  overdue: number;
}

/** Ministry-team coverage. Team-level counts; never a member or a leader name. */
export interface MinistryTeamsAggregate {
  teamCount: number;
  teamsWithLeader: number;
  activeMemberships: number;
}

// ----------------------------------------------------------------------------
// Gated section results (OV-002).
// ----------------------------------------------------------------------------

/** One labelled number on a section card. Pre-formatted; never a person. */
export interface OversightStat {
  label: string;
  /** Already formatted for display — "12", "Aug 3, 2026", "Not recorded". */
  value: string;
  /** Optional one-line clarification under the value. */
  hint?: string;
}

/**
 * The outcome of asking `canAccessFeatureData` for one section.
 *
 * `withheld` and an empty `shared` are DIFFERENT answers and the UI must not
 * collapse them: "they share this, there is nothing in it yet" is not "they
 * have not shared this" — the same distinction `computeHasSharedContent` draws
 * on the health surface.
 */
export type OversightSectionResult =
  | {
      key: OversightSectionKey;
      state: "shared";
      stats: OversightStat[];
      /** Every stat is zero / unrecorded — shared, but nothing to show yet. */
      isEmpty: boolean;
    }
  | { key: OversightSectionKey; state: "withheld" };

/** The keys of the gated sections on the plant detail page. */
export type OversightSectionKey =
  | "people"
  | "meetings"
  | "tasks"
  | "ministry_teams";

/** Everything `/oversight/plants/[id]` renders. */
export interface OversightPlantDetail {
  plant: OversightPlantSummary;
  sections: OversightSectionResult[];
}
