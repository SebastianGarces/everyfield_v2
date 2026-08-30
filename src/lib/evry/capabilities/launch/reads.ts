import { createHash } from "node:crypto";

import { z } from "zod";

import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { getLaunchJournalEntries } from "@/lib/launch/journal";
import {
  getLaunchMilestoneHistory,
  getLaunchReadiness,
} from "@/lib/launch/milestones";
import { getLaunchForChurch } from "@/lib/launch/queries";

export const LAUNCH_READ_IDENTITIES = {
  status: "launch.read.status",
  readiness: "launch.read.readiness",
  journal: "launch.read.journal",
} as const;

const link = trustedEvryApplicationSourceLink({
  label: "Open Launch Sunday",
  href: "/launch",
});

const noInput = {};
export const launchJournalCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
const decodedLaunchJournalCursorSchema = z.strictObject({
  a: z.string().datetime(),
  k: z.string().min(1).max(200),
  f: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

function encodeLaunchJournalCursor(
  row: { at: Date; key: string },
  sourceFingerprint: string
): string {
  return Buffer.from(
    JSON.stringify({
      a: row.at.toISOString(),
      k: row.key,
      f: sourceFingerprint,
    }),
    "utf8"
  ).toString("base64url");
}

function decodeLaunchJournalCursor(value: string) {
  try {
    return decodedLaunchJournalCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    );
  } catch {
    return null;
  }
}

export type LaunchJournalPageRow = Readonly<{
  id: string;
  key: string;
  label: string;
  at: Date;
  facts: readonly Readonly<{ label: string; value: string }>[];
}>;

export type LaunchJournalPage =
  | Readonly<{
      status: "available";
      rows: readonly LaunchJournalPageRow[];
      nextCursor: string | null;
      remaining: number;
    }>
  | Readonly<{
      status: "invalid_cursor" | "missing_cursor" | "stale_cursor";
      rows: readonly [];
      nextCursor: null;
      remaining: 0;
    }>;

function launchJournalSourceFingerprint(
  rows: readonly LaunchJournalPageRow[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows.map(({ id, key, label, at, facts }) => ({
          id,
          key,
          label,
          at: at.toISOString(),
          facts,
        }))
      )
    )
    .digest("base64url");
}

/**
 * Lossless cursor paging over the merged history.
 *
 * Launch events are append-only, but milestone completions are a mutable
 * projection: reopening removes a completion and completing it again changes
 * its ordering instant. Every continuation therefore carries the fingerprint
 * of the exact sorted source it paged. A changed source refuses the cursor and
 * asks the caller to restart instead of silently skipping or duplicating a row.
 */
export function paginateLaunchJournalRows(
  inputRows: readonly LaunchJournalPageRow[],
  limit: number,
  cursor: string | null
): LaunchJournalPage {
  const rows = [...inputRows].sort(
    (left, right) =>
      right.at.getTime() - left.at.getTime() ||
      right.key.localeCompare(left.key)
  );
  const decodedCursor = cursor ? decodeLaunchJournalCursor(cursor) : null;
  if (cursor && !decodedCursor) {
    return {
      status: "invalid_cursor",
      rows: [],
      nextCursor: null,
      remaining: 0,
    };
  }
  const sourceFingerprint = launchJournalSourceFingerprint(rows);
  if (decodedCursor && decodedCursor.f !== sourceFingerprint) {
    return {
      status: "stale_cursor",
      rows: [],
      nextCursor: null,
      remaining: 0,
    };
  }
  const start = decodedCursor
    ? rows.findIndex(
        (row) =>
          row.at.toISOString() === decodedCursor.a &&
          row.key === decodedCursor.k
      ) + 1
    : 0;
  if (decodedCursor && start === 0) {
    return {
      status: "missing_cursor",
      rows: [],
      nextCursor: null,
      remaining: 0,
    };
  }
  const visible = rows.slice(start, start + limit);
  const remaining = Math.max(0, rows.length - start - visible.length);
  return {
    status: "available",
    rows: visible,
    nextCursor:
      remaining > 0 && visible.length > 0
        ? encodeLaunchJournalCursor(
            visible[visible.length - 1]!,
            sourceFingerprint
          )
        : null,
    remaining,
  };
}

/** Split by UTF-16 storage units without tearing an astral code point. */
function displayChunks(value: string | null, maximum = 3_800): string[] {
  if (!value) return [];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + maximum);
    const last = value.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks;
}

