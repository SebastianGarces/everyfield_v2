import {
  PREDEFINED_TEAM_KEYS,
  type PredefinedTeamKey,
  type TimeCommitment,
} from "@/db/schema/ministry-teams";

// The keys are DECLARED beside the column that stores them
// (`src/db/schema/ministry-teams.ts`) and re-exported here, where every caller
// already looks for them. One declaration, one import path, no cast anywhere
// between a `ministry_teams` row and `getRoleTemplates`.
export { PREDEFINED_TEAM_KEYS };
export type { PredefinedTeamKey };

// ============================================================================
// Role Template Types
// ============================================================================

export interface RoleTemplate {
  key: string;
  roleName: string;
  description: string;
  isLeadership: boolean;
  timeCommitment: TimeCommitment;
  sortOrder: number;
}

export interface TeamTemplate {
  /**
   * The stored key, typed as the column's own union — so the template DATA is
   * checked against the schema rather than the schema being widened to admit
   * whatever the data happens to say.
   */
  teamKey: PredefinedTeamKey;
  teamName: string;
  icon: string;
  description: string;
  sortOrder: number;
  roles: RoleTemplate[];
}

// ============================================================================
// Team Templates with Role Definitions
// ============================================================================

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    teamKey: "senior_pastor",
    // "Leadership", not "Senior Pastor" (ruled 2026-08-09, #378): a TEAM carries
    // a ministry's name and a ROLE carries a person's, and this was the one
    // template that named the team after the role inside it. The `teamKey` and
    // both role names are unchanged — `ministry_teams.template_key` is what
    // identifies the template now, so this is a display change end to end.
    teamName: "Leadership",
    icon: "crown",
    description:
      "Overall leadership, vision casting, preaching calendar, shepherding, leader development",
    sortOrder: 1,
    roles: [
      {
        key: "senior_pastor",
        roleName: "Senior Pastor",
        description:
          "Primary visionary leader responsible for preaching, vision casting, and shepherding the church plant",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "associate_pastor",
        roleName: "Associate Pastor",
        description:
          "Assists the Senior Pastor with pastoral duties, counseling, and leadership development",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 2,
      },
    ],
  },
  {
    teamKey: "launch_coordinator",
    teamName: "Launch Coordinator",
    icon: "rocket",
    description:
      "Project management, timeline, milestones, budget tracking, meeting coordination",
    sortOrder: 2,
    roles: [
      {
        key: "launch_coordinator",
        roleName: "Launch Coordinator",
        description:
          "Manages the overall launch timeline, milestones, budget tracking, and meeting coordination",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "administrative_assistant",
        roleName: "Administrative Assistant",
        description:
          "Supports the Launch Coordinator with scheduling, communications, and documentation",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
    ],
  },
  {
    teamKey: "worship",
    teamName: "Worship Team",
    icon: "music",
    description:
      "Worship ministry development, production oversight, musician development, setup/teardown",
    sortOrder: 3,
    roles: [
      {
        key: "worship_leader",
        roleName: "Worship Leader",
        description:
          "Leads worship ministry development, selects songs, develops musicians, oversees production",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "vocalist",
        roleName: "Vocalist",
        description:
          "Provides vocals during worship services, attends rehearsals",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "drummer",
        roleName: "Drummer",
        description: "Provides percussion during worship services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "bassist",
        roleName: "Bassist",
        description: "Provides bass guitar during worship services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 4,
      },
      {
        key: "guitarist",
        roleName: "Guitarist",
        description:
          "Provides acoustic or electric guitar during worship services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 5,
      },
      {
        key: "keys_piano",
        roleName: "Keys/Piano",
        description:
          "Provides keyboard or piano accompaniment during worship services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 6,
      },
      {
        key: "sound_technician",
        roleName: "Sound Technician",
        description:
          "Manages audio equipment, mixing, and sound quality during services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 7,
      },
      {
        key: "slides_lyrics_operator",
        roleName: "Slides/Lyrics Operator",
        description:
          "Operates presentation software for song lyrics and announcements",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 8,
      },
      {
        key: "stage_manager",
        roleName: "Stage Manager",
        description:
          "Coordinates stage setup, transitions, and equipment management",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 9,
      },
      {
        key: "setup_teardown_lead_worship",
        roleName: "Setup/Teardown Lead",
        description:
          "Coordinates the setup and teardown of worship equipment before and after services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 10,
      },
    ],
  },
  {
    teamKey: "childrens_ministry",
    teamName: "Children's Ministry",
    icon: "baby",
    description:
      "Curriculum, volunteer screening, safety protocols, check-in systems, room setup",
    sortOrder: 4,
    roles: [
      {
        key: "childrens_ministry_director",
        roleName: "Children's Ministry Director",
        description:
          "Oversees all children's ministry operations, curriculum, safety protocols, and volunteer management",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "nursery_lead",
        roleName: "Nursery Lead",
        description:
          "Manages nursery operations for infants and toddlers during services",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "preschool_lead",
        roleName: "Preschool Lead",
        description: "Leads preschool-age programming and classroom management",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "elementary_lead",
        roleName: "Elementary Lead",
        description:
          "Leads elementary-age programming, lessons, and activities",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 4,
      },
      {
        key: "checkin_coordinator",
        roleName: "Check-in Coordinator",
        description:
          "Manages the child check-in and check-out system for safety and security",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 5,
      },
      {
        key: "safety_coordinator",
        roleName: "Safety Coordinator",
        description:
          "Ensures all safety protocols are followed, manages background checks and training compliance",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 6,
      },
      {
        key: "curriculum_coordinator",
        roleName: "Curriculum Coordinator",
        description:
          "Selects, prepares, and distributes curriculum materials for all age groups",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 7,
      },
    ],
  },
  {
    teamKey: "facilities",
    teamName: "Facilities",
    icon: "building",
    description:
      "Secure worship site, manage venue relationship, signage, parking, storage",
    sortOrder: 5,
    roles: [
      {
        key: "facilities_director",
        roleName: "Facilities Director",
        description:
          "Oversees venue relationship, facility logistics, and coordinates all facilities teams",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "setup_lead",
        roleName: "Setup Lead",
        description:
          "Coordinates the pre-service setup of all areas including seating, signage, and equipment",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "teardown_lead",
        roleName: "Teardown Lead",
        description:
          "Coordinates post-service teardown, cleanup, and equipment storage",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "parking_coordinator",
        roleName: "Parking Coordinator",
        description:
          "Manages parking logistics, directional signage, and parking lot greeting",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 4,
      },
      {
        key: "signage_coordinator",
        roleName: "Signage Coordinator",
        description:
          "Creates and places directional and welcome signage for services and events",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 5,
      },
      {
        key: "storage_manager",
        roleName: "Storage Manager",
        description:
          "Manages storage unit or area, equipment inventory, and supply ordering",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 6,
      },
    ],
  },
  {
    teamKey: "assimilation",
    teamName: "Assimilation",
    icon: "handshake",
    description:
      "Guest tracking, follow-up process, Friendship Registers, data management, Guest Reception, Party with the Pastor, Peak Performance classes",
    sortOrder: 6,
    roles: [
      {
        key: "assimilation_director",
        roleName: "Assimilation Director",
        description:
          "Oversees the complete guest assimilation process from first visit through full integration",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "guest_reception_lead",
        roleName: "Guest Reception Lead",
        description:
          "Manages the Guest Reception area, greets first-time visitors, and collects connection information",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "followup_coordinator",
        roleName: "Follow-up Coordinator",
        description:
          "Manages the follow-up process for all guests within 48 hours of their visit",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "data_entry_specialist",
        roleName: "Data Entry Specialist",
        description:
          "Enters guest information from Friendship Registers and connection cards into the system",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 4,
      },
      {
        key: "party_with_pastor_coordinator",
        roleName: "Party with the Pastor Coordinator",
        description:
          "Plans and executes Party with the Pastor events for prospective members",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 5,
      },
      {
        key: "peak_performance_coordinator",
        roleName: "Peak Performance Coordinator",
        description:
          "Coordinates Peak Performance class scheduling, registration, and materials",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 6,
      },
    ],
  },
  {
    teamKey: "small_groups",
    teamName: "Small Groups",
    icon: "users",
    description:
      "Leader identification and training, Small Group 101, group assignment, Apprentice Program, curriculum",
    sortOrder: 7,
    roles: [
      {
        key: "small_groups_director",
        roleName: "Small Groups Director",
        description:
          "Oversees the Small Groups ministry, identifies and trains leaders, manages curriculum",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "small_group_coach",
        roleName: "Small Group Coach",
        description:
          "Mentors and supports multiple small group leaders, ensures group health",
        isLeadership: true,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "small_group_leader",
        roleName: "Small Group Leader",
        description:
          "Facilitates a small group, provides pastoral care for group members",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "apprentice_leader",
        roleName: "Apprentice Leader",
        description:
          "Learning to lead a small group through the Apprentice Program under a current leader",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 4,
      },
    ],
  },
  {
    teamKey: "promotion",
    teamName: "Promotion",
    icon: "megaphone",
    description:
      "Marketing plan, social media, press releases, direct mail, invitation materials",
    sortOrder: 8,
    roles: [
      {
        key: "promotion_director",
        roleName: "Promotion Director",
        description:
          "Develops and executes the marketing plan, coordinates all promotional activities",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "social_media_coordinator",
        roleName: "Social Media Coordinator",
        description:
          "Manages social media accounts, creates content, engages with followers",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "graphic_designer",
        roleName: "Graphic Designer",
        description:
          "Creates visual materials including flyers, banners, social media graphics, and branding",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "print_materials_coordinator",
        roleName: "Print Materials Coordinator",
        description:
          "Manages print production of invitations, mailers, bulletins, and other materials",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 4,
      },
    ],
  },
  {
    teamKey: "prayer",
    teamName: "Prayer",
    icon: "heart",
    description:
      "Prayer strategy, prayer teams, corporate prayer events, communication of requests",
    sortOrder: 9,
    roles: [
      {
        key: "prayer_director",
        roleName: "Prayer Director",
        description:
          "Develops prayer strategy, organizes corporate prayer events, manages prayer teams",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "prayer_team_lead",
        roleName: "Prayer Team Lead",
        description:
          "Leads a prayer team, coordinates prayer assignments, and facilitates prayer meetings",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "prayer_chain_coordinator",
        roleName: "Prayer Chain Coordinator",
        description:
          "Manages the prayer chain, distributes prayer requests, and coordinates responses",
        isLeadership: false,
        timeCommitment: "low",
        sortOrder: 3,
      },
    ],
  },
  {
    teamKey: "technology",
    teamName: "Technology",
    icon: "monitor",
    description:
      "Website development, production technology, assimilation software, communication tools",
    sortOrder: 10,
    roles: [
      {
        key: "technology_director",
        roleName: "Technology Director",
        description:
          "Oversees all technology systems including website, production tech, and church software",
        isLeadership: true,
        timeCommitment: "high",
        sortOrder: 1,
      },
      {
        key: "website_manager",
        roleName: "Website Manager",
        description:
          "Manages church website content, updates, hosting, and online presence",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 2,
      },
      {
        key: "av_production_lead",
        roleName: "AV/Production Lead",
        description:
          "Manages audio/visual equipment, live streaming, and production technology",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 3,
      },
      {
        key: "database_administrator",
        roleName: "Database Administrator",
        description:
          "Manages church database systems, data integrity, and reporting",
        isLeadership: false,
        timeCommitment: "medium",
        sortOrder: 4,
      },
    ],
  },
];

