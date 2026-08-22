import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sendingChurches } from "./sending-church";
import { sendingNetworks } from "./sending-network";
import type { ChurchLeadershipStatus } from "@/lib/onboarding/leadership";

export const churches = pgTable(
  "churches",
  {
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
    // CS-006, ruled 2026-08-15 §187: the one part of the address onboarding does
    // NOT ask for, added here rather than at step 1 because a planter naming
    // their plant does not yet have a street to give. Nullable and never
    // required, exactly like the three above, and it joins them as a fourth
    // INDIVIDUALLY optional column rather than being folded into `city`.
    //
    // IT IS NOT AN OVERSIGHT FIELD. `formatPlantLocation` (oversight/read.ts)
    // composes city, region and country and deliberately does not read this —
    // a sending church locating a plant needs the town, not the door.
    streetAddress: varchar("street_address", { length: 255 }),
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
    // Inactivity thresholds (days since last activity), edited on the church
    // profile since CS-009. Read by `/people` to age a contact's last-activity
    // badge; `warning` must be the SMALLER of the two.
    //
    // NO `CHECK` HERE, unlike the digest columns below, and the line between
    // them is what a bad value COSTS. A stored digest hour of 24 is a send that
    // never happens — silent, unrecoverable, and invisible until someone asks
    // why the digest stopped. A warning of 400 days is wrong on the very next
    // page load of `/people`, in the same session, and the control that set it
    // is one click away. So this column takes the `time_zone` posture: rejected
    // by the action's parser and again by `setChurchInactivityThresholds`
    // before the statement is built, with nothing frozen into DDL.
    inactivityWarningDays: integer("inactivity_warning_days")
      .default(7)
      .notNull(),
    inactivityAlertDays: integer("inactivity_alert_days").default(14).notNull(),
    // WHEN the planter digest lands (N-013, ruled 2026-08-15) — 0 = Sunday,
    // 16 = 16:00, both read on the wall clock in `time_zone` above. The CHURCH
    // decides when; the RECIPIENT still decides whether and how often, through
    // their own `digest` category preference. The weekday governs the WEEKLY
    // cadence only; the hour governs both.
    //
    // Unlike `time_zone` these DO carry `CHECK` constraints
    // (`churches_digest_send_weekday_check` / `..._hour_check`, migration 0056).
    // The reason that column has none is that IANA's list drifts and a CHECK
    // would freeze it; 0–6 and 0–23 are arithmetic and never will. A stored 24
    // would send at an hour that does not exist, which is a digest nobody ever
    // receives, so the strongest available guard is the right one.
    digestSendWeekday: integer("digest_send_weekday").default(0).notNull(),
    digestSendHour: integer("digest_send_hour").default(16).notNull(),
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
  },
  (table) => [
    // A weekday is 0–6 and an hour is 0–23. Out-of-range is REJECTED rather
    // than stored, and here rather than only in the action, because a stored 24
    // is a send time that never arrives — a digest silently owed forever.
    check(
      "churches_digest_send_weekday_check",
      sql`${table.digestSendWeekday} between 0 and 6`
    ),
    check(
      "churches_digest_send_hour_check",
      sql`${table.digestSendHour} between 0 and 23`
    ),
  ]
);

export type Church = typeof churches.$inferSelect;
export type NewChurch = typeof churches.$inferInsert;
