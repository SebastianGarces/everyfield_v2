/**
 * Four candidate meanings of "the in_app channel is off".
 *
 * Every direction implements `Direction`, so one action log replays through all
 * four and the difference between them is the only thing that moves on screen.
 * Pure: no I/O, no imports from `src/`.
 */

export type Channel = "in_app" | "email";
export type DeliveryStatus = "sent" | "suppressed_by_preference";

/** The queue row's terminal status. `opted_out` only exists under statusRule = "distinct". */
export type NotificationStatus = "pending" | "delivered" | "opted_out";

export type StatusRule = "delivered" | "distinct";

export interface Prefs {
  inApp: boolean;
  email: boolean;
}

export interface NotificationRow {
  id: string;
  title: string;
  /** Minutes on the world clock when this becomes due. */
  scheduledFor: number;
  createdAt: number;
  status: NotificationStatus;
  readAt: number | null;
  /** Direction B stamps the enqueue-time decision on the row itself. */
  inAppSuppressed: boolean;
}

export interface DeliveryRow {
  notificationId: string;
  channel: Channel;
  status: DeliveryStatus;
}

export interface World {
  now: number;
  prefs: Prefs;
  notifications: NotificationRow[];
  deliveries: DeliveryRow[];
  emailsSent: number;
  seq: number;
}

