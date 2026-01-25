// Re-export database types
export type { Church, NewChurch } from "@/db/schema/church";
export type { User, NewUser, UserRole } from "@/db/schema/user";
export type { Session, NewSession } from "@/db/schema/session";

// App-wide types
export interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