/** Plant-scoped application read shared by the authorized adapter and PG proof. */
export async function readLaunchStatusForPlant(plantId: string) {
  const launch = await getLaunchForChurch(plantId);
  return buildEvryReadArtifact({
    title: "Launch status",
    filters: [{ label: "Plant", value: "Current plant" }],
    exclusions: [],
    items: launch
      ? [
          {
            id: launch.id,
            label: "Launch Sunday",
            facts: [
              { label: "Status", value: launch.status },
              {
                label: "Target date",
                value: launch.targetDate ?? "Not scheduled",
              },
              {
                label: "Attendance",
                value:
                  launch.attendanceCount === null
                    ? "Not recorded"
                    : String(launch.attendanceCount),
              },
              {
                label: "Decisions",
                value:
                  launch.decisionsCount === null
                    ? "Not recorded"
                    : String(launch.decisionsCount),
              },
            ],
            sourceLink: link,
          },
          ...displayChunks(launch.outcomeNotes).map((value, index, all) => ({
            id: `${launch.id}:outcome-notes:${index + 1}`,
            label: `Outcome notes${all.length > 1 ? ` (${index + 1} of ${all.length})` : ""}`,
            facts: [{ label: "Exact text", value }],
            sourceLink: link,
          })),
          ...displayChunks(launch.captureTheDay).map((value, index, all) => ({
            id: `${launch.id}:capture-the-day:${index + 1}`,
            label: `Capture the day${all.length > 1 ? ` (${index + 1} of ${all.length})` : ""}`,
            facts: [{ label: "Exact text", value }],
            sourceLink: link,
          })),
        ]
      : [
          {
            id: "launch:planning",
            label: "Launch Sunday",
            facts: [
              { label: "Status", value: "planning" },
              { label: "Target date", value: "Not scheduled" },
            ],
            sourceLink: link,
          },
        ],
    sourceLinks: [link],
  });
}

export const LAUNCH_STATUS_READ = defineEvryReadRegistration({
  id: "launch.status",
  capabilityIdentity: LAUNCH_READ_IDENTITIES.status,
  inputShape: noInput,
  run: ({ authorization }) =>
    readLaunchStatusForPlant(authorization.actor.plantId),
});

/** Pure readiness projection: unlike the owning page, this never seeds rows. */
export async function readLaunchReadinessForPlant(plantId: string) {
  const launch = await getLaunchForChurch(plantId);
  const readiness = launch
    ? await getLaunchReadiness(launch.id, plantId)
    : null;
  return buildEvryReadArtifact({
    title: "Launch readiness",
    filters: [{ label: "Plant", value: "Current plant" }],
    exclusions: [],
    items: (readiness?.milestones ?? []).flatMap((milestone) => [
      {
        id: milestone.id,
        label: milestone.title,
        facts: [
          { label: "Area", value: milestone.area },
          {
            label: "Description",
            value: milestone.description ?? "(None)",
          },
          {
            label: "Status",
            value: milestone.isComplete ? "Complete" : "Open",
          },
          {
            label: "Tasks complete",
            value: `${milestone.completedTaskCount} of ${milestone.tasks.length}`,
          },
        ],
        sourceLink: link,
      },
      ...milestone.tasks.map((task) => ({
        id: task.id,
        label: task.title,
        facts: [
          { label: "Milestone", value: milestone.title },
          { label: "Status", value: task.status },
          { label: "Due date", value: task.dueDate ?? "Not set" },
          { label: "Assignee", value: task.assigneeName ?? "Unassigned" },
        ],
        sourceLink: link,
      })),
    ]),
    sourceLinks: [link],
  });
}

export const LAUNCH_READINESS_READ = defineEvryReadRegistration({
  id: "launch.readiness",
  capabilityIdentity: LAUNCH_READ_IDENTITIES.readiness,
  inputShape: noInput,
  run: ({ authorization }) =>
    readLaunchReadinessForPlant(authorization.actor.plantId),
});

