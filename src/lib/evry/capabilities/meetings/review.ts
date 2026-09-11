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
import { meetingsEffectDisclosure } from "./effect-disclosure";
import { MEETINGS_EFFECT_ARGUMENT_SCHEMAS } from "./effect-contracts";

const MAX_PREVIEW_CHARACTERS = 4_000;
const MAX_STATE_PAGE_CHARACTERS = 3_500;

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function splitExactPages(value: string, limit = MAX_PREVIEW_CHARACTERS) {
  if (value.length === 0) return [JSON.stringify(value)];
  const pages: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + limit, value.length);
    const finalCodeUnit = value.charCodeAt(end - 1);
    if (
      end < value.length &&
      finalCodeUnit >= 0xd800 &&
      finalCodeUnit <= 0xdbff
    ) {
      end -= 1;
    }
    pages.push(value.slice(start, end));
    start = end;
  }
  return pages;
}

function exactJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    throw new Error("Meetings confirmation content is not serializable");
  }
  return serialized;
}

function paginatedPreview(label: string, content: string) {
  const pages = splitExactPages(content);
  return pages.map((page, index) => ({
    label:
      pages.length === 1
        ? label
        : `${label} (page ${index + 1} of ${pages.length})`,
    content: page,
  }));
}

function sourceLinkFor(source: "meeting" | "person" | "none", value: string) {
  if (source === "meeting") {
    return { label: "Open meeting", href: `/meetings/${value}` };
  }
  if (source === "person") {
    return { label: "Open person", href: `/people/${value}` };
  }
  return null;
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
  const previews = previewKeys.flatMap((key) => {
    const value = arguments_[key];
    if (value === undefined || value === null || value === "") return [];
    return paginatedPreview(humanize(key), exactJson(value));
  });
  previews.push(
    ...paginatedPreview("Complete immutable plan", exactJson(arguments_))
  );
  return previews;
}

function displayState(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : exactJson(value);
}

function statePageEnvelope(input: {
  page: string | null;
  index: number;
  total: number;
}): string {
  return JSON.stringify({
    page: input.page === null ? null : input.index + 1,
    total: input.total,
    content: input.page,
  });
}

function paginatedBeforeAfter(input: {
  label: string;
  before: unknown;
  after: unknown;
  count: number;
}) {
  const before = displayState(input.before);
  const after = displayState(input.after);
  if (
    before.length <= MAX_PREVIEW_CHARACTERS &&
    after.length <= MAX_PREVIEW_CHARACTERS
  ) {
    return [{ ...input, before, after }];
  }
  const beforePages = splitExactPages(before, MAX_STATE_PAGE_CHARACTERS);
  const afterPages = splitExactPages(after, MAX_STATE_PAGE_CHARACTERS);
  const total = Math.max(beforePages.length, afterPages.length);
  return Array.from({ length: total }, (_, index) => ({
    label: `${input.label} (page ${index + 1} of ${total})`,
    before: statePageEnvelope({
      page: beforePages[index] ?? null,
      index,
      total: beforePages.length,
    }),
    after: statePageEnvelope({
      page: afterPages[index] ?? null,
      index,
      total: afterPages.length,
    }),
    count: input.count,
  }));
}

function resolvedTargetsFor(
  targets: ReturnType<typeof meetingsEffectDisclosure>["targets"]
) {
  return targets.map(({ label, value, source }) => ({
    label,
    value,
    sourceLink: sourceLinkFor(source, value),
  }));
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
  const after =
    arguments_.after && typeof arguments_.after === "object"
      ? (arguments_.after as Record<string, unknown>)
      : null;
  const instantValue =
    arguments_.datetime ??
    arguments_.meetingDatetime ??
    after?.datetime ??
    before?.datetime;
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
      utcOffset: utcOffsetForZonedTime(calendarDate, hour, minute, instant),
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
  if (
    identity === "meetings.create" ||
    identity === "meetings.lifecycle.update"
  ) {
    return "meeting" as const;
  }
  if (identity === "meetings.lifecycle.delete") return "destructive" as const;
  if (identity === "meetings.attendance.batch-record") {
    return "bulk_change" as const;
  }
  return "other" as const;
}

function reviewFor(input: {
  identity: keyof typeof CONTRACT_BY_ID;
  plan: EvryConversationPlanIdentity;
  step: EvryActionStep;
}) {
  const contract = CONTRACT_BY_ID[input.identity];
  const schema = MEETINGS_EFFECT_ARGUMENT_SCHEMAS[contract.exportName];
  const arguments_ = schema.parse(input.step.arguments);
  const disclosure = meetingsEffectDisclosure(contract.exportName, arguments_);
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: contract.label,
    actionLabel: contract.actionLabel,
    consequences: disclosure.consequences,
    steps: [
      {
        stepId: input.step.id,
        title: contract.label,
        effectKind: effectKind(input.identity),
        reversibility: disclosure.reversibility,
        resolvedTargets: resolvedTargetsFor(disclosure.targets),
        counts: disclosure.counts.map(({ label, count }) => ({ label, count })),
        exclusions: [],
        dateTime: dateTimeFor(arguments_),
        contentPreviews: collectContentPreviews(arguments_),
        beforeAfter: disclosure.beforeAfter.flatMap(paginatedBeforeAfter),
      },
    ],
  });
}

const CONTRACT_BY_ID = Object.fromEntries(
  Object.entries(MEETINGS_ACTION_CONTRACTS).map(([exportName, contract]) => [
    contract.operationId,
    {
      ...contract,
      exportName: exportName as keyof typeof MEETINGS_ACTION_CONTRACTS,
    },
  ])
) as Record<
  string,
  (typeof MEETINGS_ACTION_CONTRACTS)[keyof typeof MEETINGS_ACTION_CONTRACTS] & {
    exportName: keyof typeof MEETINGS_ACTION_CONTRACTS;
  }
>;

export const MEETINGS_ARTIFACT_REVIEWS = Object.freeze(
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

export const MEETINGS_REVIEW_REGISTRY: EvryArtifactReviewRegistry =
  createEvryArtifactReviewRegistry(MEETINGS_ARTIFACT_REVIEWS);
