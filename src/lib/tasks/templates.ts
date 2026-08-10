import type { TaskCategory, TaskPriority } from "@/db/schema/tasks";
import { PHASES, type PhaseNumber } from "@/lib/constants";

// ============================================================================
// T-011 — the checklist template catalog.
//
// WHY THIS IS CODE AND NOT A TABLE. The FRD's data model sketches `Checklist`
// and `ChecklistItem` tables with an `is_system` flag, which is the shape you
// need the day a church authors its own. Church-authored templates are
// deliberately out of scope here, so every row in those tables would be a
// system row — a migration, a seed script and a read path, all to hold a list
// that only ships when the code ships. The catalog below IS that list, and it
// gets code review, types and a test over its shape for free.
//
// The day T-011 grows church-authored templates, this module becomes the
// `is_system` half of the union and the reader (`taskTemplatesByPhase`) grows
// a second source. Nothing here has to be unpicked first.
//
// WHAT A TEMPLATE DECLARES. A phase (which stage of the journey it belongs to)
// and a category (what kind of work it is) — the two axes the FRD's template
// screen groups by. Its items declare the schedule, as an OFFSET IN DAYS from
// the day the template is imported; see `./import.ts` for why no absolute date
// is ever stored in this file.
// ============================================================================

/**
 * One task a template will create.
 *
 * `offsetDays` is days AFTER the import date, never a calendar date: 0 means
 * "due the day you import this", 14 means "due a fortnight later". A template
 * cannot know when it will be used, so it does not try to.
 */
export interface TaskTemplateItem {
  /** Stable identity within its template. Not stored — it is how tests and
   *  future migrations name an item. */
  key: string;
  title: string;
  description?: string;
  /** Days after the import date. Never negative: a template may not create
   *  work that was already overdue when it arrived. */
  offsetDays: number;
  /** Overrides the template's `defaultPriority` for this one item. */
  priority?: TaskPriority;
}

/**
 * A named checklist, ready to become real tasks for one church.
 */
export interface TaskTemplate {
  /** Stable identity. This is what the import action accepts, so renaming one
   *  breaks bookmarked links rather than silently importing the wrong list. */
  key: string;
  name: string;
  /** One sentence, shown under the name in the picker. */
  description: string;
  /** The journey stage this checklist belongs to (T-011: "by phase"). */
  phase: PhaseNumber;
  /** The kind of work it is (T-011: "and category"). Every task it creates
   *  carries this — a template is a category of work, not a mixed bag. */
  category: TaskCategory;
  /** The priority its items take unless one says otherwise. */
  defaultPriority: TaskPriority;
  items: readonly TaskTemplateItem[];
}

// ----------------------------------------------------------------------------
// Copy the BROWSER needs — and why it lives in this file
// ----------------------------------------------------------------------------
//
// These two strings belong to the import story, so `./import.ts` is where a
// reader looks for them and where they used to live. They cannot stay there.
// `./import.ts` imports `@/db`, whose module scope calls
// `neon(process.env.DATABASE_URL!)`; the picker is a `"use client"` module, so
// importing one string from it dragged drizzle, `@neondatabase/serverless` and
// the whole schema — 222 KB — into a client chunk that threw
// "No database connection string was provided to `neon()`" while it evaluated,
// and /tasks/templates rendered nothing but the Next.js error boundary.
//
// This module is the db-free half of the pair: its only `@/db` reference is an
// `import type`, which is erased, so it is safe to reach from the browser.
// `./import.ts` re-exports both names, so server callers keep their old import
// path and there is still exactly one definition of each string.
// `template-picker.bundle.test.ts` walks the picker's transitive imports and
// fails if anything ever reconnects the client to `@/db`.

/** Thrown when a key does not name a template in the catalog. */
export const UNKNOWN_TEMPLATE_ERROR = "That checklist template does not exist";

/**
 * Said out loud wherever the import is offered.
 *
 * The AC allows either policy — repeat, or dedupe — as long as the product
 * says which. This is the sentence that says it. See `./import.ts` for why
 * repeating is the right answer.
 */
export const TEMPLATE_REIMPORT_NOTE =
  "Importing a checklist again adds a second copy of its tasks. Nothing is merged, replaced or skipped.";

