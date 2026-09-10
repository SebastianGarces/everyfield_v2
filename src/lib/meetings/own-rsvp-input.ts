import { z } from "zod";

/** The same two answers accepted by the public token RSVP. */
export const ownRsvpInput = z
  .object({
    response: z.enum(["confirmed", "declined"]),
  })
  .strict();

export type OwnRsvpResponse = z.infer<typeof ownRsvpInput>["response"];
