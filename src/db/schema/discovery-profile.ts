import { pgTable, uuid } from "drizzle-orm/pg-core";

import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";
import { users } from "./user";

// These are associations, never the account's seat tenancy. Row existence
// means discovery; invitation and audit history will reference the user.
export const discoveryProfiles = pgTable("discovery_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  sendingChurchId: uuid("sending_church_id").references(
    () => sendingChurches.id
  ),
  sendingNetworkId: uuid("sending_network_id").references(
    () => sendingNetworks.id
  ),
});

export type DiscoveryProfile = typeof discoveryProfiles.$inferSelect;
