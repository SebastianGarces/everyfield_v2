/**
 * Marketing Church Seed Script
 *
 * Seeds the demo world behind the landing-page screenshots
 * (docs/marketing-church-seed.md, RULED 2026-07-31):
 *
 *   1. Redemption Hill Church — planter Daniel Reyes, Phase 4 (Pre-launch),
 *      launch Sunday 4 weeks from run time. The catalog cast (Riveras, Dana
 *      Whitfield, Okafors, Sam Torres, Grace Lin, J. P. Holloway) plus
 *      realistic filler to 142 people, Vision Nights #1–#4 finalized through
 *      the REAL event pipeline (attendance auto-advance, follow-up task
 *      creation, phase-engine dirty-marking), 8 staffed ministry teams with
 *      training mid-flight, the catalog task board, wiki progress,
 *      communication history and unread notifications.
 *   2. Trinity Grove Church — a small "graduated" plant ~6 weeks post-launch,
 *      seeded for the landing page's "Beyond" phase-tab shot.
 *
 * Hard guarantees (mirrors scripts/seed-phase-engine-eval.ts):
 *   - Namespacing: everything hangs off the "EveryField Marketing" sending
 *     network; users carry that network id. `--clean` removes only
 *     marketing-namespaced rows, child-first.
 *   - Idempotent: a default run cleans then reseeds; re-running never
 *     duplicates.
 *   - Dates are RELATIVE TO RUN TIME (launch Sunday = +28 days), so
 *     re-running keeps every "in 21 days" string fresh for re-shoots.
 *   - Real events: attendance is recorded and finalized through the meetings
 *     service, team rosters through the ministry-teams service — statuses,
 *     follow-up tasks and `last_material_event_at` are consequences, not
 *     paint. (Trinity Grove's weekly services set `actual_attendance`
 *     directly — finalizing six ~110-person services would fabricate ~600
 *     follow-up tasks.)
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-marketing-church.ts            # clean + reseed
 *   pnpm exec tsx scripts/seed-marketing-church.ts --clean    # clean only
 *   pnpm exec tsx scripts/seed-marketing-church.ts --assess   # run the REAL
 *                       # LLM assessment for Redemption Hill on the EXISTING
 *                       # seed (no cleaning — a default run would discard the
 *                       # generated assessment). Requires OPENAI_API_KEY.
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { desc, eq, inArray, and, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import {
  associationEvents,
  churches,
  churchMeetings,
  churchPrivacySettings,
  commitments,
  communicationRecipients,
  communications,
  households,
  insightFeedback,
  interviews,
  invitations,
  launchEvents,
  launches,
  locations,
  meetingAttendance,
  meetingChecklistItems,
  meetingConfirmationTokens,
  meetingEvaluations,
  messageTemplates,
  ministryTeams,
  notifications,
  notificationDeliveries,
  organizationInvitations,
  personActivities,
  persons,
  personTags,
  phaseTransitions,
  plantAssessments,
  plantInsights,
  plantSignals,
  sendingChurches,
  sendingNetworks,
  skillsInventory,
  tags,
  tasks,
  teamMemberships,
  teamRoles,
  trainingCompletions,
  trainingPrograms,
  users,
  wikiArticles,
  wikiBookmarks,
  wikiProgress,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

// ============================================================================
// Bootstrapping — load DATABASE_URL BEFORE anything that evaluates `@/db`.
// Every src/lib service (meetings, ministry-teams, notifications, phase
// engine) transitively imports `@/db`, which reads process.env at import
// time, so all of those are loaded via dynamic import() after this call.
// ============================================================================

config({ path: ".env.local" });

const cleanOnly = process.argv.includes("--clean");
const assessOnly = process.argv.includes("--assess");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(connectionString);
const db = drizzle(sql);

// ----------------------------------------------------------------------------
// Namespace markers (used for scoped cleanup)
// ----------------------------------------------------------------------------

// The network NAME is the cleanup namespace (exact-match), so keep it stable.
// Identities are realistic on purpose — these accounts appear in marketing
// screenshots (user menu, activity feed, oversight), so no @everyfield.dev
// placeholders. These are THE documented marketing accounts
// (docs/marketing-church-seed.md → Accounts).
const NETWORK_NAME = "North Texas Church Planting Network";
const SENDING_CHURCH_NAME = "Grace Fellowship Denton";
const PASSWORD = "password123"; // seed-dev convention

const NETWORK_ADMIN_NAME = "Ray Delgado";
const NETWORK_ADMIN_EMAIL = "ray@ntxplanting.org";

const RH_CHURCH_NAME = "Redemption Hill Church";
const RH_PLANTER_EMAIL = "daniel@redemptionhill.org";
const TG_CHURCH_NAME = "Trinity Grove Church";
const TG_PLANTER_EMAIL = "marcus@trinitygrove.org";

// ----------------------------------------------------------------------------
// Relative clock — everything derives from run time so re-shoots stay fresh.
// ----------------------------------------------------------------------------

const NOW = new Date();
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

/** yyyy-mm-dd for `date` columns. */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A date at a specific UTC hour (APP_TIME_ZONE is UTC), e.g. evening 19:00. */
function atHour(d: Date, hour: number, minute = 0): Date {
  const copy = new Date(d);
  copy.setUTCHours(hour, minute, 0, 0);
  return copy;
}

// ============================================================================
// Filler-name bank — realistic, diverse full names, index-derived (no
// Math.random). Stride pairing keeps every combination unique for i < 792.
// ============================================================================

const FIRST_NAMES = [
  "Aaron",
  "Adriana",
  "Aisha",
  "Alejandro",
  "Alex",
  "Alicia",
  "Amir",
  "Ana",
  "Andre",
  "Angela",
  "Anthony",
  "April",
  "Ben",
  "Bianca",
  "Brandon",
  "Briana",
  "Caleb",
  "Camille",
  "Carlos",
  "Carmen",
  "Cassandra",
  "Chris",
  "Christina",
  "Cynthia",
  "Damon",
  "Danielle",
  "Darius",
  "Deborah",
  "Denise",
  "Derek",
  "Diego",
  "Dominic",
  "Eduardo",
  "Elias",
  "Emily",
  "Eric",
  "Esther",
  "Felix",
  "Gabriela",
  "Gary",
  "Gloria",
  "Hannah",
  "Hector",
  "Imani",
  "Isaac",
  "Ivan",
  "Jasmine",
  "Javier",
  "Jerome",
  "Jessica",
  "Joel",
  "Jonah",
  "Jordan",
  "Josue",
  "Julia",
  "Kayla",
  "Keith",
  "Kendra",
  "Kevin",
  "Latoya",
  "Laura",
  "Leah",
  "Lena",
  "Lucas",
  "Luz",
  "Malik",
  "Marcus",
  "Maria",
  "Mariah",
  "Mario",
  "Marissa",
  "Monica",
  "Naomi",
  "Natalie",
] as const;

const LAST_NAMES = [
  "Abara",
  "Acosta",
  "Aguilar",
  "Anderson",
  "Baker",
  "Barnes",
  "Bautista",
  "Bell",
  "Booker",
  "Boyd",
  "Bradley",
  "Brooks",
  "Bryant",
  "Burton",
  "Calloway",
  "Camacho",
  "Carr",
  "Carter",
  "Castillo",
  "Chen",
  "Cho",
  "Coleman",
  "Cortez",
  "Cruz",
  "Dawson",
  "Delgado",
  "Diallo",
  "Dixon",
  "Duong",
  "Ellis",
  "Escobar",
  "Farrell",
  "Figueroa",
  "Fletcher",
  "Flores",
  "Foster",
  "Fuentes",
  "Gaines",
  "Garza",
  "Gibson",
  "Gomez",
  "Grant",
  "Griffin",
  "Guzman",
  "Harmon",
  "Hayes",
  "Henderson",
  "Hernandez",
  "Huang",
  "Hughes",
  "Ibrahim",
  "Jefferson",
  "Jimenez",
  "Kim",
  "Le",
  "Lopez",
  "Marshall",
  "Mbeki",
  "McCoy",
  "Mendez",
  "Mitchell",
  "Morales",
  "Nguyen",
  "Osei",
  "Park",
  "Patel",
  "Patterson",
  "Pham",
  "Ramos",
  "Reeves",
  "Rhodes",
  "Salazar",
] as const;

function fillerName(i: number): { firstName: string; lastName: string } {
  return {
    firstName: FIRST_NAMES[i % FIRST_NAMES.length],
    lastName: LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length],
  };
}

// Deterministic personal contact info so people cards never read "No contact
// info" (ruled 2026-08-02 off the landing crops). Emails come from the name +
// a rotating consumer domain; phones use the reserved-fictional 555-01xx range
// (Denton's 940 area code) for roughly two thirds of people.
const EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "icloud.com",
  "hotmail.com",
] as const;
const usedEmails = new Set<string>();
let phoneCounter = 0;

function contactInfo(
  firstName: string,
  lastName: string,
  i: number
): { email: string; phone: string | null } {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  let email = `${clean(firstName)}.${clean(lastName)}@${EMAIL_DOMAINS[i % EMAIL_DOMAINS.length]}`;
  if (usedEmails.has(email)) {
    email = `${clean(firstName)}.${clean(lastName)}${i}@${EMAIL_DOMAINS[i % EMAIL_DOMAINS.length]}`;
  }
  usedEmails.add(email);
  const phone =
    i % 3 !== 0 && phoneCounter < 100
      ? `(940) 555-01${String(phoneCounter++).padStart(2, "0")}`
      : null;
  return { email, phone };
}

// ============================================================================
// Cleanup — scoped strictly to marketing-namespaced rows (child-first)
// ============================================================================

