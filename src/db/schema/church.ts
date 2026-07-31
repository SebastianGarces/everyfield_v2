import {
  date,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";

export const churches = pgTable("churches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  currentPhase: integer("current_phase").default(0).notNull(),
  // Onboarding (F12 / OB-002): where the plant is. Each part is INDIVIDUALLY
  // optional — a planter who knows the city but not the region must not be
  // blocked, so these are three nullable columns rather than one required
  // address. Captured at step 1 and editable later in church settings.
  city: varchar("city", { length: 255 }),
  stateRegion: varchar("state_region", { length: 255 }),
  country: varchar("country", { length: 255 }),
  // Onboarding (F12 / OB-001): null = the onboarding flow still owns this
  // planter's dashboard. Set once, when the planter finishes or skips out of
  // the flow. Existing churches were backfilled to their created_at by
  // migration 0027, so nobody is retro-enrolled into a flow they never saw.
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  sendingChurchId: uuid("sending_church_id").references(
    () => sendingChurches.id
  ),
  sendingNetworkId: uuid("sending_network_id").references(
    () => sendingNetworks.id
  ),
  // Inactivity thresholds (days since last activity)
  inactivityWarningDays: integer("inactivity_warning_days")
    .default(7)
    .notNull(),
  inactivityAlertDays: integer("inactivity_alert_days").default(14).notNull(),
  // Phase Engine: target public launch date, feeds the countdown signal (PE-004).
  launchDate: date("launch_date"),
  // Phase Engine: set when a material event occurs; compared against the latest
  // assessment's generated_at to mark a plant "dirty" for re-assessment (PE-010).
  lastMaterialEventAt: timestamp("last_material_event_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Church = typeof churches.$inferSelect;
export type NewChurch = typeof churches.$inferInsert;