/**
 * The Leadership template's key, named ONCE.
 *
 * Three places need to recognise this one template and nothing else does: the
 * org chart roots on it, the leadership auto-fill triggers on it, and migration
 * 0053 reconciles it. A string literal repeated across them is a rename waiting
 * to half-land — the org chart would quietly stop having a root while
 * everything still compiled. The MIGRATION keeps its own SQL literal, because a
 * migration is a historical record of what ran and must not change meaning when
 * this constant does.
 */
export const LEADERSHIP_TEAM_KEY: PredefinedTeamKey = "senior_pastor";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all templates for a specific team by key
 */
export function getTeamTemplate(
  teamKey: PredefinedTeamKey
): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.teamKey === teamKey);
}

/**
 * Get role templates for a specific team
 */
export function getRoleTemplates(teamKey: PredefinedTeamKey): RoleTemplate[] {
  const team = getTeamTemplate(teamKey);
  return team?.roles ?? [];
}

/**
 * Get all predefined team templates (ordered)
 */
export function getAllTeamTemplates(): TeamTemplate[] {
  return TEAM_TEMPLATES;
}

/**
 * Get total count of predefined roles across all teams
 */
export function getTotalRoleTemplateCount(): number {
  return TEAM_TEMPLATES.reduce((acc, team) => acc + team.roles.length, 0);
}

