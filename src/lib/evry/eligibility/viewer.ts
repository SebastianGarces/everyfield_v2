import type { User, UserSeat } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import { tenancyOf, type SeatFields } from "@/lib/auth/tenancy";

const EVRY_PLANT_ACTOR: unique symbol = Symbol("EvryPlantActor");

/**
 * Authority minted from the authenticated session for one seated plant user.
 *
 * The private symbol prevents page, conversation, recipe, and model data from
 * being passed where an authenticated actor is required. Consumers still have
 * to re-mint the actor before execution; this value is not a durable grant.
 */
export type EvryPlantActor = Readonly<{
  userId: string;
  plantId: string;
  seat: UserSeat;
  [EVRY_PLANT_ACTOR]: true;
}>;

type EvrySessionUser = Pick<User, "id"> & SeatFields;

/**
 * The non-authority result of classifying a session-shaped user projection.
 *
 * This is exported for exhaustive shape tests. Neither arm carries the private
 * actor brand, and no authority API accepts it, so caller data cannot use this
 * helper to mint authority.
 */
export type EvryPlantStanding =
  | Readonly<{
      status: "eligible";
      userId: string;
      plantId: string;
      seat: UserSeat;
    }>
  | Readonly<{ status: "ineligible" }>;

export function evryPlantStandingOf(user: EvrySessionUser): EvryPlantStanding {
  const tenancy = tenancyOf(user);

  return tenancy?.type === "church" && user.seat !== null
    ? {
        status: "eligible",
        userId: user.id,
        plantId: tenancy.id,
        seat: user.seat,
      }
    : { status: "ineligible" };
}

/** One neutral refusal for every authenticated account outside a plant seat. */
export class EvryPlantViewerRefusalError extends Error {
  constructor() {
    super("Evry is unavailable for this account");
    this.name = "EvryPlantViewerRefusalError";
  }
}

/**
 * Establish the authenticated plant actor and nothing more.
 *
 * Capability eligibility is intentionally a later boundary. Keeping it out of
 * this adapter prevents opening Evry from becoming a durable authorization
 * snapshot that a later plan could spend.
 */
export async function requireEvryPlantViewer(): Promise<EvryPlantActor> {
  const { user } = await verifySession();
  const standing = evryPlantStandingOf(user);

  if (standing.status === "ineligible") {
    throw new EvryPlantViewerRefusalError();
  }

  const actor: EvryPlantActor = {
    userId: standing.userId,
    plantId: standing.plantId,
    seat: standing.seat,
    [EVRY_PLANT_ACTOR]: true,
  };

  return Object.freeze(actor);
}
