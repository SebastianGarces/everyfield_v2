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
  limit: number
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
  const rows = [
    ...journal.map((entry) => ({
      id: entry.id,
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
      label: `Milestone completed: ${entry.title}`,
      at: entry.completedAt,
      facts: [
        { label: "Area", value: entry.area },
        { label: "By", value: entry.actorName ?? "Former team member" },
      ],
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime());
  const visible = rows.slice(0, limit);
  return buildEvryReadArtifact({
    title: "Launch history",
    filters: [{ label: "Plant", value: "Current plant" }],
    exclusions:
      rows.length > visible.length
        ? [
            {
              reason: "Older history not shown",
              count: rows.length - visible.length,
            },
          ]
        : [],
    items: visible.map((entry) => ({
      id: entry.id,
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
  inputShape: { limit: z.number().int().min(1).max(100) },
  run: ({ authorization }, { limit }) =>
    readLaunchJournalForPlant(authorization.actor.plantId, limit),
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
    return { readId: "launch.journal", input: { limit: 100 } };
  }
  return null;
}

export const continueLaunchEvryRead = createEvryReadContinuation({
  registrations: LAUNCH_READ_REGISTRATIONS,
  select({ literalUserText }) {
    return Promise.resolve(selectLaunchEvryRead(literalUserText));
  },
});