async function findNetworkId(): Promise<string | null> {
  const rows = await db
    .select({ id: sendingNetworks.id })
    .from(sendingNetworks)
    .where(eq(sendingNetworks.name, NETWORK_NAME))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Former namespace names. The network NAME is the cleanup scope, so a rename
 * would orphan every prior run's rows — retired names stay listed here and
 * are cleaned alongside the current one.
 */
const LEGACY_NETWORK_NAMES = ["EveryField Marketing"];

async function cleanMarketingData(): Promise<void> {
  console.log("🧹 Cleaning marketing data (scoped to the marketing network)…");

  let cleanedAny = false;
  for (const name of [NETWORK_NAME, ...LEGACY_NETWORK_NAMES]) {
    const rows = await db
      .select({ id: sendingNetworks.id })
      .from(sendingNetworks)
      .where(eq(sendingNetworks.name, name))
      .limit(1);
    const networkId = rows[0]?.id;
    if (!networkId) continue;
    cleanedAny = true;
    await cleanNetwork(networkId);
  }
  if (!cleanedAny) {
    console.log("   No marketing network present — nothing to clean.\n");
  }
}

async function cleanNetwork(networkId: string): Promise<void> {
  const sendingChurchRows = await db
    .select({ id: sendingChurches.id })
    .from(sendingChurches)
    .where(eq(sendingChurches.sendingNetworkId, networkId));
  const sendingChurchIds = sendingChurchRows.map((r) => r.id);

  const churchRows = await db
    .select({ id: churches.id })
    .from(churches)
    .where(eq(churches.sendingNetworkId, networkId));
  const churchIds = churchRows.map((r) => r.id);

  // Marketing users are the ones carrying the marketing network id — OR sitting
  // inside a marketing church. The second arm is not decoration: an account
  // created by REGISTERING against a marketing plant (an invite link, a team
  // member) carries `church_id` and no network id, so the network-only scope
  // left it behind and the `churches` delete below then failed on
  // `users_church_id_churches_id_fk`. Cleanup scope must match every FK INTO the
  // namespace, not the one the seeder happens to write.
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      churchIds.length > 0
        ? or(
            eq(users.sendingNetworkId, networkId),
            inArray(users.churchId, churchIds)
          )
        : eq(users.sendingNetworkId, networkId)
    );
  const userIds = userRows.map((r) => r.id);

  if (churchIds.length > 0) {
    // Phase-engine output first — its church FKs do not cascade.
    await db
      .delete(insightFeedback)
      .where(inArray(insightFeedback.churchId, churchIds));
    await db
      .delete(plantInsights)
      .where(inArray(plantInsights.churchId, churchIds));
    await db
      .delete(plantAssessments)
      .where(inArray(plantAssessments.churchId, churchIds));
    await db
      .delete(phaseTransitions)
      .where(inArray(phaseTransitions.churchId, churchIds));
    await db
      .delete(plantSignals)
      .where(inArray(plantSignals.churchId, churchIds));
    await db
      .delete(churchPrivacySettings)
      .where(inArray(churchPrivacySettings.churchId, churchIds));

    // The launch entity (#305/LS-001). Its journal, milestones and milestone
    // links all cascade from `launches`, but the launch itself must go before
    // `users` — `launch_events.actor_user_id` points at the planter and that FK
    // does not cascade — and before `churches`, whose FK does not either.
    await db.delete(launches).where(inArray(launches.churchId, churchIds));

    // Notifications (deliveries cascade from notifications, explicit anyway).
    const notificationRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(inArray(notifications.churchId, churchIds));
    const notificationIds = notificationRows.map((r) => r.id);
    if (notificationIds.length > 0) {
      await db
        .delete(notificationDeliveries)
        .where(inArray(notificationDeliveries.notificationId, notificationIds));
    }
    await db
      .delete(notifications)
      .where(inArray(notifications.churchId, churchIds));

    // Communication.
    await db
      .delete(meetingConfirmationTokens)
      .where(inArray(meetingConfirmationTokens.churchId, churchIds));
    await db
      .delete(communicationRecipients)
      .where(inArray(communicationRecipients.churchId, churchIds));
    await db
      .delete(communications)
      .where(inArray(communications.churchId, churchIds));
    await db
      .delete(messageTemplates)
      .where(inArray(messageTemplates.churchId, churchIds));

    // Tasks reference users (assigned_to) — must go before users.
    await db.delete(tasks).where(inArray(tasks.churchId, churchIds));

    // Meetings.
    await db
      .delete(meetingChecklistItems)
      .where(inArray(meetingChecklistItems.churchId, churchIds));
    await db
      .delete(meetingEvaluations)
      .where(inArray(meetingEvaluations.churchId, churchIds));
    await db
      .delete(invitations)
      .where(inArray(invitations.churchId, churchIds));
    await db
      .delete(meetingAttendance)
      .where(inArray(meetingAttendance.churchId, churchIds));
    await db
      .delete(churchMeetings)
      .where(inArray(churchMeetings.churchId, churchIds));
    await db.delete(locations).where(inArray(locations.churchId, churchIds));

    // Teams & training.
    await db
      .delete(trainingCompletions)
      .where(inArray(trainingCompletions.churchId, churchIds));
    await db
      .delete(teamMemberships)
      .where(inArray(teamMemberships.churchId, churchIds));
    await db.delete(teamRoles).where(inArray(teamRoles.churchId, churchIds));
    await db
      .delete(trainingPrograms)
      .where(inArray(trainingPrograms.churchId, churchIds));
    // ministry_teams.leader_id → persons; teams go before persons.
    await db
      .delete(ministryTeams)
      .where(inArray(ministryTeams.churchId, churchIds));

    // People.
    await db
      .delete(personActivities)
      .where(inArray(personActivities.churchId, churchIds));
    await db.delete(personTags).where(inArray(personTags.churchId, churchIds));
    await db
      .delete(skillsInventory)
      .where(inArray(skillsInventory.churchId, churchIds));
    await db.delete(interviews).where(inArray(interviews.churchId, churchIds));
    await db
      .delete(commitments)
      .where(inArray(commitments.churchId, churchIds));
    await db.delete(persons).where(inArray(persons.churchId, churchIds));
    await db.delete(tags).where(inArray(tags.churchId, churchIds));
    await db.delete(households).where(inArray(households.churchId, churchIds));
  }

  // Oversight associations and the invitations behind them (#23/#303). These
  // are NOT seeded by this script — they are created by using the product
  // against the marketing network — but they FK into the marketing users,
  // churches and orgs, so a clean run has to sweep them or the `users` delete
  // below fails on `organization_invitations_inviter_user_id_users_id_fk`. That
  // is exactly what it did the first time this script was run after #305's
  // migration, on a dev database where invitations had since been created.
  // Audit rows go first: `association_events.source_invitation_id` points at an
  // invitation and `actor_user_id` at a user, and neither FK cascades.
  const invitationScope = [
    userIds.length > 0
      ? inArray(organizationInvitations.inviterUserId, userIds)
      : null,
    userIds.length > 0
      ? inArray(organizationInvitations.respondedBy, userIds)
      : null,
    churchIds.length > 0
      ? inArray(organizationInvitations.targetChurchId, churchIds)
      : null,
    sendingChurchIds.length > 0
      ? inArray(organizationInvitations.targetSendingChurchId, sendingChurchIds)
      : null,
    sendingChurchIds.length > 0
      ? inArray(organizationInvitations.sendingChurchId, sendingChurchIds)
      : null,
    eq(organizationInvitations.sendingNetworkId, networkId),
  ].filter((clause) => clause !== null);

  if (churchIds.length > 0) {
    await db
      .delete(associationEvents)
      .where(inArray(associationEvents.churchId, churchIds));
  }
  if (userIds.length > 0) {
    await db
      .delete(associationEvents)
      .where(inArray(associationEvents.actorUserId, userIds));
  }
  await db.delete(organizationInvitations).where(or(...invitationScope));

  if (userIds.length > 0) {
    // Wiki progress/bookmarks are user-scoped, not church-scoped.
    await db.delete(wikiProgress).where(inArray(wikiProgress.userId, userIds));
    await db
      .delete(wikiBookmarks)
      .where(inArray(wikiBookmarks.userId, userIds));
    // Sessions + notification preferences cascade from the user delete.
    await db.delete(users).where(inArray(users.id, userIds));
  }

  if (churchIds.length > 0) {
    await db.delete(churches).where(inArray(churches.id, churchIds));
  }
  if (sendingChurchIds.length > 0) {
    await db
      .delete(sendingChurches)
      .where(inArray(sendingChurches.id, sendingChurchIds));
  }
  await db.delete(sendingNetworks).where(eq(sendingNetworks.id, networkId));

  console.log(
    `   Removed ${churchIds.length} churches, ${userIds.length} users, and the marketing network.\n`
  );
}

// ============================================================================
// Backdating — event-generated rows are stamped at run time, which makes the
// dashboard's "Recent Activity" read "3m ago" six times in a row. Every row
// the REAL handlers created during this run (createdAt >= SCRIPT_START) gets
// re-dated to when its cause plausibly happened. Hand-inserted rows carry
// explicit past dates and are untouched by the >= guard.
// ============================================================================

const SCRIPT_START = new Date(NOW.getTime() - 60 * 1000);

async function backdateEventArtifacts(
  churchId: string,
  opts: {
    /** Spread (days-ago window) for team-staffing status advances. */
    activitySpread: [number, number];
  }
): Promise<void> {
  const [minDays, maxDays] = opts.activitySpread;
  const window = Math.max(1, maxDays - minDays);

  // 1. Status-advance activity rows written by the auto-advance handlers
  //    (core_group → launch_team → leader) during team staffing.
  const freshActivities = await db
    .select({ id: personActivities.id, createdAt: personActivities.createdAt })
    .from(personActivities)
    .where(eq(personActivities.churchId, churchId));
  let i = 0;
  for (const row of freshActivities) {
    if (row.createdAt < SCRIPT_START) continue;
    const when = daysAgo(minDays + ((i * 7) % window) + (i % 3) * 0.31);
    await db
      .update(personActivities)
      .set({ createdAt: when })
      .where(eq(personActivities.id, row.id));
    i++;
  }

  // 2. Persons the advance handlers touched (updatedAt = now) — spread them
  //    so the people list doesn't show a same-minute burst.
  const freshPersons = await db
    .select({ id: persons.id, updatedAt: persons.updatedAt })
    .from(persons)
    .where(eq(persons.churchId, churchId));
  let j = 0;
  for (const row of freshPersons) {
    if (row.updatedAt < SCRIPT_START) continue;
    await db
      .update(persons)
      .set({ updatedAt: daysAgo(2 + ((j * 5) % window)) })
      .where(eq(persons.id, row.id));
    j++;
  }

  // 3. Completed meetings — finalize (and raw insert) stamps updatedAt at run
  //    time; re-date to the morning after each meeting so the feed reads
  //    "completed with N attendees" back when it happened.
  const freshMeetings = await db
    .select({
      id: churchMeetings.id,
      datetime: churchMeetings.datetime,
      updatedAt: churchMeetings.updatedAt,
    })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.status, "completed")
      )
    );
  for (const m of freshMeetings) {
    if (m.updatedAt < SCRIPT_START) continue;
    await db
      .update(churchMeetings)
      .set({
        updatedAt: atHour(new Date(m.datetime.getTime() + MS_PER_DAY), 9),
      })
      .where(eq(churchMeetings.id, m.id));
  }

  // 4. Handler-created tasks carry createdAt = run time; a task completed
  //    weeks before it was created is nonsense. Anchor createdAt just before
  //    its own timeline (completedAt for done rows, dueDate−2d for open).
  const freshTasks = await db
    .select({
      id: tasks.id,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .where(and(eq(tasks.churchId, churchId), isNull(tasks.deletedAt)));
  let openIdx = 0;
  for (const t of freshTasks) {
    if (t.createdAt < SCRIPT_START) continue;
    const anchor = t.completedAt
      ? new Date(t.completedAt.getTime() - 2 * MS_PER_DAY)
      : t.dueDate
        ? new Date(new Date(t.dueDate).getTime() - 3 * MS_PER_DAY)
        : daysAgo(5);
    // Open tasks with future due dates would anchor in the future — those
    // were "created" over the past two weeks instead, staggered.
    const createdAt = anchor > NOW ? daysAgo(1 + (openIdx++ % 13)) : anchor;
    await db.update(tasks).set({ createdAt }).where(eq(tasks.id, t.id));
  }

  // 5. Notifications — stagger arrival so the bell feed isn't one burst.
  //    scheduledFor moves with createdAt (it is the feed's visibility gate).
  const freshNotifications = await db
    .select({ id: notifications.id, createdAt: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.churchId, churchId))
    .orderBy(notifications.createdAt);
  const NOTIFICATION_HOURS_AGO = [2, 26, 49, 73];
  let k = 0;
  for (const row of freshNotifications) {
    if (row.createdAt < SCRIPT_START) continue;
    const hoursAgo = NOTIFICATION_HOURS_AGO[k % NOTIFICATION_HOURS_AGO.length];
    const when = new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);
    await db
      .update(notifications)
      .set({ createdAt: when, scheduledFor: when })
      .where(eq(notifications.id, row.id));
    k++;
  }
}

