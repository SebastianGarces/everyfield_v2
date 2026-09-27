import { z } from "zod";

export const adminRsvpSchema = z.enum(["confirmed", "declined", "pending"]);
export type AdminRsvp = z.infer<typeof adminRsvpSchema>;
export const ADMIN_RSVP_CHOICES: { value: AdminRsvp; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "declined", label: "Declined" },
  { value: "pending", label: "Reset to Pending" },
];
