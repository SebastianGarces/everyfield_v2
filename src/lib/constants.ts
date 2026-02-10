// Phase definitions from system architecture
export const PHASES = {
  0: "Pre-Phase 1",
  1: "Phase 1: Foundation",
  2: "Phase 2: Building Core Team",
  3: "Phase 3: Launch Preparation",
  4: "Phase 4: Final Countdown",
  5: "Phase 5: Launch Week",
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