// ============================================================================
// Shared service loader — dynamic so `@/db` initializes after config().
// ============================================================================

async function loadServices() {
  const meetings = await import("../src/lib/meetings/service");
  const teams = await import("../src/lib/ministry-teams/service");
  const notificationsLib = await import("../src/lib/notifications/enqueue");
  return { meetings, teams, notificationsLib };
}

type Services = Awaited<ReturnType<typeof loadServices>>;

// ============================================================================
// Redemption Hill Church — the main pre-launch plant
// ============================================================================

interface RedemptionHillIds {
  churchId: string;
  planterUserId: string;
}

// ============================================================================
// The launch entity (#305 / LS-001)
// ============================================================================

/**
 * Seed a plant's launch AND its journal.
 *
 * Written directly rather than through `setLaunchDate` on purpose: the service
 * announces the milestone to oversight, and a seed run that emailed a network
 * admin about six invented date changes would be indistinguishable from the
 * product misbehaving. The ROWS are what the surfaces read, so the rows are what
 * this writes — including the journal, which is the only reason a seeded plant's
 * `/launch` history is not blank.
 */
async function seedScheduledLaunch(input: {
  churchId: string;
  planterId: string;
  targetDate: string;
  /** A previous date, so the journal has a `moved` entry as well as the first. */
  movedFrom?: string;
}): Promise<string> {
  const [launch] = await db
    .insert(launches)
    .values({
      churchId: input.churchId,
      targetDate: input.targetDate,
      status: "scheduled",
    })
    .returning({ id: launches.id });

  const journal: (typeof launchEvents.$inferInsert)[] = [
    {
      launchId: launch.id,
      churchId: input.churchId,
      event: "scheduled",
      previousTargetDate: null,
      targetDate: input.movedFrom ?? input.targetDate,
      previousStatus: "planning",
      status: "scheduled",
      actorUserId: input.planterId,
    },
  ];
  if (input.movedFrom) {
    journal.push({
      launchId: launch.id,
      churchId: input.churchId,
      event: "moved",
      previousTargetDate: input.movedFrom,
      targetDate: input.targetDate,
      previousStatus: "scheduled",
      status: "scheduled",
      actorUserId: input.planterId,
    });
  }
  await db.insert(launchEvents).values(journal);

  return launch.id;
}

/** A launch that already happened, with its outcome recorded (LS-006). */
async function seedCompletedLaunch(input: {
  churchId: string;
  planterId: string;
  targetDate: string;
  attendanceCount: number;
  decisionsCount: number;
  outcomeNotes: string;
  captureTheDay: string;
}): Promise<string> {
  const [launch] = await db
    .insert(launches)
    .values({
      churchId: input.churchId,
      targetDate: input.targetDate,
      status: "completed",
      outcomeRecordedAt: new Date(`${input.targetDate}T18:00:00.000Z`),
      attendanceCount: input.attendanceCount,
      decisionsCount: input.decisionsCount,
      outcomeNotes: input.outcomeNotes,
      captureTheDay: input.captureTheDay,
    })
    .returning({ id: launches.id });

  await db.insert(launchEvents).values([
    {
      launchId: launch.id,
      churchId: input.churchId,
      event: "scheduled",
      previousTargetDate: null,
      targetDate: input.targetDate,
      previousStatus: "planning",
      status: "scheduled",
      actorUserId: input.planterId,
    },
    {
      launchId: launch.id,
      churchId: input.churchId,
      event: "completed",
      previousTargetDate: input.targetDate,
      targetDate: input.targetDate,
      previousStatus: "scheduled",
      status: "completed",
      actorUserId: input.planterId,
    },
  ]);

  return launch.id;
}