export interface Direction {
  key: string;
  name: string;
  blurb: string;
  wins: string;
  costs: string;
  /** Some directions cannot express one of the preferences at all (C). */
  effectivePrefs(prefs: Prefs): Prefs;
  /** What enqueue writes. */
  enqueue(world: World, title: string, dueInMinutes: number): NotificationRow;
  /** What dispatch writes to the delivery log for one claimed row. */
  deliveriesFor(
    world: World,
    row: NotificationRow
  ): { channel: Channel; status: DeliveryStatus }[];
  /** What the in-app feed lists. */
  feed(world: World): NotificationRow[];
  /** What the shell's unread badge counts. */
  unreadCount(world: World): number;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const suppressedInApp = (world: World, id: string): boolean =>
  world.deliveries.some(
    (d) =>
      d.notificationId === id &&
      d.channel === "in_app" &&
      d.status === "suppressed_by_preference"
  );

const baseRow = (
  world: World,
  title: string,
  dueInMinutes: number,
  inAppSuppressed: boolean
): NotificationRow => ({
  id: `n${world.seq}`,
  title,
  scheduledFor: world.now + dueInMinutes,
  createdAt: world.now,
  status: "pending",
  readAt: null,
  inAppSuppressed,
});

/** Today's rule: both channels always get a row; a disabled one is recorded. */
const recordBothChannels = (
  world: World
): { channel: Channel; status: DeliveryStatus }[] => {
  const prefs = world.prefs;
  return [
    {
      channel: "in_app",
      status: prefs.inApp ? "sent" : "suppressed_by_preference",
    },
    {
      channel: "email",
      status: prefs.email ? "sent" : "suppressed_by_preference",
    },
  ];
};

const visibleByTime = (world: World): NotificationRow[] =>
  world.notifications.filter((n) => n.scheduledFor <= world.now);

const unreadOf = (rows: NotificationRow[]): number =>
  rows.filter((n) => n.readAt === null).length;

// ---------------------------------------------------------------------------
// A — the feed reads the delivery log
// ---------------------------------------------------------------------------

export const directionA: Direction = {
  key: "A",
  name: "A · feed filters on the in_app delivery row",
  blurb:
    "Nothing changes at enqueue. `feedVisibility` gains a NOT EXISTS against " +
    "notification_deliveries: a row with in_app = suppressed_by_preference is " +
    "hidden from the feed and the badge. The delivery log becomes the truth for " +
    "what the user sees.",
  wins:
    "One place decides, and it is the place that already knows: items still in " +
    "the queue when the user flips the toggle off are hidden too (scenario 2). " +
    "No schema change, no enqueue change.",
  costs:
    "A join (or NOT EXISTS subquery) on the hottest read in the app. A row is " +
    "VISIBLE from the moment it comes due until the next tick writes the " +
    "suppression — up to 15 minutes of a notification appearing, bumping the " +
    "badge, then vanishing (scenario 3). And it is one-way: the delivery log is " +
    "immutable, so re-enabling the toggle does NOT bring the hidden history back " +
    "(scenario 5).",
  effectivePrefs: (p) => p,
  enqueue: (w, title, due) => baseRow(w, title, due, false),
  deliveriesFor: (w) => recordBothChannels(w),
  feed: (w) => visibleByTime(w).filter((n) => !suppressedInApp(w, n.id)),
  unreadCount: (w) => unreadOf(directionA.feed(w)),
};

// ---------------------------------------------------------------------------
// B — enqueue decides, and stamps the row
// ---------------------------------------------------------------------------

export const directionB: Direction = {
  key: "B",
  name: "B · enqueue honours the preference (stamped on the row)",
  blurb:
    "Enqueue reads the preference and stamps the queue row " +
    "(`in_app_suppressed`); no in_app delivery row is ever created. The feed " +
    "filters on a boolean already on the row it is selecting.",
  wins:
    "No join — the feed read stays exactly as cheap as it is today. The " +
    "decision is made once, at write time, and the row carries it.",
  costs:
    "Not retroactive in either direction: rows enqueued before the user turned " +
    "the toggle off keep showing (scenario 2), and rows suppressed while it was " +
    "off never come back when it is turned on (scenario 5). Also a schema + " +
    "enqueue change — out of PR #223's scope.",
  effectivePrefs: (p) => p,
  enqueue: (w, title, due) => baseRow(w, title, due, !w.prefs.inApp),
  deliveriesFor: (w, row) => {
    const rows: { channel: Channel; status: DeliveryStatus }[] = [];
    if (!row.inAppSuppressed) rows.push({ channel: "in_app", status: "sent" });
    rows.push({
      channel: "email",
      status: w.prefs.email ? "sent" : "suppressed_by_preference",
    });
    return rows;
  },
  feed: (w) => visibleByTime(w).filter((n) => !n.inAppSuppressed),
  unreadCount: (w) => unreadOf(directionB.feed(w)),
};

// ---------------------------------------------------------------------------
// C — in_app is always on; the toggle does not exist
// ---------------------------------------------------------------------------

export const directionC: Direction = {
  key: "C",
  name: "C · in_app is always on; drop the toggle (ship #223 as-is)",
  blurb:
    "Accept the current behaviour and make the product honest about it: the " +
    "preferences screen offers per-category EMAIL only. The feed is the record " +
    "of everything that happened; the way to not see it is to read it.",
  wins:
    "Zero code change on this track, zero read cost, and no control that lies. " +
    "Matches how most feeds actually behave.",
  costs:
    "Contradicts N-005's 'and vice versa' — the user cannot mute a noisy " +
    "category in-app at all. The in_app half of notification_preferences becomes " +
    "dead data, and the FRD needs an edit.",
  effectivePrefs: (p) => ({ inApp: true, email: p.email }),
  enqueue: (w, title, due) => baseRow(w, title, due, false),
  deliveriesFor: (w) => [
    { channel: "in_app", status: "sent" },
    {
      channel: "email",
      status: w.prefs.email ? "sent" : "suppressed_by_preference",
    },
  ],
  feed: (w) => visibleByTime(w),
  unreadCount: (w) => unreadOf(directionC.feed(w)),
};

// ---------------------------------------------------------------------------
// D — off means "don't interrupt me", not "don't record it"
// ---------------------------------------------------------------------------

export const directionD: Direction = {
  key: "D",
  name: "D · off = muted: badge ignores it, feed keeps it",
  blurb:
    "Splits the channel into its two jobs. Turning in_app off stops the " +
    "INTERRUPTION — the unread badge and any toast skip the category — but the " +
    "feed still lists it, marked muted, so nothing is lost. Only the badge query " +
    "consults the delivery log.",
  wins:
    "Kills the actual complaint (a badge that will not go away) without ever " +
    "hiding something that happened. The join lands on the cheap count, not the " +
    "list.",
  costs:
    "A third meaning nobody asked for: the user who unchecked in_app expecting " +
    "silence still sees the items when they open the panel. Needs UI (a muted " +
    "affordance) to not read as a bug.",
  effectivePrefs: (p) => p,
  enqueue: (w, title, due) => baseRow(w, title, due, false),
  deliveriesFor: (w) => recordBothChannels(w),
  feed: (w) => visibleByTime(w),
  unreadCount: (w) =>
    unreadOf(visibleByTime(w).filter((n) => !suppressedInApp(w, n.id))),
};

export const DIRECTIONS: Direction[] = [
  directionA,
  directionB,
  directionC,
  directionD,
];

/** Shared across directions — the second question, toggled with [x]. */
export function statusFor(
  rows: { status: DeliveryStatus }[],
  rule: StatusRule
): NotificationStatus {
  const attempted = rows.filter((r) => r.status !== "suppressed_by_preference");
  if (attempted.length > 0) return "delivered";
  return rule === "delivered" ? "delivered" : "opted_out";
}
