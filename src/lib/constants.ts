// Phase definitions from system architecture
export const PHASES = {
  0: "Phase 0: Discovery",
  1: "Phase 1: Core Group Development",
  2: "Phase 2: Launch Team Formation",
  3: "Phase 3: Training & Preparation",
  4: "Phase 4: Pre-Launch",
  5: "Phase 5: Launch Sunday",
  6: "Phase 6: Post-Launch",
} as const;

export type PhaseNumber = keyof typeof PHASES;

// User roles
export const USER_ROLES = {
  planter: "Church Planter",
  coach: "Coach",
  team_member: "Team Member",
  sending_church_admin: "Sending Church Admin",
  network_admin: "Network Admin",
} as const;