/** Bounded plant-scoped journal projection shared by adapter and PG proof. */
export async function readLaunchJournalForPlant(
  plantId: string,
  limit: number,
  cursor: string | null = null
) {
  const launch = await getLaunchForChurch(plantId);
  if (!launch) {
    return buildEvryReadArtifact({
      title: "Launch history",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [],
      items: [],
      sourceLinks: [link],
    });
  }
  const [journal, milestones] = await Promise.all([
    getLaunchJournalEntries(launch.id, plantId),
    getLaunchMilestoneHistory(launch.id, plantId),
  ]);
  const rows: LaunchJournalPageRow[] = [
    ...journal.map((entry) => ({
      id: entry.id,
      key: `journal:${entry.id}`,
      label:
        entry.previousStatus === "completed"
          ? "Outcome corrected"
          : `Launch ${entry.event}`,
      at: entry.createdAt,
      facts: [
        { label: "Status", value: entry.status },
        { label: "Date", value: entry.targetDate ?? "Not scheduled" },
        { label: "By", value: entry.actorName ?? "Former team member" },
        { label: "Note", value: entry.note ?? "(None)" },
      ],
    })),
    ...milestones.map((entry) => ({
      id: entry.milestoneId,
      key: `milestone:${entry.milestoneId}`,
      label: `Milestone completed: ${entry.title}`,
      at: entry.completedAt,
      facts: [
        { label: "Area", value: entry.area },
        { label: "By", value: entry.actorName ?? "Former team member" },
      ],
    })),
  ];
  const page = paginateLaunchJournalRows(rows, limit, cursor);
  if (page.status !== "available") {
    return buildEvryReadArtifact({
      title: "Launch history",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [
        {
          reason:
            page.status === "invalid_cursor"
              ? "Invalid history cursor"
              : page.status === "missing_cursor"
                ? "History cursor is no longer available"
                : "Launch history changed; restart without a cursor",
          count: 1,
        },
      ],
      items: [],
      sourceLinks: [link],
    });
  }
  return buildEvryReadArtifact({
    title: "Launch history",
    filters: [{ label: "Plant", value: "Current plant" }],
    exclusions: page.nextCursor
      ? [
          {
            reason: `Older history available after cursor ${page.nextCursor}`,
            count: page.remaining,
          },
        ]
      : [],
    items: page.rows.map((entry) => ({
      id: entry.key,
      label: entry.label,
      facts: [...entry.facts, { label: "When", value: entry.at.toISOString() }],
      sourceLink: link,
    })),
    sourceLinks: [link],
  });
}

export const LAUNCH_JOURNAL_READ = defineEvryReadRegistration({
  id: "launch.journal",
  capabilityIdentity: LAUNCH_READ_IDENTITIES.journal,
  inputShape: {
    limit: z.number().int().min(1).max(100),
    cursor: launchJournalCursorSchema.nullable(),
  },
  run: ({ authorization }, { limit, cursor }) =>
    readLaunchJournalForPlant(authorization.actor.plantId, limit, cursor),
});

export const LAUNCH_READ_REGISTRATIONS = [
  LAUNCH_STATUS_READ,
  LAUNCH_READINESS_READ,
  LAUNCH_JOURNAL_READ,
] as const;

export function selectLaunchEvryRead(literalUserText: string) {
  const text = literalUserText.normalize("NFKC").trim();
  if (
    /^(?:show|what(?:'s| is)|read) (?:the )?launch (?:status|date|outcome)[.!?]*$/i.test(
      text
    )
  ) {
    return { readId: "launch.status", input: {} };
  }
  if (
    /^(?:show|read) (?:the )?launch (?:readiness|milestones)[.!?]*$/i.test(text)
  ) {
    return { readId: "launch.readiness", input: {} };
  }
  if (/^(?:show|read) (?:the )?launch (?:history|journal)[.!?]*$/i.test(text)) {
    return { readId: "launch.journal", input: { limit: 100, cursor: null } };
  }
  const older =
    /^(?:show|read) (?:the )?launch (?:history|journal) after ([A-Za-z0-9_-]+)[.!?]*$/i.exec(
      text
    );
  if (older?.[1]) {
    const cursor = launchJournalCursorSchema.safeParse(older[1]);
    if (cursor.success) {
      return {
        readId: "launch.journal",
        input: { limit: 100, cursor: cursor.data },
      };
    }
  }
  return null;
}

export const continueLaunchEvryRead = createEvryReadContinuation({
  registrations: LAUNCH_READ_REGISTRATIONS,
  select({ literalUserText }) {
    return Promise.resolve(selectLaunchEvryRead(literalUserText));
  },
});
