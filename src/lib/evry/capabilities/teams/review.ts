import { createHash } from "node:crypto";

import { toCalendarDate, utcOffsetForZonedTime } from "@/lib/datetime";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
} from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryActionStep } from "@/lib/evry/plans";
import { toWords } from "@/lib/phase-engine/fact-phrases";
import { exactEvryContentPages } from "@/lib/evry/artifacts/exact-content-pages";

import { TEAMS_CAPABILITIES } from "./catalog";
import {
  parseTeamsEffectArguments,
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  type TeamsEffectArguments,
  type TeamsEffectOperation,
} from "./effect-contracts";

const MAX_PREVIEW = 4_000;
const MAX_BROWSER_PREVIEW_PAGES = 64;

function planPages(args: TeamsEffectArguments) {
  const json = JSON.stringify(args);
  if (json.length > MAX_PREVIEW * MAX_BROWSER_PREVIEW_PAGES) {
    const counts = Object.fromEntries(
      [...new Set(args.mutations.map(({ table }) => table))].map((table) => [
        table,
        args.mutations.filter((mutation) => mutation.table === table).length,
      ])
    );
    return [
      {
        label: "Complete immutable plan manifest",
        content: JSON.stringify({
          operation: args.operation,
          utf16CodeUnits: json.length,
          sha256: createHash("sha256").update(json).digest("hex"),
          expectedRows: args.expected.length,
          exactSets: args.sets.length,
          mutationRows: args.mutations.length,
          notificationIntents: args.notificationIntents.length,
          mutationsByTable: counts,
          disclosure:
            "The stored plan and confirmation fingerprint bind every exact row; the browser preview is capped at 64 pages.",
        }),
      },
    ];
  }
  const pages: string[] = [];
  for (let start = 0; start < json.length; start += MAX_PREVIEW) {
    let end = Math.min(json.length, start + MAX_PREVIEW);
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    pages.push(json.slice(start, end));
    start = end - MAX_PREVIEW;
  }
  return pages.map((content, index) => ({
    label:
      pages.length === 1
        ? "Complete immutable plan"
        : `Complete immutable plan (page ${index + 1} of ${pages.length})`,
    content,
  }));
}

function dateTime(args: TeamsEffectArguments) {
  const timing = args.disclosure.dateTime;
  if (!timing) return null;
  const instant = new Date(timing.instantUtc);
  const calendarDate = toCalendarDate(instant, timing.timeZone);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timing.timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
  const match = /^(\d{1,2}):(\d{2})\s(AM|PM)$/.exec(localTime);
  if (!match) throw new Error("Teams meeting time could not be rendered");
  const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
  return {
    startsAt: {
      calendarDate,
      localTime,
      timeZone: timing.timeZone,
      utcOffset: utcOffsetForZonedTime(
        calendarDate,
        hour,
        Number(match[2]),
        instant
      ),
      instantUtc: timing.instantUtc,
      interpretation: {
        basis: "explicit-calendar-date" as const,
        sourceText: `${calendarDate} ${localTime} ${timing.timeZone}`,
        statedCalendarDate: calendarDate,
      },
    },
    endsAt: null,
  };
}