// ============================================================================
// Responsibilities — the Launch Playbook items a predefined team starts with
// ============================================================================

/**
 * The playbook responsibilities a predefined team is seeded with (#311 WS1).
 *
 * THE TEAM DESCRIPTION *IS* THE LIST. Every `TEAM_TEMPLATES` entry states its
 * team's remit as a comma-separated phrase — "Overall leadership, vision
 * casting, preaching calendar, shepherding, leader development" — which is
 * already the Launch Playbook's checklist for that team, written as prose. The
 * responsibilities tab has split it on commas since it existed; this function
 * is that split, moved to the module that OWNS the data and given a caller that
 * persists the result instead of re-deriving it on every render.
 *
 * IT RUNS ONCE PER TEAM, EVER. After the seed the rows are the truth: editing a
 * description here changes what the NEXT plant is seeded with and nothing about
 * the plants that already have their rows. That is what makes the items the
 * planter's to edit and delete rather than a view of our copy.
 *
 * The first letter is capitalised because a stored title is read as written —
 * the tab used to lean on a `capitalize` CSS class, which is a lie the moment
 * the planter edits the row.
 */
export function playbookResponsibilities(teamKey: PredefinedTeamKey): string[] {
  const template = getTeamTemplate(teamKey);
  if (!template) return [];

  return template.description
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1));
}

