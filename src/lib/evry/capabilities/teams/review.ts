import { toCalendarDate, utcOffsetForZonedTime } from "@/lib/datetime";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
} from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryActionStep } from "@/lib/evry/plans";

import { TEAMS_CAPABILITIES } from "./catalog";
import {
  parseTeamsEffectArguments,
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  type TeamsEffectArguments,
  type TeamsEffectOperation,
} from "./effect-contracts";

const MAX_PREVIEW = 4_000;

function planPages(args: TeamsEffectArguments) {
  const json = JSON.stringify(args);
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
  const summary = JSON.stringify(
    args.disclosure.changes.map((change) => ({
      label: change.label,
      value: change[side],
    }))
  );
  if (summary.length <= MAX_PREVIEW) return summary;
  return `${args.mutations.length} exact row ${side} states; see the complete immutable plan pages below.`;
}

const OPERATION_BY_IDENTITY = new Map(
  Object.entries(TEAMS_EFFECT_IDENTITY_BY_OPERATION).map(
    ([operation, identity]) => [identity, operation as TeamsEffectOperation]
  )
);

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
        counts: args.disclosure.counts,
        exclusions: [],
        dateTime: dateTime(args),
        contentPreviews: planPages(args),
        beforeAfter:
          destructive || bulk || changesExistingRows
            ? [
                {
                  label: destructive
                    ? "Destructive scope"
                    : "Exact multi-row scope",
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