function changeSummary(
  args: TeamsEffectArguments,
  side: "before" | "after"
): string {
  const summary = args.mutations
    .map((change) => {
      const row = change[side];
      if (!row)
        return side === "before" ? "Not yet created" : "Will be removed";
      const fields = Object.entries(row).filter(
        ([key, value]) =>
          key !== "id" &&
          !key.endsWith("_id") &&
          ![
            "created_by",
            "created_at",
            "updated_at",
            "sort_order",
            "template_key",
            "responsibilities_seeded_at",
          ].includes(key) &&
          (value === null ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean") &&
          (change.mode !== "update" ||
            change.before?.[key] !== change.after?.[key])
      );
      if (!fields.length)
        return side === "before"
          ? "Current assignment"
          : "Assignment as reviewed above";
      return fields
        .map(
          ([key, value]) =>
            `${toWords(key)}: ${value === null || value === "" ? "Not set" : typeof value === "boolean" ? (value ? "Yes" : "No") : key === "status" ? toWords(String(value)) : String(value)}`
        )
        .join("; ");
    })
    .join("\n");
  if (summary.length <= MAX_PREVIEW) return summary;
  return `${args.mutations.length.toLocaleString()} changes across the reviewed teams. ${side === "before" ? "Current team records" : "The proposed team structure"}.`;
}

const OPERATION_BY_IDENTITY = new Map(
  Object.entries(TEAMS_EFFECT_IDENTITY_BY_OPERATION).map(
    ([operation, identity]) => [identity, operation as TeamsEffectOperation]
  )
);

function proposedEdits(args: TeamsEffectArguments) {
  const fields = new Map<string, string[]>();
  for (const mutation of args.mutations) {
    if (!mutation.after) continue;
    for (const [key, value] of Object.entries(mutation.after)) {
      if (
        key === "id" ||
        key.endsWith("_id") ||
        [
          "created_by",
          "created_at",
          "updated_at",
          "responsibilities_seeded_at",
          "sort_order",
          "template_key",
          "phase_introduced",
        ].includes(key) ||
        value === mutation.before?.[key] ||
        (!mutation.before && (value === null || value === "")) ||
        (value !== null && typeof value === "object")
      )
        continue;
      const label = `Proposed ${toWords(key)}`;
      let content =
        value === null || value === ""
          ? `Remove existing ${toWords(key)}.`
          : typeof value === "boolean"
            ? value
              ? "Yes"
              : "No"
            : String(value);
      const name = mutation.after.name ?? mutation.after.title;
      if (
        args.mutations.length > 1 &&
        typeof name === "string" &&
        key !== "name" &&
        key !== "title"
      )
        content = `${name}: ${content}`;
      const values = fields.get(label) ?? [];
      values.push(content);
      fields.set(label, values);
    }
  }
  return [...fields].flatMap(([label, values]) =>
    exactEvryContentPages(values.join("\n")).map((content, index) => ({
      label: index === 0 ? label : `${label} continued ${index + 1}`,
      content,
      format: "plain_text" as const,
    }))
  );
}
function review(input: {
  plan: EvryConversationPlanIdentity;
  step: EvryActionStep;
  identity: string;
}) {
  const operation = OPERATION_BY_IDENTITY.get(input.identity);
  if (!operation) throw new Error("Unknown Teams review identity");
  const args = parseTeamsEffectArguments(operation, input.step.arguments);
  const destructive = args.disclosure.reversibility !== "reversible";
  const bulk = args.mutations.length > 1;
  const changesExistingRows = args.mutations.some(
    ({ before }) => before !== null
  );
  const counts = args.disclosure.counts
    .filter(({ label }) => !/database|^rows$|^total rows$/i.test(label))
    .map(({ label, count }) => ({
      label: label
        .replace(/ created$/, " to create")
        .replace(/ added$/, " to add")
        .replace(/Role rows/, "Roles"),
      count,
    }));
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: args.disclosure.title,
    actionLabel: args.disclosure.title,
    consequences: args.disclosure.consequences,
    steps: [
      {
        stepId: input.step.id,
        title: args.disclosure.title,
        effectKind:
          operation === "createMeetingAction"
            ? "meeting"
            : destructive
              ? "destructive"
              : bulk
                ? "bulk_change"
                : "other",
        reversibility: args.disclosure.reversibility,
        resolvedTargets: args.disclosure.targets.map((target) => ({
          label: target.label,
          value: target.value,
          sourceLink: target.href
            ? { label: `Open ${target.label.toLowerCase()}`, href: target.href }
            : null,
        })),
        counts: counts.length
          ? counts
          : [{ label: "Changes", count: args.mutations.length }],
        exclusions: [],
        dateTime: dateTime(args),
        contentPreviews: [...planPages(args), ...proposedEdits(args)],
        beforeAfter:
          destructive || bulk || changesExistingRows
            ? [
                {
                  label: destructive
                    ? "What will be removed"
                    : "Proposed changes",
                  before: changeSummary(args, "before"),
                  after: changeSummary(args, "after"),
                  count: args.mutations.length,
                },
              ]
            : [],
      },
    ],
  });
}

export const TEAMS_ARTIFACT_REVIEWS = Object.freeze(
  TEAMS_CAPABILITIES.filter(
    ({ operationKind }) => operationKind === "effect"
  ).map((capability) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [capability.identity] },
      build({ plan, document }) {
        const step = document.steps[0];
        if (
          !step ||
          document.steps.length !== 1 ||
          step.capabilityIdentity !== capability.identity
        )
          throw new Error("Teams review source did not match its plan");
        return review({ plan, step, identity: capability.identity });
      },
    })
  )
);

export const TEAMS_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  TEAMS_ARTIFACT_REVIEWS
);
