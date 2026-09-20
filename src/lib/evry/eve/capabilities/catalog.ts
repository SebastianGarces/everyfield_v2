/** Coverage metadata is shared by tools, skills and the evaluation inventory. */
export const EVE_CAPABILITY_CATALOG = [
  [
    "people.query",
    "Find, count or group people using stage, tags (IDs or exact case-insensitive names), skills and recorded interview, follow-up and attendance relationships.",
    ["people", "interviews", "assessments", "commitments", "notes"],
  ],
  [
    "people.get_many",
    "Read one or many people or households by ID. Request tags or skills fields for named tags and recorded skill category/proficiency/notes. Use bulk reads for collections.",
    ["people"],
  ],
  [
    "people.history.query",
    "Read recorded interviews, assessments, commitments, notes and activity for person cohorts. Missing records are not proof of events outside EveryField.",
    ["interviews", "assessments", "commitments", "notes"],
  ],
  [
    "tasks.query",
    "Find, count or group tasks by assignment, dates, priority, status and related records. My tasks means the authenticated account; today excludes overdue. Use resource templates for available checklist template keys, or phase_prompt for the current transition and suggested templates, without task filters.",
    ["tasks"],
  ],
  [
    "tasks.get_many",
    "Read task details, dependencies and checklists for one or many task IDs.",
    ["tasks"],
  ],
  [
    "tasks.assignees.search",
    "Find eligible task assignees in the current plant, not an unrestricted account directory.",
    ["tasks"],
  ],
  [
    "meetings.query",
    "Find, count or group meetings by type, date, status, team, location and preparation state. Orientation is its own meeting type.",
    ["meetings", "orientations"],
  ],
  [
    "meetings.get_many",
    "Read details, agenda, checklist and evaluation for one or many meetings.",
    ["meetings", "orientations"],
  ],
  [
    "attendance.query",
    "Query recorded attendance, RSVP, response cards and linked follow-up across people and meetings. These are different evidence types.",
    ["meetings", "people"],
  ],
  [
    "teams.query",
    "Find ministry teams, roles, active rosters, vacancies and responsibilities with scoped relationships.",
    ["teams", "roles"],
  ],
  [
    "teams.get_many",
    "Read one or many ministry teams or roles with their related details.",
    ["teams", "roles"],
  ],
  [
    "training.query",
    "Read recorded training requirements and completion across teams and people.",
    ["training"],
  ],
  [
    "communication.query",
    "Find message templates, messages, recipients and delivery history. Use query resource merge_context for current church, pastor and launch-date placeholder values. Use communication.get_many for complete message content.",
    ["communication"],
  ],
  [
    "communication.get_many",
    "Read subject, body, placeholders and delivery eligibility for selected messages or templates.",
    ["communication"],
  ],
  [
    "documents.query",
    "Search document and generation-template metadata; use documents.read for the actual content.",
    ["documents"],
  ],
  [
    "documents.read",
    "Read bounded authorized document content with source references. Report unsupported formats rather than inventing content.",
    ["documents"],
  ],
  [
    "wiki.search",
    "Search the visible wiki corpus for relevant passages and citations.",
    ["wiki"],
  ],
  [
    "wiki.read_many",
    "Read selected wiki articles with revision and source evidence.",
    ["wiki"],
  ],
  [
    "launch.query",
    "Read launch status, milestones, linked tasks and journal. Launch readiness also needs task, staffing and meeting evidence.",
    ["launch"],
  ],
  [
    "intelligence.query",
    "Read Plant Intelligence assessments, insights, attestations, transitions, checkins, feedback or signals. Signals include current operational trends, milestone timeline and phase readiness; they are not a historical assessment. Feedback/signals accept the unchanged continuation cursor returned by the reader. Distinguish recorded claims from measured evidence.",
    ["intelligence"],
  ],
  [
    "notifications.query",
    "Read the authenticated account's own notification feed and counts.",
    ["notifications"],
  ],
  [
    "files.inspect",
    "Inspect an authorized uploaded file by opaque reference through bounded parsers. No arbitrary URL fetching.",
    ["documents", "people"],
  ],
  [
    "actions.prepare",
    "Prepare typed changes for an exact editable human review. This tool cannot execute, send or confirm changes.",
    ["cross", "edges"],
  ],
] as const;

export type EveBaselineToolName = (typeof EVE_CAPABILITY_CATALOG)[number][0];

export const EVE_WORKFLOW_COVERAGE = [
  {
    name: "daily-work",
    tools: ["tasks.query", "meetings.query", "notifications.query"],
    areas: ["tasks", "meetings", "notifications"],
  },
  {
    name: "interview-review",
    tools: ["people.query", "people.history.query", "attendance.query"],
    areas: ["people", "interviews", "assessments", "commitments", "notes"],
  },
  {
    name: "meeting-invite",
    tools: [
      "people.query",
      "calendar.resolve",
      "locations.query",
      "templates.for_meeting",
      "actions.prepare",
    ],
    areas: ["meetings", "orientations", "communication"],
  },
  {
    name: "meeting-followup",
    tools: [
      "meetings.get_many",
      "attendance.query",
      "people.history.query",
      "tasks.query",
      "actions.prepare",
    ],
    areas: ["meetings", "people", "notes", "tasks"],
  },
  {
    name: "staffing-review",
    tools: [
      "teams.query",
      "people.get_many",
      "training.query",
      "actions.prepare",
    ],
    areas: ["teams", "roles", "training"],
  },
  {
    name: "launch-review",
    tools: [
      "launch.query",
      "tasks.query",
      "teams.query",
      "meetings.query",
      "intelligence.query",
    ],
    areas: ["launch", "tasks", "teams", "intelligence"],
  },
  {
    name: "delivery-recovery",
    tools: ["communication.query", "communication.get_many", "actions.prepare"],
    areas: ["communication"],
  },
  {
    name: "import-review",
    tools: ["files.inspect", "people.query", "actions.prepare"],
    areas: ["people", "documents"],
  },
  {
    name: "prospect-outreach",
    tools: [
      "people.query",
      "people.history.query",
      "communication.query",
      "communication.get_many",
      "actions.prepare",
    ],
    areas: ["people", "interviews", "communication"],
  },
  {
    name: "task-cleanup",
    tools: [
      "tasks.query",
      "tasks.get_many",
      "tasks.assignees.search",
      "actions.prepare",
    ],
    areas: ["tasks"],
  },
  {
    name: "insight-to-action",
    tools: [
      "intelligence.query",
      "launch.query",
      "tasks.query",
      "teams.query",
      "wiki.search",
      "wiki.read_many",
      "documents.read",
      "actions.prepare",
    ],
    areas: ["intelligence", "launch", "wiki", "documents", "cross", "edges"],
  },
] as const;
