// Re-export database types
export type { Church, NewChurch } from "@/db/schema/church";
export type {
  ChurchPrivacySettings,
  NewChurchPrivacySettings,
} from "@/db/schema/church-privacy-settings";
export type {
  CoachAssignment,
  NewCoachAssignment,
} from "@/db/schema/coach-assignment";
export type {
  NewOrganizationInvitation,
  OrganizationInvitation,
} from "@/db/schema/organization-invitation";
export type {
  NewSendingChurch,
  SendingChurch,
} from "@/db/schema/sending-church";
export type {
  NewSendingNetwork,
  SendingNetwork,
} from "@/db/schema/sending-network";
export type { NewSession, Session } from "@/db/schema/session";
export type { NewUser, User, UserRole } from "@/db/schema/user";

// App-wide types
export interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