async function seedRedemptionHill(
  networkId: string,
  sendingChurchId: string,
  passwordHash: string,
  services: Services
): Promise<RedemptionHillIds> {
  console.log(`🌱 Seeding ${RH_CHURCH_NAME}…`);
  const { meetings, teams, notificationsLib } = services;

  const LAUNCH = daysAhead(28);

  const [church] = await db
    .insert(churches)
    .values({
      name: RH_CHURCH_NAME,
      currentPhase: 4,
      sendingNetworkId: networkId,
      sendingChurchId,
    })
    .returning({ id: churches.id });
  const churchId = church.id;

  // Planter user first — the follow-up task handler resolves the church's
  // planter at finalization time, so church_id must already be set.
  const [daniel] = await db
    .insert(users)
    .values({
      email: RH_PLANTER_EMAIL,
      name: "Daniel Reyes",
      role: "planter",
      passwordHash,
      churchId,
      sendingNetworkId: networkId,
      sendingChurchId,
    })
    .returning({ id: users.id });
  const planterId = daniel.id;

  // The launch entity (#305/LS-001) — the day used to be a column on the church
  // row above. It is seeded AFTER the planter because the journal names an
  // actor, and the journal is seeded too: a plant whose launch has no history
  // is not a plant the `/launch` page has anything to show.
  await seedScheduledLaunch({
    churchId,
    planterId,
    targetDate: dateOnly(LAUNCH),
    // Redemption Hill moved its date once, six weeks out — the shape every
    // countdown surface and the milestone notification are built around.
    movedFrom: dateOnly(daysAhead(21)),
  });

  // ------------------------------------------------------------------
  // Households + the catalog cast
  // ------------------------------------------------------------------
  const [riveraHousehold] = await db
    .insert(households)
    .values({
      churchId,
      name: "The Rivera Family",
      addressLine1: "1418 Sagebrush Ln",
      city: "Denton",
      state: "TX",
      postalCode: "76205",
    })
    .returning({ id: households.id });
  const [okaforHousehold] = await db
    .insert(households)
    .values({
      churchId,
      name: "The Okafor Family",
      addressLine1: "922 Old Alton Rd",
      city: "Denton",
      state: "TX",
      postalCode: "76210",
    })
    .returning({ id: households.id });

  type PersonInsert = typeof persons.$inferInsert;

  const castRows: PersonInsert[] = [
    // Daniel himself — senior pastor, leads the plant.
    {
      churchId,
      firstName: "Daniel",
      lastName: "Reyes",
      email: RH_PLANTER_EMAIL,
      status: "leader",
      source: "other",
      notes: "Planter. Sent out of Grace Fellowship Denton in January.",
      createdBy: planterId,
      createdAt: daysAgo(160),
      updatedAt: daysAgo(1),
    },
    // Rivera family — committed early, host the Vision Nights.
    {
      churchId,
      firstName: "Miguel",
      lastName: "Rivera",
      status: "core_group",
      source: "personal_referral",
      householdId: riveraHousehold.id,
      householdRole: "head",
      notes:
        "Hosts Vision Nights in their living room. Ask about leading a small group after launch.",
      createdBy: planterId,
      createdAt: daysAgo(140),
      updatedAt: daysAgo(2),
    },
    {
      churchId,
      firstName: "Elena",
      lastName: "Rivera",
      status: "core_group",
      source: "personal_referral",
      householdId: riveraHousehold.id,
      householdRole: "spouse",
      notes: "Dinner Thu · 7pm — planning the launch-day welcome table.",
      createdBy: planterId,
      createdAt: daysAgo(140),
      updatedAt: daysAgo(2),
    },
    {
      churchId,
      firstName: "Sofia",
      lastName: "Rivera",
      status: "attendee",
      source: "personal_referral",
      householdId: riveraHousehold.id,
      householdRole: "child",
      createdBy: planterId,
      createdAt: daysAgo(140),
      updatedAt: daysAgo(14),
    },
    {
      churchId,
      firstName: "Mateo",
      lastName: "Rivera",
      status: "attendee",
      source: "personal_referral",
      householdId: riveraHousehold.id,
      householdRole: "child",
      createdBy: planterId,
      createdAt: daysAgo(140),
      updatedAt: daysAgo(14),
    },
    // Okafor family — committed recently, kids-ministry hearts.
    {
      churchId,
      firstName: "Chidi",
      lastName: "Okafor",
      status: "core_group",
      source: "vision_meeting",
      householdId: okaforHousehold.id,
      householdRole: "head",
      notes: "Kids team ask — Amara and Chidi both said yes to serving.",
      createdBy: planterId,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(3),
    },
    {
      churchId,
      firstName: "Amara",
      lastName: "Okafor",
      status: "core_group",
      source: "vision_meeting",
      householdId: okaforHousehold.id,
      householdRole: "spouse",
      notes: "Taught 2nd grade for six years — natural fit for kids check-in.",
      createdBy: planterId,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(3),
    },
    {
      churchId,
      firstName: "Zara",
      lastName: "Okafor",
      status: "attendee",
      source: "vision_meeting",
      householdId: okaforHousehold.id,
      householdRole: "child",
      createdBy: planterId,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(21),
    },
    {
      churchId,
      firstName: "Emeka",
      lastName: "Okafor",
      status: "attendee",
      source: "vision_meeting",
      householdId: okaforHousehold.id,
      householdRole: "child",
      createdBy: planterId,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(21),
    },
    // Individual cast.
    {
      churchId,
      firstName: "Dana",
      lastName: "Whitfield",
      status: "attendee",
      source: "personal_referral",
      notes:
        "Met at the farmers market. Came to VN #3 and #4 — interested but cautious. Invite to Vision Night #5.",
      createdBy: planterId,
      createdAt: daysAgo(35),
      updatedAt: daysAgo(4),
    },
    {
      churchId,
      firstName: "Sam",
      lastName: "Torres",
      status: "attendee",
      source: "social_media",
      notes: "Found us on Instagram. Follow-up call Friday.",
      createdBy: planterId,
      createdAt: daysAgo(12),
      updatedAt: daysAgo(5),
    },
    {
      churchId,
      firstName: "Grace",
      lastName: "Lin",
      status: "following_up",
      source: "website",
      notes: "Coffee next week — asked good questions about the vision.",
      createdBy: planterId,
      createdAt: daysAgo(9),
      updatedAt: daysAgo(2),
    },
    {
      churchId,
      firstName: "J. P.",
      lastName: "Holloway",
      status: "prospect",
      source: "event",
      notes: "First conversation at the neighborhood cookout.",
      createdBy: planterId,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
    },
  ];

  castRows.forEach((row, i) => {
    if (!row.email && !row.phone) {
      const info = contactInfo(row.firstName, row.lastName, i);
      row.email = info.email;
      row.phone = info.phone;
    }
  });

  const cast = await db.insert(persons).values(castRows).returning({
    id: persons.id,
    firstName: persons.firstName,
    lastName: persons.lastName,
  });
  const byName = new Map(
    cast.map((p) => [`${p.firstName} ${p.lastName}`, p.id])
  );
  const danielPersonId = byName.get("Daniel Reyes")!;
  const miguelId = byName.get("Miguel Rivera")!;
  const elenaId = byName.get("Elena Rivera")!;
  const chidiId = byName.get("Chidi Okafor")!;
  const amaraId = byName.get("Amara Okafor")!;
  const danaId = byName.get("Dana Whitfield")!;
  const samId = byName.get("Sam Torres")!;
  const graceId = byName.get("Grace Lin")!;

  // ------------------------------------------------------------------
  // Filler people. Buckets sum with the cast + Daniel to 142 total:
  //   leaders 8 → team leadership (core_group now, events advance to leader)
  //   roster 18 → team members  (core_group now, events advance to launch_team)
  //   core   30 → stay core_group (with the 4 cast adults = 34)
  //   attendee 15 (+ Dana, Sam, 4 kids = 21)
  //   following_up 37 (+ Grace = 38)
  //   interviewed 8
  //   prospect 13 (+ J. P. = 14)
  // ------------------------------------------------------------------
  interface FillerBucket {
    count: number;
    status: PersonInsert["status"];
    /** createdAt spread start/step (days ago). */
    createdStart: number;
    createdStep: number;
    /** updatedAt (days ago); a fn so buckets can mix fresh + stale. */
    updatedAt: (i: number) => number;
    source: PersonInsert["source"];
  }

  const buckets: Record<string, FillerBucket> = {
    leaders: {
      count: 8,
      status: "core_group",
      createdStart: 150,
      createdStep: 4,
      updatedAt: (i) => 3 + (i % 5),
      source: "personal_referral",
    },
    roster: {
      count: 18,
      status: "core_group",
      createdStart: 130,
      createdStep: 3,
      updatedAt: (i) => 4 + (i % 7),
      source: "vision_meeting",
    },
    core: {
      count: 30,
      status: "core_group",
      createdStart: 120,
      createdStep: 3,
      updatedAt: (i) => 5 + (i % 9),
      source: "vision_meeting",
    },
    attendee: {
      count: 15,
      status: "attendee",
      createdStart: 45,
      createdStep: 2,
      updatedAt: (i) => 2 + (i % 8),
      source: "vision_meeting",
    },
    followingUp: {
      count: 37,
      status: "following_up",
      createdStart: 40,
      createdStep: 1,
      // Mostly fresh follow-ups with a stale tail (a deliberate soft spot
      // for the assessment's "worth a look").
      updatedAt: (i) => (i < 29 ? 2 + (i % 9) : 18 + i),
      source: "personal_referral",
    },
    interviewed: {
      count: 8,
      status: "interviewed",
      createdStart: 70,
      createdStep: 2,
      updatedAt: (i) => 6 + i,
      source: "vision_meeting",
    },
    prospect: {
      count: 13,
      status: "prospect",
      createdStart: 20,
      createdStep: 1,
      updatedAt: (i) => 1 + (i % 6),
      source: "social_media",
    },
  };

  const fillerIds: Record<string, string[]> = {};
  let nameIndex = 0;
  for (const [key, bucket] of Object.entries(buckets)) {
    const rows: PersonInsert[] = [];
    for (let i = 0; i < bucket.count; i++) {
      const { firstName, lastName } = fillerName(nameIndex++);
      const info = contactInfo(firstName, lastName, nameIndex);
      rows.push({
        churchId,
        firstName,
        lastName,
        email: info.email,
        phone: info.phone,
        status: bucket.status,
        source: bucket.source,
        createdBy: planterId,
        createdAt: daysAgo(bucket.createdStart - i * bucket.createdStep),
        updatedAt: daysAgo(bucket.updatedAt(i)),
      });
    }
    const inserted = await db
      .insert(persons)
      .values(rows)
      .returning({ id: persons.id });
    fillerIds[key] = inserted.map((r) => r.id);
  }

  // ------------------------------------------------------------------
  // Tags for the cast (color + name straight off the pipeline shots).
  // ------------------------------------------------------------------
  const tagRows = await db
    .insert(tags)
    .values([
      { churchId, name: "Host home", color: "#0B7A3F" },
      { churchId, name: "Kids team", color: "#B45309" },
      { churchId, name: "Musician", color: "#1D4ED8" },
      { churchId, name: "Neighbor", color: "#6D28D9" },
    ])
    .returning({ id: tags.id, name: tags.name });
  const tagByName = new Map(tagRows.map((t) => [t.name, t.id]));
  await db.insert(personTags).values([
    { churchId, personId: miguelId, tagId: tagByName.get("Host home")! },
    { churchId, personId: elenaId, tagId: tagByName.get("Host home")! },
    { churchId, personId: chidiId, tagId: tagByName.get("Kids team")! },
    { churchId, personId: amaraId, tagId: tagByName.get("Kids team")! },
    { churchId, personId: samId, tagId: tagByName.get("Musician")! },
    { churchId, personId: danaId, tagId: tagByName.get("Neighbor")! },
  ]);

  // ------------------------------------------------------------------
  // Commitments. 58 core-group commitments (all committed-track people);
  // first-commitment dates place 6 in the trailing 28d window vs 3 in the
  // prior window → growth delta +3 ("+3 this month"). Launch-team
  // commitments land on 34 people — "34 of 50 adults committed to launch".
  // ------------------------------------------------------------------
  const committedTrack: string[] = [
    miguelId,
    elenaId,
    ...fillerIds.leaders,
    ...fillerIds.roster,
    chidiId,
    amaraId,
    ...fillerIds.core,
  ];

  const coreCommitmentRows: (typeof commitments.$inferInsert)[] =
    committedTrack.map((personId, i) => {
      // Okafors (indices 28, 29) signed recently; a burst of 6 in-window,
      // 3 in the prior window, the rest spread 50–130 days back.
      let signedDaysAgo: number;
      if (personId === chidiId || personId === amaraId) signedDaysAgo = 10;
      else if (i < 3)
        signedDaysAgo = 40 + i; // prior window
      else if (i < 7)
        signedDaysAgo = 8 + i; // in-window (4 + the 2 Okafors = 6)
      else signedDaysAgo = 57 + ((i * 3) % 70); // strictly past both windows
      return {
        churchId,
        personId,
        commitmentType: "core_group",
        signedDate: dateOnly(daysAgo(signedDaysAgo)),
        witnessedBy: planterId,
      };
    });
  await db.insert(commitments).values(coreCommitmentRows);

  const launchCommitted = [
    miguelId,
    elenaId,
    ...fillerIds.leaders,
    ...fillerIds.roster,
    ...fillerIds.core.slice(0, 6),
  ]; // 34 people
  await db.insert(commitments).values(
    launchCommitted.map((personId, i) => ({
      churchId,
      personId,
      commitmentType: "launch_team" as const,
      signedDate: dateOnly(daysAgo(5 + ((i * 2) % 35))),
      witnessedBy: planterId,
    }))
  );

  // Interviews for the 8 interviewed-status people (5-criteria, passed).
  await db.insert(interviews).values(
    fillerIds.interviewed.map((personId, i) => ({
      churchId,
      personId,
      interviewedBy: planterId,
      interviewDate: dateOnly(daysAgo(6 + i * 2)),
      maturityStatus: "pass" as const,
      giftedStatus: "pass" as const,
      chemistryStatus: "pass" as const,
      rightReasonsStatus:
        i % 3 === 0 ? ("concern" as const) : ("pass" as const),
      seasonStatus: "pass" as const,
      overallResult:
        i % 3 === 0
          ? ("qualified_with_notes" as const)
          : ("qualified" as const),
      nextSteps: "Invite to the next orientation.",
    }))
  );

  // ------------------------------------------------------------------
  // Ministry teams — created and staffed through the real service so the
  // auto-advance events fire (core_group → launch_team → leader) and the
  // phase engine sees genuine role coverage. Small Groups stays forming
  // and leaderless — a real, visible gap for the assessment to notice.
  // ------------------------------------------------------------------
  const createdTeams = await teams.initializePredefinedTeams(
    churchId,
    planterId
  );
  const teamByKeyName = new Map(createdTeams.map((t) => [t.name, t]));

  const STAFFING: {
    teamName: string;
    teamKey:
      | "senior_pastor"
      | "launch_coordinator"
      | "worship"
      | "childrens_ministry"
      | "facilities"
      | "assimilation"
      | "small_groups"
      | "promotion"
      | "prayer"
      | "technology";
    leaderId: string | null;
    memberIds: string[];
  }[] = [
    {
      teamName: "Senior Pastor",
      teamKey: "senior_pastor",
      leaderId: danielPersonId,
      memberIds: [],
    },
    {
      teamName: "Launch Coordinator",
      teamKey: "launch_coordinator",
      leaderId: fillerIds.leaders[0],
      memberIds: [],
    },
    {
      teamName: "Worship Team",
      teamKey: "worship",
      leaderId: fillerIds.leaders[1],
      memberIds: fillerIds.roster.slice(0, 4),
    },
    {
      teamName: "Children's Ministry",
      teamKey: "childrens_ministry",
      leaderId: fillerIds.leaders[2],
      memberIds: fillerIds.roster.slice(4, 9),
    },
    {
      teamName: "Assimilation & Welcome",
      teamKey: "assimilation",
      leaderId: fillerIds.leaders[3],
      memberIds: fillerIds.roster.slice(9, 13),
    },
    {
      teamName: "Technology & AV",
      teamKey: "technology",
      leaderId: fillerIds.leaders[4],
      memberIds: fillerIds.roster.slice(13, 16),
    },
    {
      teamName: "Prayer Team",
      teamKey: "prayer",
      leaderId: fillerIds.leaders[5],
      memberIds: fillerIds.roster.slice(16, 18),
    },
    {
      teamName: "Facilities & Setup",
      teamKey: "facilities",
      leaderId: fillerIds.leaders[6],
      memberIds: [],
    },
    {
      teamName: "Promotion & Outreach",
      teamKey: "promotion",
      leaderId: fillerIds.leaders[7],
      memberIds: [],
    },
  ];

  const teamIdByName = new Map<string, string>();
  for (const staffing of STAFFING) {
    // Team names come from the templates; match loosely on the first word so
    // template renames ("Prayer" vs "Prayer Team") don't silently skip a team.
    const team =
      teamByKeyName.get(staffing.teamName) ??
      createdTeams.find((t) =>
        t.name
          .toLowerCase()
          .startsWith(staffing.teamName.split(" ")[0].toLowerCase())
      );
    if (!team) {
      throw new Error(`Predefined team not found: ${staffing.teamName}`);
    }
    teamIdByName.set(staffing.teamName, team.id);

    const roles = await teams.importRoleTemplates(
      churchId,
      team.id,
      planterId,
      staffing.teamKey
    );
    const leadershipRole = roles.find((r) => r.isLeadershipRole) ?? roles[0];
    const memberRole = roles.find((r) => !r.isLeadershipRole) ?? leadershipRole;

    if (staffing.leaderId) {
      // assignMember fires team.member.assigned (+ leader advance for
      // leadership roles); assignTeamLeader stamps ministry_teams.leader_id.
      await teams.assignMember(
        churchId,
        team.id,
        leadershipRole.id,
        staffing.leaderId,
        planterId
      );
      await teams.assignTeamLeader(
        churchId,
        team.id,
        staffing.leaderId,
        planterId
      );
    }
    for (const memberId of staffing.memberIds) {
      await teams.assignMember(
        churchId,
        team.id,
        memberRole.id,
        memberId,
        planterId
      );
    }
    await db
      .update(ministryTeams)
      .set({ status: "active" })
      .where(eq(ministryTeams.id, team.id));
  }

  // Admin & Finance has no predefined template, but it IS one of the 8
  // canonical ministry roles the phase engine tracks — without it the role
  // signal caps at 6/8 with no way for the planter to close the gap. The
  // launch coordinator wears this hat too (common in real plants), leaving
  // Small Groups as the one honest vacancy (7/8).
  {
    const adminTeam = await teams.createTeam(churchId, planterId, {
      name: "Admin & Finance",
      description: "Budget, giving records, insurance and filings.",
      icon: "calculator",
    });
    const adminRole = await teams.createRole(
      churchId,
      adminTeam.id,
      planterId,
      {
        name: "Finance Lead",
        isLeadershipRole: true,
        timeCommitment: "medium",
      }
    );
    await teams.assignMember(
      churchId,
      adminTeam.id,
      adminRole.id,
      fillerIds.leaders[0],
      planterId
    );
    await teams.assignTeamLeader(
      churchId,
      adminTeam.id,
      fillerIds.leaders[0],
      planterId
    );
    await db
      .update(ministryTeams)
      .set({ status: "active" })
      .where(eq(ministryTeams.id, adminTeam.id));
    teamIdByName.set("Admin & Finance", adminTeam.id);
  }

  // ------------------------------------------------------------------
  // Training — the catalog bars: Worship 4/5 · Kids 3/6 · Hospitality 5/5 ·
  // Production 2/4 · Prayer 3/3 (17 of 23 trained), plus a required
  // church-wide orientation at ~80% among the committed.
  // ------------------------------------------------------------------
  const TRAINING: {
    teamName: string;
    programName: string;
    trainees: string[]; // leader first, then members
    completions: number;
  }[] = [
    {
      teamName: "Worship Team",
      programName: "Worship team training",
      trainees: [fillerIds.leaders[1], ...fillerIds.roster.slice(0, 4)],
      completions: 4,
    },
    {
      teamName: "Children's Ministry",
      programName: "Kids ministry & safety training",
      trainees: [fillerIds.leaders[2], ...fillerIds.roster.slice(4, 9)],
      completions: 3,
    },
    {
      teamName: "Assimilation & Welcome",
      programName: "Hospitality training",
      trainees: [fillerIds.leaders[3], ...fillerIds.roster.slice(9, 13)],
      completions: 5,
    },
    {
      teamName: "Technology & AV",
      programName: "Production training",
      trainees: [fillerIds.leaders[4], ...fillerIds.roster.slice(13, 16)],
      completions: 2,
    },
    {
      teamName: "Prayer Team",
      programName: "Prayer team training",
      trainees: [fillerIds.leaders[5], ...fillerIds.roster.slice(16, 18)],
      completions: 3,
    },
  ];

  for (const t of TRAINING) {
    const program = await teams.createTrainingProgram(churchId, planterId, {
      name: t.programName,
      teamId: teamIdByName.get(t.teamName),
      // Team-specific, not church-required: the required-completion signal
      // reads (completions ÷ required-programs × committed), so only the
      // church-wide orientation below carries isRequired.
      isRequired: false,
    });
    for (let i = 0; i < t.completions; i++) {
      await teams.markTrainingComplete(
        churchId,
        t.trainees[i],
        program.id,
        planterId
      );
    }
  }

  const orientation = await teams.createTrainingProgram(churchId, planterId, {
    name: "Launch Team Orientation",
    description: "Required onboarding for everyone serving on launch day.",
    isRequired: true,
  });
  const orientationDone = committedTrack.filter((_, i) => i % 5 !== 4); // ~80%
  for (const personId of orientationDone) {
    await teams.markTrainingComplete(
      churchId,
      personId,
      orientation.id,
      planterId
    );
  }
  // Back-date the completions so they read as history, not a single burst.
  const completionRows = await db
    .select({ id: trainingCompletions.id })
    .from(trainingCompletions)
    .where(eq(trainingCompletions.churchId, churchId));
  for (let i = 0; i < completionRows.length; i++) {
    await db
      .update(trainingCompletions)
      .set({ completedAt: daysAgo(3 + ((i * 5) % 45)) })
      .where(eq(trainingCompletions.id, completionRows[i].id));
  }

  // ------------------------------------------------------------------
  // Locations + Vision Nights #1–#4, run through the REAL pipeline:
  // attendance batch → finalizeAttendance (auto-advance, follow-up tasks,
  // dirty-marking) → evaluations for #1–#3 (auto-completes their eval task).
  // ------------------------------------------------------------------
  const [riverasHome] = await db
    .insert(locations)
    .values({
      churchId,
      name: "The Riveras' home",
      address: "1418 Sagebrush Ln, Denton, TX",
      capacity: 35,
    })
    .returning({ id: locations.id });
  const [schoolGym] = await db
    .insert(locations)
    .values({
      churchId,
      name: "Lakeview Elementary — gym",
      address: "300 Lakeview Blvd, Denton, TX",
      contactName: "Front office",
      capacity: 220,
      cost: "$250/Sunday",
    })
    .returning({ id: locations.id });

  // The attendee pool, ordered so each Vision Night is a prefix + the cast
  // members whose story says they were there. 18 → 21 → 24 → 28.
  const vnPool = [
    miguelId,
    elenaId,
    ...fillerIds.leaders, // 2..9
    ...fillerIds.roster, // 10..27
    ...fillerIds.core, // 28..57
  ];
  const VISION_NIGHTS: {
    number: number;
    daysAgo: number;
    attendees: string[];
    evaluate: boolean;
  }[] = [
    { number: 1, daysAgo: 70, attendees: vnPool.slice(0, 18), evaluate: true },
    { number: 2, daysAgo: 49, attendees: vnPool.slice(0, 21), evaluate: true },
    {
      number: 3,
      daysAgo: 28,
      attendees: [...vnPool.slice(0, 23), danaId],
      evaluate: true,
    },
    {
      number: 4,
      daysAgo: 7,
      attendees: [...vnPool.slice(0, 24), chidiId, amaraId, danaId, samId],
      evaluate: false, // its "Complete evaluation" task stays open — real work
    },
  ];

  const vnMeetingIds: string[] = [];
  for (const vn of VISION_NIGHTS) {
    const [meeting] = await db
      .insert(churchMeetings)
      .values({
        churchId,
        type: "vision_meeting",
        title: `Vision Night #${vn.number}`,
        datetime: atHour(daysAgo(vn.daysAgo), 19),
        status: "completed",
        meetingNumber: vn.number,
        locationId: riverasHome.id,
        locationName: "The Riveras' home",
        estimatedAttendance: vn.attendees.length - 2,
        durationMinutes: 90,
        createdBy: planterId,
      })
      .returning({ id: churchMeetings.id });
    vnMeetingIds.push(meeting.id);

    await meetings.recordAttendanceBatch(
      churchId,
      meeting.id,
      vn.attendees.map((personId) => ({
        personId,
        status: "attended" as const,
      })),
      planterId
    );
    const result = await meetings.finalizeAttendance(churchId, meeting.id);
    console.log(
      `   Vision Night #${vn.number}: ${result.total} attended (${result.outcome})`
    );

    if (vn.evaluate) {
      await meetings.createEvaluation(churchId, meeting.id, planterId, {
        attendanceScore: 3 + (vn.number % 2),
        locationScore: 4,
        logisticsScore: 3 + (vn.number % 2),
        agendaScore: 4,
        vibeScore: 4 + (vn.number > 2 ? 1 : 0),
        messageScore: 4,
        closeScore: 3 + (vn.number % 2),
        nextStepsScore: 4,
        notes: `Vision Night #${vn.number} — room felt full, response cards came back strong.`,
      });
    }
  }

  // Follow-up tasks were created by the real handler with due dates relative
  // to run time. Re-date them to their meeting, complete history, and keep a
  // working set open from VN #4 (Dana, Sam + two more, due this week).
  const followUps = await db
    .select({ id: tasks.id, relatedId: tasks.relatedId, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.category, "follow_up"),
        isNull(tasks.deletedAt)
      )
    );
  const keepOpen = new Set([danaId, samId, vnPool[12], vnPool[20]]);
  const vn4Id = vnMeetingIds[3];
  // Map each follow-up to its meeting via attendance (the task's relatedId is
  // the person). A person can appear across meetings; the LATEST meeting wins,
  // which matches how the handler de-duplicates in-flight follow-ups.
  const attendanceRows = await db
    .select({
      personId: meetingAttendance.personId,
      meetingId: meetingAttendance.meetingId,
    })
    .from(meetingAttendance)
    .where(eq(meetingAttendance.churchId, churchId));
  const latestMeetingByPerson = new Map<string, string>();
  for (const id of vnMeetingIds) {
    for (const row of attendanceRows.filter((r) => r.meetingId === id)) {
      latestMeetingByPerson.set(row.personId, id);
    }
  }
  const vnDaysAgoById = new Map(
    VISION_NIGHTS.map((vn, i) => [vnMeetingIds[i], vn.daysAgo])
  );
  let openCount = 0;
  const alreadyKeptOpen = new Set<string>();
  for (const task of followUps) {
    const meetingId = task.relatedId
      ? latestMeetingByPerson.get(task.relatedId)
      : undefined;
    const meetingDaysAgo = meetingId ? (vnDaysAgoById.get(meetingId) ?? 7) : 7;
    // The handler makes one follow-up per attendee per finalized meeting, so a
    // regular can hold several identical tasks — keep exactly ONE open per
    // person and complete the rest as history.
    const stillOpen =
      meetingId === vn4Id &&
      task.relatedId != null &&
      keepOpen.has(task.relatedId) &&
      !alreadyKeptOpen.has(task.relatedId);
    if (stillOpen) {
      alreadyKeptOpen.add(task.relatedId!);
      openCount++;
      await db
        .update(tasks)
        .set({ dueDate: dateOnly(daysAhead(openCount)) })
        .where(eq(tasks.id, task.id));
    } else {
      await db
        .update(tasks)
        .set({
          status: "complete",
          dueDate: dateOnly(daysAgo(meetingDaysAgo - 2)),
          completedAt: daysAgo(Math.max(meetingDaysAgo - 3, 1)),
          completedById: planterId,
        })
        .where(eq(tasks.id, task.id));
    }
  }
  // The open evaluation task for VN #4 gets a near-term due date too.
  await db
    .update(tasks)
    .set({ dueDate: dateOnly(daysAhead(1)) })
    .where(
      and(
        eq(tasks.churchId, churchId),
        eq(tasks.relatedId, vn4Id),
        eq(tasks.status, "not_started")
      )
    );

  // ------------------------------------------------------------------
  // Upcoming meetings: Worship rehearsal, Orientation #2, Vision Night #5
  // (no location yet — the dashboard task points at it), Launch Sunday
  // with run-sheet notes + the pre-launch checklist.
  // ------------------------------------------------------------------
  await db.insert(churchMeetings).values([
    {
      churchId,
      type: "team_meeting",
      title: "Worship team night",
      datetime: atHour(daysAhead(5), 19),
      status: "planning",
      teamId: teamIdByName.get("Worship Team"),
      meetingSubtype: "rehearsal",
      estimatedAttendance: 8,
      locationId: schoolGym.id,
      locationName: "Lakeview Elementary — gym",
      createdBy: planterId,
    },
    {
      churchId,
      type: "orientation",
      title: "Orientation #2",
      datetime: atHour(daysAhead(10), 18, 30),
      status: "planning",
      estimatedAttendance: 12,
      locationId: riverasHome.id,
      locationName: "The Riveras' home",
      createdBy: planterId,
    },
    {
      churchId,
      type: "vision_meeting",
      title: "Vision Night #5",
      datetime: atHour(daysAhead(14), 19),
      status: "planning",
      meetingNumber: 5,
      estimatedAttendance: 32,
      createdBy: planterId,
    },
  ]);

  const [launchSunday] = await db
    .insert(churchMeetings)
    .values({
      churchId,
      type: "vision_meeting",
      title: "Launch Sunday",
      datetime: atHour(daysAhead(28), 10),
      status: "planning",
      locationId: schoolGym.id,
      locationName: "Lakeview Elementary — gym",
      estimatedAttendance: 120,
      durationMinutes: 75,
      notes:
        "Run sheet — 7:30 setup crew arrives · 8:15 band call · 9:15 doors open · 10:00 service. All teams on site by 8:00.",
      createdBy: planterId,
    })
    .returning({ id: churchMeetings.id });

  await db.insert(meetingChecklistItems).values(
    (
      [
        ["Signage ordered", "materials", true],
        ["Dry run #1 complete", "organization", true],
        ["Promo cards mailed", "materials", true],
        ["Sound system tested in the gym", "av", true],
        ["Print bulletins", "materials", false],
        ["Kids check-in stations set", "setup", false],
        ["Final walkthrough with all teams", "organization", false],
        ["Greeter assignments confirmed", "essential", false],
      ] as const
    ).map(([itemName, category, isChecked]) => ({
      churchId,
      meetingId: launchSunday.id,
      itemName,
      category,
      isChecked,
      createdBy: planterId,
    }))
  );

  // ------------------------------------------------------------------
  // The task board — the catalog cards, on top of the real follow-ups.
  // ------------------------------------------------------------------
  type TaskInsert = typeof tasks.$inferInsert;
  const catalogTasks: TaskInsert[] = [
    // To do
    {
      churchId,
      title: "Find a location for Vision Night #5",
      status: "not_started",
      priority: "urgent",
      category: "vision_meeting",
      dueDate: dateOnly(daysAhead(4)),
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Print connect cards",
      status: "not_started",
      priority: "high",
      category: "launch_prep",
      dueDate: dateOnly(daysAhead(6)),
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Recruit 2 greeters",
      status: "not_started",
      priority: "medium",
      category: "ministry_team",
      dueDate: dateOnly(daysAhead(8)),
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Book sound check at the gym",
      status: "not_started",
      priority: "medium",
      category: "launch_prep",
      dueDate: dateOnly(daysAhead(12)),
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Set up kids classrooms",
      status: "not_started",
      priority: "medium",
      category: "facilities",
      dueDate: dateOnly(daysAhead(20)),
      assignedToId: planterId,
      createdById: planterId,
    },
    // In progress
    {
      churchId,
      title: "Kids check-in kit",
      description: "Labels, lanyards, allergy cards, two tablets.",
      status: "in_progress",
      priority: "high",
      category: "ministry_team",
      dueDate: dateOnly(daysAhead(9)),
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Launch-day run sheet",
      status: "in_progress",
      priority: "high",
      category: "launch_prep",
      dueDate: dateOnly(daysAhead(24)),
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Website go-live",
      status: "in_progress",
      priority: "medium",
      category: "promotion",
      dueDate: dateOnly(daysAhead(14)),
      assignedToId: planterId,
      createdById: planterId,
    },
    // Done
    {
      churchId,
      title: "Reserve school gym",
      status: "complete",
      priority: "urgent",
      category: "facilities",
      dueDate: dateOnly(daysAgo(30)),
      completedAt: daysAgo(30),
      completedById: planterId,
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Order signage",
      status: "complete",
      priority: "medium",
      category: "promotion",
      dueDate: dateOnly(daysAgo(14)),
      completedAt: daysAgo(12),
      completedById: planterId,
      assignedToId: planterId,
      createdById: planterId,
    },
    {
      churchId,
      title: "Insurance filed",
      status: "complete",
      priority: "high",
      category: "administrative",
      dueDate: dateOnly(daysAgo(21)),
      completedAt: daysAgo(20),
      completedById: planterId,
      assignedToId: planterId,
      createdById: planterId,
    },
  ];
  await db.insert(tasks).values(catalogTasks);

  // ------------------------------------------------------------------
  // Wiki progress for Daniel — first chapters done, "building a core
  // group" in flight. Slugs are verified against the DB so a renamed
  // article can never leave dead progress rows.
  // ------------------------------------------------------------------
  const COMPLETED_SLUGS = [
    "discovery/is-church-planting-your-calling",
    "getting-started/welcome-to-the-launch-playbook",
    "frameworks/the-4-pillars",
    "discovery/defining-your-church-values",
  ];
  const IN_PROGRESS_SLUG =
    "core-group/building-your-core-group/growing-your-core-group";
  const BOOKMARK_SLUG = "core-group/vision-meetings/what-is-a-vision-meeting";

  const articleRows = await db
    .select({ slug: wikiArticles.slug })
    .from(wikiArticles)
    .where(
      and(
        inArray(wikiArticles.slug, [
          ...COMPLETED_SLUGS,
          IN_PROGRESS_SLUG,
          BOOKMARK_SLUG,
        ]),
        eq(wikiArticles.status, "published"),
        isNull(wikiArticles.churchId)
      )
    );
  const foundSlugs = new Set(articleRows.map((a) => a.slug));
  const progressRows = [
    ...COMPLETED_SLUGS.filter((s) => foundSlugs.has(s)).map((slug, i) => ({
      userId: planterId,
      articleSlug: slug,
      status: "completed" as const,
      scrollPosition: 1,
      lastViewedAt: daysAgo(20 + i * 8),
      completedAt: daysAgo(20 + i * 8),
    })),
    ...(foundSlugs.has(IN_PROGRESS_SLUG)
      ? [
          {
            userId: planterId,
            articleSlug: IN_PROGRESS_SLUG,
            status: "in_progress" as const,
            scrollPosition: 0.55,
            lastViewedAt: daysAgo(1),
          },
        ]
      : []),
  ];
  if (progressRows.length > 0) {
    await db.insert(wikiProgress).values(progressRows);
  }
  if (foundSlugs.has(BOOKMARK_SLUG)) {
    await db
      .insert(wikiBookmarks)
      .values({ userId: planterId, articleSlug: BOOKMARK_SLUG });
  }
  const missing = [...COMPLETED_SLUGS, IN_PROGRESS_SLUG, BOOKMARK_SLUG].filter(
    (s) => !foundSlugs.has(s)
  );
  if (missing.length > 0) {
    console.warn(
      `   ⚠️  Wiki slugs not found (skipped): ${missing.join(", ")}`
    );
  }

  // ------------------------------------------------------------------
  // Communication history — 2 templates + 3 sent messages with
  // per-recipient delivery states. History rows only; nothing is sent.
  // ------------------------------------------------------------------
  const [inviteTemplate] = await db
    .insert(messageTemplates)
    .values({
      churchId,
      name: "Vision Night invitation",
      category: "meeting_invitation",
      channel: "email",
      subject: "You're invited — Vision Night",
      body: "Hi {{first_name}},\n\nWe'd love to have you at our next Vision Night — an evening to hear what Redemption Hill is about and ask anything.\n\nSee you there,\nDaniel",
      mergeFields: ["first_name"],
    })
    .returning({ id: messageTemplates.id });
  await db.insert(messageTemplates).values({
    churchId,
    name: "Meeting reminder",
    category: "meeting_reminder",
    channel: "email",
    subject: "See you tomorrow night",
    body: "Hi {{first_name}},\n\nJust a reminder — we're on for tomorrow at 7pm at the Riveras'. Bring a friend!\n\nDaniel",
    mergeFields: ["first_name"],
  });

  const SENT_MESSAGES: {
    subject: string;
    body: string;
    meetingId: string | null;
    sentDaysAgo: number;
    recipients: string[];
    templateId?: string;
  }[] = [
    {
      subject: "You're invited — Vision Night #4",
      body: "We'd love to have you Thursday at 7pm at the Riveras'. Come hear where Redemption Hill is headed.",
      meetingId: vn4Id,
      sentDaysAgo: 10,
      recipients: [...vnPool.slice(0, 26), danaId, samId, chidiId, amaraId],
      templateId: inviteTemplate.id,
    },
    {
      subject: "Thanks for coming — next steps",
      body: "Thursday was our biggest night yet — 28 of you in one living room. Here's what's next on the road to launch Sunday.",
      meetingId: vn4Id,
      sentDaysAgo: 4,
      recipients: [...vnPool.slice(0, 24), chidiId, amaraId, danaId, samId],
    },
    {
      subject: "Orientation #2 — details inside",
      body: "If you've committed to the launch team, Orientation #2 is your next step. Sunday the week after next, 6:30pm.",
      meetingId: null,
      sentDaysAgo: 2,
      recipients: launchCommitted.slice(0, 20),
    },
  ];

  for (const msg of SENT_MESSAGES) {
    const [comm] = await db
      .insert(communications)
      .values({
        churchId,
        subject: msg.subject,
        body: msg.body,
        channel: "email",
        templateId: msg.templateId ?? null,
        meetingId: msg.meetingId,
        status: "sent",
        sentAt: daysAgo(msg.sentDaysAgo),
        recipientCount: msg.recipients.length,
        createdById: planterId,
      })
      .returning({ id: communications.id });
    await db.insert(communicationRecipients).values(
      msg.recipients.map((personId, i) => ({
        churchId,
        communicationId: comm.id,
        personId,
        email: `recipient-${i}@example.invalid`,
        channel: "email" as const,
        status:
          i % 5 === 4
            ? ("delivered" as const)
            : i % 3 === 0
              ? ("opened" as const)
              : ("delivered" as const),
        deliveredAt: daysAgo(msg.sentDaysAgo),
        openedAt: i % 3 === 0 ? daysAgo(msg.sentDaysAgo - 1) : null,
      }))
    );
  }

  // ------------------------------------------------------------------
  // Activity trail for the dashboard feed — recent, story-consistent rows.
  // ------------------------------------------------------------------
  const danaFollowUpTask = followUps.find((t) => t.relatedId === danaId);
  await db.insert(personActivities).values([
    {
      churchId,
      personId: chidiId,
      activityType: "commitment_recorded",
      metadata: { commitmentType: "core_group" },
      performedBy: planterId,
      createdAt: daysAgo(10),
    },
    {
      churchId,
      personId: amaraId,
      activityType: "commitment_recorded",
      metadata: { commitmentType: "core_group" },
      performedBy: planterId,
      createdAt: daysAgo(10),
    },
    {
      churchId,
      personId: danaId,
      activityType: "note_added",
      metadata: {
        note: "Came back for VN #4 — bring the launch-team ask gently.",
      },
      performedBy: planterId,
      createdAt: daysAgo(4),
    },
    {
      churchId,
      personId: graceId,
      activityType: "status_changed",
      metadata: { from: "prospect", to: "following_up" },
      performedBy: planterId,
      createdAt: daysAgo(2),
    },
    {
      churchId,
      personId: byName.get("J. P. Holloway")!,
      activityType: "person_created",
      metadata: {},
      performedBy: planterId,
      createdAt: daysAgo(4),
    },
    {
      churchId,
      personId: samId,
      activityType: "note_added",
      metadata: { note: "Plays bass — introduce him to the worship leader." },
      performedBy: planterId,
      createdAt: daysAgo(5),
    },
  ]);

  // ------------------------------------------------------------------
  // Unread notifications — enqueued through the real contract, so the
  // bell badge and feed behave exactly as production would.
  // ------------------------------------------------------------------
  const worshipTeamId = teamIdByName.get("Technology & AV")!;
  const enqueueInputs = [
    {
      churchId,
      recipientUserId: planterId,
      category: "meetings" as const,
      type: "meeting.attendance.finalized",
      title: "Vision Night #4 attendance finalized",
      body: "28 attended — up from 24 at Vision Night #3. Follow-up tasks are queued.",
      entityType: "meeting" as const,
      entityId: vn4Id,
    },
    {
      churchId,
      recipientUserId: planterId,
      category: "tasks" as const,
      type: "task.due_soon",
      title: "4 follow-ups from Vision Night #4 are due this week",
      body: "Dana Whitfield and Sam Torres are first up.",
      ...(danaFollowUpTask
        ? { entityType: "task" as const, entityId: danaFollowUpTask.id }
        : {}),
    },
    {
      churchId,
      recipientUserId: planterId,
      category: "teams" as const,
      type: "team.training.behind",
      title: "Production training is behind",
      body: "Technology & AV: 2 of 4 trained with 4 weeks to launch Sunday.",
      entityType: "ministry_team" as const,
      entityId: worshipTeamId,
    },
    {
      churchId,
      recipientUserId: planterId,
      category: "communication" as const,
      type: "communication.delivered",
      title: "Vision Night invitation delivered",
      body: "30 delivered, 11 opened so far.",
    },
  ];
  for (const input of enqueueInputs) {
    const result = await notificationsLib.enqueue(input);
    if (result.status === "skipped") {
      console.warn(
        `   ⚠️  Notification skipped (${result.reason}): ${input.title}`
      );
    }
  }

  // ------------------------------------------------------------------
  // Phase-engine attestations + full sharing posture. `systems_tested`
  // false is the honest pre-launch gap the assessment should surface.
  // ------------------------------------------------------------------
  await db.insert(plantSignals).values([
    {
      churchId,
      signalKey: "values_documented",
      value: true,
      attestedById: planterId,
      attestedAt: daysAgo(40),
    },
    {
      churchId,
      signalKey: "financial_base",
      value: true,
      attestedById: planterId,
      attestedAt: daysAgo(15),
    },
    {
      churchId,
      signalKey: "systems_tested",
      value: false,
      attestedById: planterId,
      attestedAt: daysAgo(3),
    },
  ]);
  await db.insert(churchPrivacySettings).values({
    churchId,
    sharePeople: true,
    shareMeetings: true,
    shareTasks: true,
    shareFinancials: true,
    shareMinistryTeams: true,
    shareFacilities: true,
  });

  // Team staffing (and the status advances it fires) happened over the last
  // ~6 weeks, not this minute.
  await backdateEventArtifacts(churchId, { activitySpread: [12, 40] });

  console.log(`   ${RH_CHURCH_NAME} seeded.\n`);
  return { churchId, planterUserId: planterId };
}

