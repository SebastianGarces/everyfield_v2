import { toCalendarDate, utcOffsetForZonedTime } from "@/lib/datetime";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryActionStep } from "@/lib/evry/plans";

import { MEETINGS_ACTION_CONTRACTS } from "./catalog";
import { MEETINGS_EFFECT_ARGUMENT_SCHEMAS } from "./effect-contracts";

const MAX_PREVIEW_CHARACTERS = 4_000;

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function compactJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > MAX_PREVIEW_CHARACTERS) {
    throw new Error("Meetings confirmation content is too large to disclose");
  }
  return serialized;
}

function sourceLinkFor(key: string, value: string) {
  if (key === "meetingId") {
    return { label: "Open meeting", href: `/meetings/${value}` };
  }
  if (key === "personId") {
    return { label: "Open person", href: `/people/${value}` };
  }
  return null;
}

function collectTargets(arguments_: Readonly<Record<string, unknown>>) {
  const targets: {
    label: string;
    value: string;
    sourceLink: { label: string; href: string } | null;
  }[] = [];
  const seen = new Set<string>();
  const add = (key: string, value: string) => {
    const identity = `${key}:${value}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    targets.push({
      label: humanize(key),
      value,
      sourceLink: sourceLinkFor(key, value),
    });
  };

  for (const [key, value] of Object.entries(arguments_)) {
    if (typeof value === "string" && /Id$/.test(key)) add(key, value);
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && /Ids$/.test(key)) {
        add(key.slice(0, -1), item);
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      for (const [itemKey, itemValue] of Object.entries(item)) {
        if (typeof itemValue === "string" && /Id$/.test(itemKey)) {
          add(itemKey, itemValue);
        }
      }
    }
  }
  if (targets.length === 0) {
    throw new Error("Meetings confirmation omitted its resolved target");
  }
  return targets;
}

function collectCounts(arguments_: Readonly<Record<string, unknown>>) {
  const counts = Object.entries(arguments_)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([key, value]) => ({ label: humanize(key), count: value.length }));
  return counts.length > 0 ? counts : [{ label: "Records changed", count: 1 }];
}

function collectContentPreviews(arguments_: Readonly<Record<string, unknown>>) {
  const previewKeys = [
    "title",
    "note",
    "notes",
    "agenda",
    "beforeSections",
    "afterSections",
    "records",
  ];
  return previewKeys.flatMap((key) => {
    const value = arguments_[key];
    if (value === undefined || value === null || value === "") return [];
    return [{ label: humanize(key), content: compactJson(value) }];
  });
}

function collectBeforeAfter(arguments_: Readonly<Record<string, unknown>>) {
  if (arguments_.before !== undefined && arguments_.after !== undefined) {
    return [
      {
        label: "State",
        before: compactJson(arguments_.before),
        after: compactJson(arguments_.after),
        count: 1,
      },
    ];
  }
  if (
    arguments_.beforeSections !== undefined &&
    arguments_.afterSections !== undefined
  ) {
    return [
      {
        label: "Agenda",
        before: compactJson(arguments_.beforeSections),
        after: compactJson(arguments_.afterSections),
        count: 1,
      },
    ];
  }
  if (arguments_.beforeStatus !== undefined) {
    return [
      {
        label: "Status",
        before: String(arguments_.beforeStatus ?? "Not set"),
        after: String(arguments_.afterStatus ?? "Not set"),
        count: 1,
      },
    ];
  }
  if (arguments_.beforeResponse !== undefined) {
    return [
      {
        label: "Response card",
        before: compactJson(arguments_.beforeResponse ?? { recorded: false }),
        after:
          arguments_.responseType === undefined
            ? "No response card"
            : compactJson({
                responseType: arguments_.responseType,
                notes: arguments_.notes ?? null,
              }),
        count: 1,
      },
    ];
  }
  return [];
}

function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

function dateTimeFor(arguments_: Readonly<Record<string, unknown>>) {
  const before =
    arguments_.before && typeof arguments_.before === "object"
      ? (arguments_.before as Record<string, unknown>)
      : null;
  const instantValue = arguments_.datetime ?? before?.datetime;
  const timeZone = arguments_.timezone;
  if (typeof instantValue !== "string" || typeof timeZone !== "string") {
    return null;
  }
  const instant = new Date(instantValue);
  const calendarDate = toCalendarDate(instant, timeZone);
  const time = localTime(instant, timeZone);
  const match = /^(\d{1,2}):(\d{2})\s(AM|PM)$/.exec(time);
  if (!match) throw new Error("Meetings confirmation time is invalid");
  const statedHour = Number(match[1]);
  const hour = (statedHour % 12) + (match[3] === "PM" ? 12 : 0);
  const minute = Number(match[2]);
  return {
    startsAt: {
      calendarDate,
      localTime: time,
      timeZone,
      utcOffset: utcOffsetForZonedTime(
        calendarDate,
        hour,
        minute,
        instant
      ),
      instantUtc: instant.toISOString(),
      interpretation: {
        basis: "explicit-calendar-date" as const,
        sourceText: `${calendarDate} ${time} ${timeZone}`,
        statedCalendarDate: calendarDate,
      },
    },
    endsAt: null,
  };
}

function effectKind(identity: string) {
  if (identity === "meetings.create" || identity === "meetings.lifecycle.update") {
    return "meeting" as const;
  }
  if (identity === "meetings.lifecycle.delete") return "destructive" as const;
  if (identity === "meetings.attendance.batch-record") {
    return "bulk_change" as const;
  }
  return "other" as const;
}

function consequences(identity: string, difficultToReverse: boolean) {
  if (identity === "meetings.lifecycle.delete") {
    return [
      "This permanently deletes the meeting and every disclosed dependent record.",
      "Pending reminders disclosed in this plan will be cancelled.",
    ];
  }
  if (identity.startsWith("meetings.attendance.person-create")) {
    return [
      "This creates one CRM person and one meeting attendance record together.",
      "The new person becomes visible throughout this plant.",
    ];
  }
  return [
    difficultToReverse
      ? "This changes the disclosed Meetings records and may be difficult to reverse."
      : "This changes only the disclosed Meetings records and downstream targets.",
  ];
}

function reviewFor(input: {
  identity: keyof typeof CONTRACT_BY_ID;
  plan: EvryConversationPlanIdentity;
  step: EvryActionStep;
}) {
  const contract = CONTRACT_BY_ID[input.identity];
  const schema = MEETINGS_EFFECT_ARGUMENT_SCHEMAS[contract.exportName];
  const arguments_ = schema.parse(input.step.arguments) as Readonly<
    Record<string, unknown>
  >;
  const beforeAfter = collectBeforeAfter(arguments_);
  if (contract.difficultToReverse && beforeAfter.length === 0) {
    beforeAfter.push({
      label: "Record",
      before: compactJson(arguments_.before ?? arguments_),
      after: "Removed",
      count: 1,
    });
  }
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: contract.label,
    actionLabel: contract.actionLabel,
    consequences: consequences(input.identity, contract.difficultToReverse),
    steps: [
      {
        stepId: input.step.id,
        title: contract.label,
        effectKind: effectKind(input.identity),
        reversibility: contract.difficultToReverse
          ? "difficult_to_reverse"
          : "reversible",
        resolvedTargets: collectTargets(arguments_),
        counts: collectCounts(arguments_),
        exclusions: [],
        dateTime: dateTimeFor(arguments_),
        contentPreviews: collectContentPreviews(arguments_),
        beforeAfter,
      },
    ],
  });
}

const CONTRACT_BY_ID = Object.fromEntries(
  Object.entries(MEETINGS_ACTION_CONTRACTS).map(([exportName, contract]) => [
    contract.operationId,
    { ...contract, exportName: exportName as keyof typeof MEETINGS_ACTION_CONTRACTS },
  ])
) as Record<
  string,
  (typeof MEETINGS_ACTION_CONTRACTS)[keyof typeof MEETINGS_ACTION_CONTRACTS] & {
    exportName: keyof typeof MEETINGS_ACTION_CONTRACTS;
  }
>;

export const MEETINGS_REVIEW_REGISTRY: EvryArtifactReviewRegistry =
  createEvryArtifactReviewRegistry(
    Object.keys(CONTRACT_BY_ID).map((identity) =>
      defineEvryArtifactReview({
        source: {
          kind: "generic",
          capabilityIdentities: [identity],
        },
        build({ plan, document }) {
          const step = document.steps[0];
          if (!step || step.capabilityIdentity !== identity) {
            throw new Error("Meetings review source did not match its plan");
          }
          return reviewFor({ identity, plan, step });
        },
      })
    )
  );