// ----------------------------------------------------------------------------
// The catalog
// ----------------------------------------------------------------------------
//
// Every phase 0–6 carries at least one template, which is asserted in
// `templates.test.ts`: a stage with no checklist is a stage where the product
// has nothing to say, and the picker would show an empty heading.
//
// The launch-Sunday lists (phase 5) are the one place the day-offsets read
// oddly on their own — they describe a single weekend, so they are written to
// be imported IN launch week and land across the following days.
//
// ANCHORING TO THE LAUNCH DATE IS NOT BUILT. The FRD's `relative_to:
// launch_date` would date these from the stored launch day instead of the
// import day, and NOTHING here or in T-020 does that — T-020 dates an accepted
// checklist from the phase-transition instant, which is still an import date,
// just an earlier one. A planter who imports early moves the set with the bulk
// reschedule (T-019) rather than editing nineteen rows.
// ----------------------------------------------------------------------------

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    key: "discernment-and-preparation",
    name: "Discernment & Preparation",
    description:
      "The work that happens before anyone is gathered — prayer, ground work and the commitments this plant will ask for.",
    phase: 0,
    category: "administrative",
    defaultPriority: "medium",
    items: [
      {
        key: "vision-summary",
        title: "Write a one-page vision summary",
        description:
          "Who this church is for, what it will be like, and why here. One page — it has to survive being read aloud.",
        offsetDays: 3,
        priority: "high",
      },
      {
        key: "intercessors",
        title: "List the people already praying for this plant",
        offsetDays: 5,
      },
      {
        key: "meet-a-coach",
        title: "Meet a potential coach",
        offsetDays: 10,
        priority: "high",
      },
      {
        key: "walk-the-ground",
        title: "Walk the neighbourhood and write down what you see",
        offsetDays: 7,
      },
      {
        key: "family-commitments",
        title: "Agree the commitments this plant will ask of your family",
        offsetDays: 14,
      },
      {
        key: "first-year-budget",
        title: "Draft a budget for the first year",
        offsetDays: 21,
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Phase 1 — Core Group Development
  // --------------------------------------------------------------------------
  {
    key: "vision-meeting-preparation",
    name: "Vision Meeting Preparation",
    description:
      "Everything between setting a vision meeting date and standing up to give the talk.",
    phase: 1,
    category: "vision_meeting",
    defaultPriority: "medium",
    items: [
      {
        key: "set-date",
        title: "Set the vision meeting date and time",
        offsetDays: 0,
        priority: "high",
      },
      {
        key: "invite-list",
        title: "Write the invitation list",
        offsetDays: 2,
        priority: "high",
      },
      { key: "confirm-venue", title: "Confirm the venue", offsetDays: 3 },
      {
        key: "send-invitations",
        title: "Send the invitations",
        offsetDays: 5,
        priority: "high",
      },
      {
        key: "arrange-childcare",
        title: "Arrange childcare for the meeting",
        offsetDays: 9,
      },
      {
        key: "prepare-talk",
        title: "Prepare the vision talk",
        offsetDays: 10,
      },
      {
        key: "print-materials",
        title: "Print response cards and name tags",
        offsetDays: 12,
      },
      {
        key: "refreshments",
        title: "Arrange refreshments",
        offsetDays: 12,
        priority: "low",
      },
      {
        key: "confirm-attendance",
        title: "Confirm attendance by phone",
        description:
          "A text is an invitation; a call is a commitment. Ring everyone who said yes.",
        offsetDays: 13,
        priority: "high",
      },
      {
        key: "set-the-room",
        title: "Set the room up and rehearse the talk",
        offsetDays: 14,
      },
    ],
  },
  {
    key: "post-meeting-follow-up",
    name: "Post-Meeting Follow-Up",
    description:
      "The week after a vision meeting, where interest either becomes a core group or evaporates.",
    phase: 1,
    category: "follow_up",
    defaultPriority: "high",
    items: [
      {
        key: "record-attendance",
        title: "Record attendance and response cards",
        offsetDays: 0,
      },
      {
        key: "thank-you",
        title: "Send a thank-you message to everyone who came",
        offsetDays: 1,
      },
      {
        key: "call-the-yeses",
        title: "Call everyone who said yes",
        offsetDays: 3,
        priority: "urgent",
      },
      {
        key: "call-the-undecided",
        title: "Call everyone who was undecided",
        offsetDays: 5,
      },
      {
        key: "note-declines",
        title: "Note why anyone declined",
        offsetDays: 5,
        priority: "low",
      },
      {
        key: "book-coffees",
        title: "Book one-to-one coffees with the interested",
        offsetDays: 7,
      },
      {
        key: "update-pipeline",
        title: "Move everyone to their real status in the pipeline",
        offsetDays: 7,
      },
    ],
  },
  {
    key: "core-group-onboarding",
    name: "Core Group Onboarding",
    description:
      "Turning a list of interested people into a core group that meets, prays and gives.",
    phase: 1,
    category: "general",
    defaultPriority: "medium",
    items: [
      {
        key: "share-vision-doc",
        title: "Share the vision document with the core group",
        offsetDays: 2,
      },
      {
        key: "weekly-gathering",
        title: "Set the weekly core group gathering",
        offsetDays: 3,
        priority: "high",
      },
      {
        key: "covenant",
        title: "Agree the core group covenant",
        offsetDays: 10,
      },
      {
        key: "serving-conversation",
        title: "Ask each member where they want to serve",
        offsetDays: 14,
      },
      {
        key: "giving-conversation",
        title: "Start the giving conversation with the core group",
        offsetDays: 21,
      },
      {
        key: "pray-for-launch-team",
        title: "Pray through the launch team names together",
        offsetDays: 21,
        priority: "low",
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Phase 2 — Launch Team Formation
  // --------------------------------------------------------------------------
  {
    key: "ministry-team-setup",
    name: "Ministry Team Setup",
    description:
      "Deciding which teams launch day needs, and putting a name against each one.",
    phase: 2,
    category: "ministry_team",
    defaultPriority: "medium",
    items: [
      {
        key: "name-coordinator",
        title: "Name the launch coordinator",
        offsetDays: 2,
        priority: "high",
      },
      {
        key: "decide-teams",
        title: "Decide which ministry teams launch day needs",
        offsetDays: 3,
        priority: "high",
      },
      {
        key: "name-leaders",
        title: "Name a leader for each ministry team",
        offsetDays: 10,
        priority: "high",
      },
      {
        key: "team-descriptions",
        title: "Write a one-paragraph description for each team",
        offsetDays: 12,
      },
      {
        key: "core-group-picks",
        title: "Ask core group members to pick a team",
        offsetDays: 14,
      },
      {
        key: "first-leaders-meeting",
        title: "Hold the first ministry team leaders meeting",
        offsetDays: 17,
      },
      {
        key: "meeting-rhythm",
        title: "Agree how often each team meets",
        offsetDays: 17,
        priority: "low",
      },
      {
        key: "shared-calendar",
        title: "Put every team meeting on the shared calendar",
        offsetDays: 21,
        priority: "low",
      },
      {
        key: "recruit-for-gaps",
        title: "Review the team gaps and recruit for them",
        offsetDays: 28,
      },
    ],
  },
  {
    key: "launch-date-planning",
    name: "Launch Date Planning",
    description:
      "Choosing the Sunday everything else counts down to, and telling everyone who needs to know.",
    phase: 2,
    category: "launch_prep",
    defaultPriority: "high",
    items: [
      {
        key: "pick-a-sunday",
        title: "Pick a target launch Sunday",
        offsetDays: 3,
        priority: "urgent",
      },
      {
        key: "check-calendars",
        title: "Check the date against school and local calendars",
        offsetDays: 4,
      },
      {
        key: "venue-free",
        title: "Confirm the venue is free on that date",
        offsetDays: 7,
      },
      {
        key: "work-backwards",
        title: "Work backwards and set the preview service dates",
        offsetDays: 10,
      },
      {
        key: "tell-core-group",
        title: "Tell the core group the launch date",
        offsetDays: 12,
      },
      {
        key: "tell-oversight",
        title: "Tell the sending church and network",
        offsetDays: 12,
      },
      {
        key: "publish-the-date",
        title: "Record the launch date in EveryField",
        description:
          "The countdown, the milestones and the oversight announcement all hang off this one date.",
        offsetDays: 14,
      },
    ],
  },
  {
    key: "project-timeline-creation",
    name: "Project Timeline Creation",
    description:
      "Milestones, owners and the review rhythm that keeps the plan honest.",
    phase: 2,
    category: "administrative",
    defaultPriority: "medium",
    items: [
      {
        key: "list-milestones",
        title: "List every milestone between now and launch",
        offsetDays: 5,
      },
      {
        key: "milestone-owners",
        title: "Put an owner on each milestone",
        offsetDays: 8,
        priority: "high",
      },
      {
        key: "planning-rhythm",
        title: "Agree the weekly planning rhythm",
        offsetDays: 8,
      },
      {
        key: "budget-review",
        title: "Set a monthly budget review",
        offsetDays: 12,
        priority: "low",
      },
      {
        key: "define-ready",
        title: 'Write down what "ready to launch" means',
        offsetDays: 15,
        priority: "high",
      },
      {
        key: "review-with-coach",
        title: "Review the timeline with your coach",
        offsetDays: 20,
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Phase 3 — Training & Preparation
  // --------------------------------------------------------------------------
  {
    key: "peak-performance-classes",
    name: "Peak Performance Classes",
    description:
      "Booking, filling and running the Peak Performance class series with the core group.",
    phase: 3,
    category: "training",
    defaultPriority: "medium",
    items: [
      {
        key: "book-dates",
        title: "Book the class dates",
        offsetDays: 3,
        priority: "high",
      },
      {
        key: "invite-core-group",
        title: "Invite the core group to the classes",
        offsetDays: 5,
      },
      {
        key: "order-materials",
        title: "Order the class materials",
        offsetDays: 7,
      },
      {
        key: "room-and-childcare",
        title: "Arrange the room and childcare",
        offsetDays: 10,
      },
      { key: "session-one", title: "Run session one", offsetDays: 14 },
      {
        key: "collect-feedback",
        title: "Collect feedback after the first session",
        offsetDays: 16,
        priority: "low",
      },
      {
        key: "chase-absentees",
        title: "Follow up with anyone who missed a session",
        offsetDays: 21,
      },
    ],
  },
  {
    key: "ministry-team-training",
    name: "Ministry Team Training",
    description:
      "Every team trained on what it will actually do on a Sunday, and a record of who was there.",
    phase: 3,
    category: "training",
    defaultPriority: "medium",
    items: [
      {
        key: "training-plan",
        title: "Write the training plan for each team",
        offsetDays: 5,
        priority: "high",
      },
      {
        key: "book-training-dates",
        title: "Book the team training dates",
        offsetDays: 7,
        priority: "high",
      },
      {
        key: "worship-run-sheet",
        title: "Prepare the worship team run sheet",
        offsetDays: 12,
      },
      {
        key: "safeguarding",
        title: "Train the children's ministry team on safeguarding",
        description:
          "Nothing about launch day is more expensive to get wrong. Checks and ratios included.",
        offsetDays: 14,
        priority: "urgent",
      },
      {
        key: "welcome-flow",
        title: "Train greeters and ushers on the welcome flow",
        offsetDays: 16,
      },
      {
        key: "room-plan",
        title: "Train the setup and teardown team on the room plan",
        offsetDays: 18,
      },
      {
        key: "tech-training",
        title: "Train the tech team on sound and slides",
        offsetDays: 18,
      },
      {
        key: "all-teams",
        title: "Run a combined all-teams training",
        offsetDays: 25,
        priority: "high",
      },
      {
        key: "record-completion",
        title: "Record who completed each training",
        offsetDays: 26,
        priority: "low",
      },
    ],
  },
  {
    key: "small-group-leader-training",
    name: "Small Group Leader Training",
    description:
      "The model, the material and the first leaders — trained before launch, not after it.",
    phase: 3,
    category: "training",
    defaultPriority: "medium",
    items: [
      {
        key: "decide-model",
        title: "Decide the small group model",
        offsetDays: 3,
        priority: "high",
      },
      {
        key: "choose-material",
        title: "Choose the first study material",
        offsetDays: 7,
      },
      {
        key: "identify-leaders",
        title: "Identify the first small group leaders",
        offsetDays: 10,
        priority: "high",
      },
      {
        key: "leader-session-one",
        title: "Run leader training session one",
        offsetDays: 17,
      },
      {
        key: "leader-session-two",
        title: "Run leader training session two",
        offsetDays: 24,
      },
      {
        key: "assign-coaches",
        title: "Assign each leader someone to report to",
        offsetDays: 26,
      },
      {
        key: "start-date",
        title: "Set the small group start date",
        offsetDays: 28,
        priority: "high",
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Phase 4 — Pre-Launch
  // --------------------------------------------------------------------------
  {
    key: "promotion-campaign",
    name: "Promotion Campaign",
    description:
      "Getting the launch Sunday in front of the neighbourhood, on paper and on screens.",
    phase: 4,
    category: "promotion",
    defaultPriority: "high",
    items: [
      {
        key: "promotion-budget",
        title: "Agree the promotion budget",
        offsetDays: 2,
      },
      { key: "design-invite", title: "Design the invite card", offsetDays: 7 },
      {
        key: "order-invites",
        title: "Order the printed invite cards",
        offsetDays: 10,
      },
      {
        key: "launch-page",
        title: "Build the launch page on the website",
        offsetDays: 12,
      },
      {
        key: "social-accounts",
        title: "Set up the social media accounts",
        offsetDays: 12,
        priority: "low",
      },
      {
        key: "write-posts",
        title: "Write four weeks of social posts",
        offsetDays: 16,
      },
      {
        key: "hand-out-invites",
        title: "Hand invite cards to the launch team",
        offsetDays: 18,
      },
      {
        key: "invite-drop",
        title: "Run the neighbourhood invite drop",
        offsetDays: 21,
      },
      {
        key: "press-release",
        title: "Send the local press release",
        offsetDays: 21,
        priority: "low",
      },
      {
        key: "final-reminder",
        title: "Post the final week reminder",
        offsetDays: 26,
        priority: "urgent",
      },
    ],
  },
  {
    key: "pre-launch-services",
    name: "Pre-Launch Services",
    description:
      "Preview services, and the debriefs that make the next one better.",
    phase: 4,
    category: "launch_prep",
    defaultPriority: "medium",
    items: [
      {
        key: "set-preview-dates",
        title: "Set the preview service dates",
        offsetDays: 2,
        priority: "high",
      },
      {
        key: "book-preview-venue",
        title: "Book the venue for each preview service",
        offsetDays: 4,
        priority: "high",
      },
      {
        key: "preview-one",
        title: "Run preview service one",
        offsetDays: 10,
      },
      {
        key: "debrief-one",
        title: "Debrief preview service one",
        offsetDays: 11,
        priority: "high",
      },
      {
        key: "fix-what-broke",
        title: "Fix what the debrief found",
        offsetDays: 14,
      },
      {
        key: "preview-two",
        title: "Run preview service two",
        offsetDays: 21,
      },
      {
        key: "debrief-two",
        title: "Debrief preview service two",
        offsetDays: 22,
        priority: "high",
      },
    ],
  },
  {
    key: "final-preparation",
    name: "Final Preparation",
    description: "The last checks before launch week, in the order they bite.",
    phase: 4,
    category: "launch_prep",
    defaultPriority: "high",
    items: [
      {
        key: "team-gaps",
        title: "Confirm every team has the people it needs",
        offsetDays: 3,
        priority: "urgent",
      },
      {
        key: "venue-contract",
        title: "Confirm the venue contract and access times",
        offsetDays: 5,
      },
      {
        key: "walk-the-room",
        title: "Walk the room and mark the setup plan",
        offsetDays: 7,
      },
      {
        key: "test-av",
        title: "Test the sound and video in the room",
        offsetDays: 9,
      },
      {
        key: "print-run-sheet",
        title: "Print the launch day run sheet",
        offsetDays: 12,
      },
      {
        key: "welcome-pack",
        title: "Prepare the welcome pack for guests",
        offsetDays: 12,
      },
      {
        key: "childcare-checks",
        title: "Confirm childcare ratios and background checks",
        offsetDays: 14,
        priority: "urgent",
      },
      {
        key: "brief-leaders",
        title: "Brief every team leader on the run sheet",
        offsetDays: 16,
      },
      {
        key: "rest",
        title: "Rest the day before launch",
        offsetDays: 20,
        priority: "low",
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Phase 5 — Launch Sunday. Import these IN launch week; see the note above
  // the catalog for why they are day-offsets and not launch-date anchors.
  // --------------------------------------------------------------------------
  {
    key: "launch-setup-teardown",
    name: "Launch Sunday: Setup & Teardown",
    description:
      "The trailer, the room and the load-out — the list the setup team works from on the day.",
    phase: 5,
    category: "launch_prep",
    defaultPriority: "high",
    items: [
      {
        key: "load-trailer",
        title: "Load the trailer the night before",
        offsetDays: 5,
      },
      {
        key: "arrive-and-unload",
        title: "Arrive and unload",
        offsetDays: 6,
        priority: "urgent",
      },
      {
        key: "set-stage",
        title: "Set the stage and seating",
        offsetDays: 6,
        priority: "urgent",
      },
      {
        key: "cable-safety",
        title: "Check every power run and cable cover",
        offsetDays: 6,
      },
      { key: "load-out", title: "Teardown and load out", offsetDays: 6 },
      {
        key: "return-the-room",
        title: "Return the room to the state you found it in",
        offsetDays: 6,
      },
    ],
  },
  {
    key: "launch-signage-parking",
    name: "Launch Sunday: Signage & Parking",
    description:
      "Everything that gets a stranger from the main road to a seat.",
    phase: 5,
    category: "launch_prep",
    defaultPriority: "medium",
    items: [
      {
        key: "road-signs",
        title: "Place the road signs",
        offsetDays: 6,
        priority: "high",
      },
      { key: "car-park-team", title: "Brief the parking team", offsetDays: 5 },
      {
        key: "guest-parking",
        title: "Mark the guest parking bays",
        offsetDays: 6,
      },
      {
        key: "entrance-signs",
        title: "Place the entrance and welcome signs",
        offsetDays: 6,
      },
      {
        key: "kids-signs",
        title: "Place the children's check-in signs",
        offsetDays: 6,
        priority: "high",
      },
      {
        key: "collect-signage",
        title: "Collect every sign after the service",
        offsetDays: 6,
        priority: "low",
      },
    ],
  },
  {
    key: "launch-greeters-ushers",
    name: "Launch Sunday: Greeters & Ushers",
    description: "The first ninety seconds of a guest's experience.",
    phase: 5,
    category: "launch_prep",
    defaultPriority: "medium",
    items: [
      {
        key: "greeter-brief",
        title: "Brief the greeters on the welcome flow",
        offsetDays: 5,
        priority: "high",
      },
      { key: "door-positions", title: "Set the door positions", offsetDays: 6 },
      {
        key: "welcome-table",
        title: "Stock and staff the welcome table",
        offsetDays: 6,
      },
      {
        key: "guest-cards",
        title: "Put guest cards and pens on every seat",
        offsetDays: 6,
      },
      {
        key: "seat-latecomers",
        title: "Agree how latecomers are seated",
        offsetDays: 5,
        priority: "low",
      },
      {
        key: "hand-in-cards",
        title: "Hand the completed guest cards to assimilation",
        offsetDays: 6,
        priority: "high",
      },
    ],
  },
  {
    key: "launch-childrens-ministry",
    name: "Launch Sunday: Children's Ministry",
    description:
      "Check-in, ratios and safety — the part of launch day that has no acceptable failure.",
    phase: 5,
    category: "launch_prep",
    defaultPriority: "high",
    items: [
      {
        key: "confirm-volunteers",
        title: "Confirm every children's volunteer and their checks",
        offsetDays: 4,
        priority: "urgent",
      },
      {
        key: "checkin-system",
        title: "Test the check-in and pick-up system",
        offsetDays: 5,
        priority: "urgent",
      },
      {
        key: "set-rooms",
        title: "Set the children's rooms",
        offsetDays: 6,
      },
      {
        key: "supplies",
        title: "Lay out the lesson supplies and snacks",
        offsetDays: 6,
      },
      {
        key: "allergy-plan",
        title: "Post the allergy and emergency plan in every room",
        offsetDays: 6,
        priority: "urgent",
      },
      {
        key: "close-rooms",
        title: "Clear the rooms and log the attendance",
        offsetDays: 6,
      },
    ],
  },
  {
    key: "launch-worship-team",
    name: "Launch Sunday: Worship Team",
    description: "Set list, sound check and the run from call time to close.",
    phase: 5,
    category: "launch_prep",
    defaultPriority: "medium",
    items: [
      {
        key: "final-set-list",
        title: "Send the final set list to the band",
        offsetDays: 4,
        priority: "high",
      },
      {
        key: "slides",
        title: "Build and proof the lyric slides",
        offsetDays: 5,
      },
      {
        key: "call-time",
        title: "Confirm the call time with every musician",
        offsetDays: 5,
        priority: "high",
      },
      {
        key: "sound-check",
        title: "Run the sound check",
        offsetDays: 6,
        priority: "urgent",
      },
      {
        key: "rehearse",
        title: "Rehearse the full service order",
        offsetDays: 6,
      },
      {
        key: "pack-down",
        title: "Pack down the stage and instruments",
        offsetDays: 6,
        priority: "low",
      },
    ],
  },
  {
    key: "launch-assimilation",
    name: "Launch Sunday: Assimilation",
    description:
      "What happens to a guest's card between Sunday lunchtime and Tuesday morning.",
    phase: 5,
    category: "follow_up",
    defaultPriority: "high",
    items: [
      {
        key: "prepare-guest-packs",
        title: "Prepare the guest packs",
        offsetDays: 4,
      },
      {
        key: "brief-team",
        title: "Brief the assimilation team on the follow-up promise",
        offsetDays: 5,
      },
      {
        key: "collect-cards",
        title: "Collect every guest card after the service",
        offsetDays: 6,
        priority: "urgent",
      },
      {
        key: "enter-guests",
        title: "Enter each guest into EveryField the same day",
        offsetDays: 6,
        priority: "urgent",
      },
      {
        key: "thank-you-message",
        title: "Send the thank-you message to every guest",
        offsetDays: 7,
        priority: "urgent",
      },
      {
        key: "invite-to-next-step",
        title: "Invite each guest to a next step",
        offsetDays: 9,
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Phase 6 — Post-Launch
  // --------------------------------------------------------------------------
  {
    key: "first-90-days-rhythms",
    name: "First 90 Days Rhythms",
    description:
      "The repeating work that turns a launch into a church: guests, leaders, money and the next group.",
    phase: 6,
    category: "recurring",
    defaultPriority: "medium",
    items: [
      {
        key: "service-planning",
        title: "Set the weekly service planning meeting",
        offsetDays: 1,
        priority: "high",
      },
      {
        key: "guest-followup-standard",
        title: "Agree the 48-hour first-time guest follow-up standard",
        offsetDays: 2,
        priority: "urgent",
      },
      {
        key: "leaders-meeting",
        title: "Set the monthly leaders meeting",
        offsetDays: 3,
      },
      {
        key: "finance-review",
        title: "Set the monthly giving and expenses review",
        offsetDays: 7,
      },
      {
        key: "coach-review",
        title: "Book the three-month review with your coach",
        offsetDays: 14,
        priority: "high",
      },
      {
        key: "next-small-group",
        title: "Start the next small group",
        offsetDays: 30,
      },
      {
        key: "first-baptisms",
        title: "Plan the first baptism service",
        offsetDays: 45,
      },
    ],
  },
] as const;

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

/** The template with this key, or `null` — never a throw, because the key
 *  arrives from a client and an unknown one is a refusal, not a crash. */
export function findTaskTemplate(key: string): TaskTemplate | null {
  return TASK_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** How many tasks importing this template would create. */
export function taskTemplateSize(template: TaskTemplate): number {
  return template.items.length;
}

/**
 * The priority an item will be created with: its own, or its template's.
 *
 * One function so the picker's preview and the import cannot disagree about
 * what is about to be created.
 */
export function taskTemplateItemPriority(
  template: TaskTemplate,
  item: TaskTemplateItem
): TaskPriority {
  return item.priority ?? template.defaultPriority;
}

/** A phase and the templates that belong to it. */
export interface TaskTemplatePhaseGroup {
  phase: PhaseNumber;
  /** The phase's display name, from the one place phases are named. */
  phaseName: string;
  templates: readonly TaskTemplate[];
}

const PHASE_NUMBERS = Object.keys(PHASES)
  .map(Number)
  .sort((a, b) => a - b) as PhaseNumber[];

/**
 * The catalog grouped for display: every phase in order, each with its
 * templates in catalog order.
 *
 * Every phase appears, because a phase with no checklist is worth seeing as an
 * empty heading rather than silently vanishing — the catalog test asserts none
 * are empty today, so an empty group means someone removed a template.
 */
export function taskTemplatesByPhase(): TaskTemplatePhaseGroup[] {
  return PHASE_NUMBERS.map((phase) => ({
    phase,
    phaseName: PHASES[phase],
    templates: TASK_TEMPLATES.filter((template) => template.phase === phase),
  }));
}