// ============================================================================
// Trinity Grove Church — the small graduated plant for the "Beyond" shot
// ============================================================================

async function seedTrinityGrove(
  networkId: string,
  sendingChurchId: string,
  passwordHash: string,
  services: Services
): Promise<{ churchId: string }> {
  console.log(`🌱 Seeding ${TG_CHURCH_NAME} (graduated, launch −6 weeks)…`);
  const { teams } = services;

  const [church] = await db
    .insert(churches)
    .values({
      name: TG_CHURCH_NAME,
      currentPhase: 6,
      sendingNetworkId: networkId,
      sendingChurchId,
      lastMaterialEventAt: daysAgo(2),
    })
    .returning({ id: churches.id });
  const churchId = church.id;

  const [marcus] = await db
    .insert(users)
    .values({
      email: TG_PLANTER_EMAIL,
      name: "Marcus Bell",
      role: "planter",
      passwordHash,
      churchId,
      sendingNetworkId: networkId,
      sendingChurchId,
    })
    .returning({ id: users.id });
  const planterId = marcus.id;

  // Trinity Grove launched six weeks ago — the "Beyond" shot, and the only
  // seeded launch with an OUTCOME on it (LS-006).
  await seedCompletedLaunch({
    churchId,
    planterId,
    targetDate: dateOnly(daysAgo(42)),
    attendanceCount: 214,
    decisionsCount: 9,
    outcomeNotes:
      "Every seat full and forty chairs added at 9:40. The launch team ran set-up in under an hour.",
    captureTheDay:
      "Photos on the church drive; Marcus's note to the core group is pinned in the launch-team channel.",
  });

  const [marcusPerson] = await db
    .insert(persons)
    .values({
      churchId,
      firstName: "Marcus",
      lastName: "Bell",
      email: TG_PLANTER_EMAIL,
      status: "leader",
      source: "other",
      createdBy: planterId,
      createdAt: daysAgo(400),
      updatedAt: daysAgo(2),
    })
    .returning({ id: persons.id });

  // 54 filler people: 8 team leads + 33 serving + 6 core + 5 attendees +
  // 2 following-up. Names continue past the Redemption Hill slice.
  type PersonInsert = typeof persons.$inferInsert;
  const TG_NAME_OFFSET = 200;
  const makeRows = (
    count: number,
    status: PersonInsert["status"],
    startIdx: number
  ): PersonInsert[] =>
    Array.from({ length: count }, (_, i) => {
      const { firstName, lastName } = fillerName(TG_NAME_OFFSET + startIdx + i);
      const info = contactInfo(
        firstName,
        lastName,
        TG_NAME_OFFSET + startIdx + i
      );
      return {
        churchId,
        firstName,
        lastName,
        email: info.email,
        phone: info.phone,
        status,
        source: "vision_meeting" as const,
        createdBy: planterId,
        createdAt: daysAgo(300 - (startIdx + i) * 2),
        updatedAt: daysAgo(2 + (i % 12)),
      };
    });

  const tgLeaders = (
    await db
      .insert(persons)
      .values(makeRows(8, "core_group", 0))
      .returning({ id: persons.id })
  ).map((r) => r.id);
  const tgServing = (
    await db
      .insert(persons)
      .values(makeRows(33, "core_group", 8))
      .returning({ id: persons.id })
  ).map((r) => r.id);
  const tgOthers = [
    ...makeRows(6, "core_group", 41),
    ...makeRows(5, "attendee", 47),
    ...makeRows(2, "following_up", 52),
  ];
  await db.insert(persons).values(tgOthers);

  // Old commitments — the plant is past its formation arc.
  const tgCommitted = [...tgLeaders, ...tgServing];
  await db.insert(commitments).values(
    tgCommitted.map((personId, i) => ({
      churchId,
      personId,
      commitmentType: "core_group" as const,
      signedDate: dateOnly(daysAgo(80 + ((i * 4) % 120))),
      witnessedBy: planterId,
    }))
  );
  await db.insert(commitments).values(
    tgCommitted.slice(0, 38).map((personId, i) => ({
      churchId,
      personId,
      commitmentType: "launch_team" as const,
      signedDate: dateOnly(daysAgo(50 + ((i * 3) % 60))),
      witnessedBy: planterId,
    }))
  );

  // Teams through the real service — 41 serving across 9 staffed teams.
  const createdTeams = await teams.initializePredefinedTeams(
    churchId,
    planterId
  );
  const STAFF_KEYS = [
    { key: "senior_pastor" as const, prefix: "Senior" },
    { key: "launch_coordinator" as const, prefix: "Launch" },
    { key: "worship" as const, prefix: "Worship" },
    { key: "childrens_ministry" as const, prefix: "Children" },
    { key: "assimilation" as const, prefix: "Assimilation" },
    { key: "small_groups" as const, prefix: "Small" },
    { key: "facilities" as const, prefix: "Facilities" },
    { key: "promotion" as const, prefix: "Promotion" },
    { key: "technology" as const, prefix: "Technology" },
  ];
  let servingCursor = 0;
  const [volunteerProgram] = await db
    .insert(trainingPrograms)
    .values({
      churchId,
      name: "Volunteer onboarding",
      isRequired: true,
      createdBy: planterId,
    })
    .returning({ id: trainingPrograms.id });

  for (let t = 0; t < STAFF_KEYS.length; t++) {
    const staffing = STAFF_KEYS[t];
    const team = createdTeams.find((tm) =>
      tm.name.toLowerCase().startsWith(staffing.prefix.toLowerCase())
    );
    if (!team) throw new Error(`Predefined team not found: ${staffing.prefix}`);

    const roles = await teams.importRoleTemplates(
      churchId,
      team.id,
      planterId,
      staffing.key
    );
    const leadershipRole = roles.find((r) => r.isLeadershipRole) ?? roles[0];
    const memberRole = roles.find((r) => !r.isLeadershipRole) ?? leadershipRole;

    const leaderId = t === 0 ? marcusPerson.id : tgLeaders[t - 1];
    await teams.assignMember(
      churchId,
      team.id,
      leadershipRole.id,
      leaderId,
      planterId
    );
    await teams.assignTeamLeader(churchId, team.id, leaderId, planterId);

    const memberCount = t === 0 ? 0 : t <= 4 ? 5 : 4; // 33 total (5×4 + 4×3 + …)
    const members = tgServing.slice(servingCursor, servingCursor + memberCount);
    servingCursor += memberCount;
    for (const memberId of members) {
      await teams.assignMember(
        churchId,
        team.id,
        memberRole.id,
        memberId,
        planterId
      );
    }
    await db
      .update(ministryTeams)
      .set({ status: "active" })
      .where(eq(ministryTeams.id, team.id));
  }
  // Any serving people not yet placed join Small Groups as members.
  if (servingCursor < tgServing.length) {
    const smallGroups = createdTeams.find((tm) =>
      tm.name.toLowerCase().startsWith("small")
    )!;
    const roles = await db
      .select({
        id: teamRoles.id,
        isLeadershipRole: teamRoles.isLeadershipRole,
      })
      .from(teamRoles)
      .where(
        and(
          eq(teamRoles.churchId, churchId),
          eq(teamRoles.teamId, smallGroups.id)
        )
      );
    const memberRole = roles.find((r) => !r.isLeadershipRole) ?? roles[0];
    for (const memberId of tgServing.slice(servingCursor)) {
      await teams.assignMember(
        churchId,
        smallGroups.id,
        memberRole.id,
        memberId,
        planterId
      );
    }
  }

  // ~90% trained volunteers.
  const trained = [marcusPerson.id, ...tgLeaders, ...tgServing].filter(
    (_, i) => i % 10 !== 9
  );
  await db.insert(trainingCompletions).values(
    trained.map((personId, i) => ({
      churchId,
      personId,
      trainingProgramId: volunteerProgram.id,
      completedAt: daysAgo(45 + ((i * 3) % 40)),
      createdBy: planterId,
    }))
  );

  // Launch Sunday (117) + six weekly services, attendance set directly —
  // finalizing six ~110-person gatherings would fabricate ~600 follow-up
  // tasks, so the Beyond church's history is recorded, not replayed.
  const weekly = [108, 101, 105, 103, 109, 112];
  await db.insert(churchMeetings).values([
    {
      churchId,
      type: "vision_meeting" as const,
      title: "Launch Sunday",
      datetime: atHour(daysAgo(42), 10),
      status: "completed" as const,
      actualAttendance: 117,
      createdBy: planterId,
    },
    ...weekly.map((attendance, i) => ({
      churchId,
      type: "vision_meeting" as const,
      title: `Sunday Gathering · Week ${i + 1}`,
      datetime: atHour(daysAgo(36 - i * 7), 10),
      status: "completed" as const,
      actualAttendance: attendance,
      createdBy: planterId,
    })),
  ]);

  await db.insert(plantSignals).values(
    ["values_documented", "financial_base", "systems_tested"].map(
      (signalKey) => ({
        churchId,
        signalKey,
        value: true,
        attestedById: planterId,
        attestedAt: daysAgo(60),
      })
    )
  );
  await db.insert(churchPrivacySettings).values({
    churchId,
    sharePeople: true,
    shareMeetings: true,
    shareTasks: true,
    shareFinancials: true,
    shareMinistryTeams: true,
    shareFacilities: true,
  });

  // A graduated plant's staffing story is months old.
  await backdateEventArtifacts(churchId, { activitySpread: [50, 90] });

  console.log(`   ${TG_CHURCH_NAME} seeded.\n`);
  return { churchId };
}

