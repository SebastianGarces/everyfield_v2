import {
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";
import type { ChurchLeadershipStatus } from "@/lib/onboarding/leadership";

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
  // Onboarding (F12 / OB-004): the answer to "will you be the lead
  // planter/pastor?". NULL = never asked (every church predating this step),
  // which is NOT the same as "no planter" — see
  // `src/lib/onboarding/leadership.ts`, which owns the three-state rule. The
  // planter ASSIGNMENT itself is still `users.church_id` + the `planter` role;
  // this column is what makes "does this church have a planter?" explicit and
  // queryable instead of inferred.
  leadershipStatus: varchar("leadership_status", {
    length: 32,
  }).$type<ChurchLeadershipStatus>(),
  sendingChurchId: uuid("sending_church_id").references(
    () => sendingChurches.id
  ),
  sendingNetworkId: uuid("sending_network_id").references(
    () => sendingNetworks.id
  ),
  // Display zone for church-scoped instants (relative-day badges, training
  // dates, a message's sentAt). Meeting `datetime` is still a wall clock in
  // UTC — this column does not reinterpret those. Default is the backfill too:
  // every existing row is America/Chicago until a planter changes it in
  // settings. Invalid ids are rejected on write, not by a CHECK — IANA is
  // `Intl`'s list, and a CHECK would freeze it.
  timeZone: varchar("time_zone", { length: 64 })
    .default("America/Chicago")
    .notNull(),
  // Inactivity thresholds (days since last activity)
  inactivityWarningDays: integer("inactivity_warning_days")
    .default(7)
    .notNull(),
  inactivityAlertDays: integer("inactivity_alert_days").default(14).notNull(),
  // NO `launch_date` HERE. It lived on this row until migration 0032 dropped it
  // (LS-001, #285's ruling): Launch Sunday is an entity now — `launches`, one
  // live row per church, in `./launch.ts` — and the entity is its ONLY owner.
  // A mirrored copy on the church row is what makes two surfaces disagree about
  // the same day, so there is deliberately nothing to mirror. Read the date
  // through `src/lib/launch/queries.ts`; write it through
  // `src/lib/launch/service.ts`.
  //
  // Phase Engine: set when a material event occurs; compared against the latest
  // assessment's generated_at to mark a plant "dirty" for re-assessment (PE-010).
  lastMaterialEventAt: timestamp("last_material_event_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Church = typeof churches.$inferSelect;
export type NewChurch = typeof churches.$inferInsert;
