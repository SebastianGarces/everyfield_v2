import { accountTypes, type AccountType } from "@/lib/validations/auth";
import type { RegistrationInvitation } from "./beta-gate";

/** A seat or coach token decides the account; org invitees can start in discovery. */
export function registrationAccountTypeChoices(
  invitation: RegistrationInvitation | null,
  hasSeatInvitation: boolean
): readonly AccountType[] {
  if (hasSeatInvitation) return [];
  return invitation ? [invitation.accountType, "discovery"] : accountTypes;
}