// ============================================================================
// Verification — run the Signal layer + print what the seed produced
// ============================================================================

function pad(value: string | number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

async function verify(
  seeded: { name: string; churchId: string }[]
): Promise<void> {
  console.log("🔎 Verification — buildFactSnapshot for each church:\n");
  const { buildFactSnapshot } = await import("../src/lib/phase-engine/signals");

  const header = [
    pad("Church", 26),
    pad("Ph", 3),
    pad("Cmt", 4),
    pad("Δ", 4),
    pad("Roles", 6),
    pad("Train", 6),
    pad("Launch", 7),
    pad("Trend", 7),
  ].join(" ");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const { name, churchId } of seeded) {
    const snap = await buildFactSnapshot(churchId);
    const trainPct =
      snap.training.requiredCompletionRate === null
        ? "—"
        : `${Math.round(snap.training.requiredCompletionRate * 100)}%`;
    console.log(
      [
        pad(name.slice(0, 26), 26),
        pad(snap.currentPhase, 3),
        pad(snap.coreGroup.committedCount, 4),
        pad(snap.coreGroup.growthDelta ?? "—", 4),
        pad(`${snap.ministryRoles.filledCount}/8`, 6),
        pad(trainPct, 6),
        pad(
          snap.launch.daysUntilLaunch === null
            ? "—"
            : `${snap.launch.daysUntilLaunch}d`,
          7
        ),
        pad(snap.visionMeetings.attendanceTrend ?? "—", 7),
      ].join(" ")
    );
  }

  // People + task shape for the main church.
  const rh = seeded.find((s) => s.name === RH_CHURCH_NAME);
  if (rh) {
    const people = await db
      .select({ status: persons.status })
      .from(persons)
      .where(and(eq(persons.churchId, rh.churchId), isNull(persons.deletedAt)));
    const byStatus = new Map<string, number>();
    for (const p of people) {
      byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    }
    const taskRows = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.churchId, rh.churchId), isNull(tasks.deletedAt)));
    const openTasks = taskRows.filter((t) => t.status !== "complete").length;
    console.log(
      `\n   ${RH_CHURCH_NAME}: ${people.length} people (` +
        [...byStatus.entries()].map(([k, v]) => `${k} ${v}`).join(" · ") +
        `) · ${openTasks} open tasks / ${taskRows.length} total`
    );
  }
  console.log("");
}

