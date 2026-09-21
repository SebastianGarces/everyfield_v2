import type { SeatFields } from "@/lib/auth/tenancy";
import { hasDiscoveryProfile } from "@/lib/discovery/profile";

/** Required shell identity, unlike the optional coaching list. A failed read
 * must escape rather than render an unknown account as non-discovery. */
export async function discoveryIdentityForShell(
  user: SeatFields & { id: string },
  load: (userId: string) => Promise<boolean> = hasDiscoveryProfile
): Promise<boolean> {
  if (
    user.seat ||
    user.churchId ||
    user.sendingChurchId ||
    user.sendingNetworkId
  ) {
    return false;
  }
  return load(user.id);
}