// ============================================================================
// Background checks — which rosters show a member's status
// ============================================================================

/**
 * The predefined teams whose roster shows each member's background-check
 * status.
 *
 * THE REQUIREMENT IS STATED PER TEAM, NOT PER ROLE, AND THAT IS DELIBERATE.
 * The ministry-teams FRD asks for exactly one thing here — "reads each person's
 * background-check status so it is visible on the Children's Ministry roster" —
 * and its TeamRole contract carries no "requires a background check" flag to
 * hang the question on. Roles carry no training requirement of their own for
 * the same stated reason: per-role granularity is premature for teams this
 * size. So a role flag is NOT invented here; the team is the unit the
 * requirement was written about, and the FRD's Children's Ministry section is
 * what this list spells.
 *
 * A role-level flag landing later does not contradict this: the roster asks
 * `teamRequiresBackgroundCheck` once, so widening it to consult a role reaches
 * every surface at once.
 */
export const BACKGROUND_CHECK_TEAM_KEYS: readonly PredefinedTeamKey[] = [
  "childrens_ministry",
];

/**
 * Whether a team's roster shows its members' background-check status.
 *
 * Matched on `ministry_teams.template_key`, the column that says WHICH template
 * a team came from (ruling 2026-08-12, #378). It used to match on the team's
 * NAME, because no such column existed — so a planter who renamed their
 * Children's Ministry team silently lost the roster's status column, and
 * renaming a template in this file would have done the same to every plant at
 * once. A custom team carries no key and answers false: the status is still on
 * every person's profile, so nothing is hidden, it is only not claimed to be
 * required.
 */
export function teamRequiresBackgroundCheck(
  templateKey: PredefinedTeamKey | null
): boolean {
  return (
    templateKey !== null && BACKGROUND_CHECK_TEAM_KEYS.includes(templateKey)
  );
}