// ============================================================================
// Assess mode — the real LLM judge over the existing seed
// ============================================================================

async function runAssessment(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is required for --assess");
    process.exit(1);
  }
  const networkId = await findNetworkId();
  if (!networkId) {
    console.error("❌ No marketing network found — run the seed first.");
    process.exit(1);
  }
  const [rh] = await db
    .select({ id: churches.id })
    .from(churches)
    .where(
      and(
        eq(churches.sendingNetworkId, networkId),
        eq(churches.name, RH_CHURCH_NAME)
      )
    )
    .limit(1);
  if (!rh) {
    console.error(`❌ ${RH_CHURCH_NAME} not found — run the seed first.`);
    process.exit(1);
  }

  console.log(`🧠 Running the REAL assessment for ${RH_CHURCH_NAME}…\n`);
  const { generateAssessment } =
    await import("../src/lib/phase-engine/assessment");
  await generateAssessment(rh.id);

  // Print the insights for review (severity → the standing the UI shows).
  const [latest] = await db
    .select({ id: plantAssessments.id, phase: plantAssessments.phase })
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.churchId, rh.id),
        eq(plantAssessments.status, "complete")
      )
    )
    .orderBy(desc(plantAssessments.generatedAt))
    .limit(1);
  const insightRows = await db
    .select({
      audience: plantInsights.audience,
      category: plantInsights.category,
      severity: plantInsights.severity,
      title: plantInsights.title,
      body: plantInsights.body,
      rank: plantInsights.rank,
    })
    .from(plantInsights)
    .where(eq(plantInsights.assessmentId, latest.id))
    .orderBy(plantInsights.rank);

  const STANDING: Record<string, string> = {
    critical: "Urgent",
    high: "Needs attention",
    medium: "Worth a look",
    low: "Noted / FYI",
    info: "Going well",
  };
  for (const ins of insightRows) {
    console.log(
      `   [${ins.audience}] ${pad(ins.category, 24)} ${pad(
        `${ins.severity} → ${STANDING[ins.severity] ?? ins.severity}`,
        28
      )} ${ins.title}`
    );
    console.log(
      `       ${ins.body.slice(0, 160)}${ins.body.length > 160 ? "…" : ""}\n`
    );
  }
  console.log(
    "✅ Assessment complete. Review the copy above (and /phase in the app) before shooting."
  );
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    if (assessOnly) {
      await runAssessment();
      process.exit(0);
    }

    await cleanMarketingData();
    if (cleanOnly) {
      console.log("✅ Clean-only run complete.");
      process.exit(0);
    }

    const [network] = await db
      .insert(sendingNetworks)
      .values({ name: NETWORK_NAME })
      .returning({ id: sendingNetworks.id });
    const [sendingChurch] = await db
      .insert(sendingChurches)
      .values({ name: SENDING_CHURCH_NAME, sendingNetworkId: network.id })
      .returning({ id: sendingChurches.id });

    const passwordHash = await hashPassword(PASSWORD);

    // Network-admin login for the oversight side (documented marketing
    // account). Carries the network id, so cleanup catches it.
    await db.insert(users).values({
      email: NETWORK_ADMIN_EMAIL,
      name: NETWORK_ADMIN_NAME,
      role: "network_admin",
      passwordHash,
      sendingNetworkId: network.id,
    });

    const services = await loadServices();

    const rh = await seedRedemptionHill(
      network.id,
      sendingChurch.id,
      passwordHash,
      services
    );
    const tg = await seedTrinityGrove(
      network.id,
      sendingChurch.id,
      passwordHash,
      services
    );

    await verify([
      { name: RH_CHURCH_NAME, churchId: rh.churchId },
      { name: TG_CHURCH_NAME, churchId: tg.churchId },
    ]);

    console.log("━".repeat(64));
    console.log("📝 Marketing seed logins (password for all: password123)");
    console.log(`   ${RH_CHURCH_NAME}: ${RH_PLANTER_EMAIL}`);
    console.log(`   ${TG_CHURCH_NAME}: ${TG_PLANTER_EMAIL}`);
    console.log(`   ${NETWORK_NAME} (oversight): ${NETWORK_ADMIN_EMAIL}`);
    console.log("━".repeat(64));
    console.log(
      "\nNext: pnpm exec tsx scripts/seed-marketing-church.ts --assess"
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
