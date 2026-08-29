import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryActionStep } from "@/lib/evry/plans";

import { TASK_ACTION_CONTRACTS, type TaskActionExport } from "./contracts";
import {
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
  type AnyTaskEffectArguments,
  type TaskEffectExport,
} from "./effect-contracts";

const PREVIEW_CHUNK = 3_800;

function serialized(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized)
    throw new Error("Task confirmation content is not serializable");
  return serialized;
}

function chunks(value: unknown, label: string) {
  const exact = serialized(value);
  if (exact.length <= PREVIEW_CHUNK) {
    return [{ label, content: exact }];
  }
  const parts: { label: string; content: string }[] = [];
  for (let index = 0; index < exact.length; index += PREVIEW_CHUNK) {
    parts.push({
      label: `${label} (${parts.length + 1})`,
      content: exact.slice(index, index + PREVIEW_CHUNK),
    });
  }
  return parts;
}

function groupedExclusions(exclusions: AnyTaskEffectArguments["exclusions"]) {
  const counts = new Map<string, number>();
  for (const { reason } of exclusions) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

function taskWriteTarget(
  write: AnyTaskEffectArguments["taskWrites"][number],
  index: number
) {
  const changes = Object.fromEntries(
    Object.keys(write.after)
      .sort()
      .flatMap((key) => {
        const field = key as keyof typeof write.after;
        const before = write.before?.[field];
        const after = write.after[field];
        return write.before === null ||
          JSON.stringify(before) !== JSON.stringify(after)
          ? [
              [
                key,
                { before: write.before === null ? "Absent" : before, after },
              ],
            ]
          : [];
      })
  );
  const exactChanges = serialized({ title: write.after.title, changes });
  const targetPrefix = `Task ${write.taskId}: `;
  return {
    label: `Task ${index + 1}`,
    value:
      targetPrefix.length + exactChanges.length <= 4_000
        ? `${targetPrefix}${exactChanges}`
        : `${targetPrefix}${write.after.title}. Full exact before/after content is displayed in Immutable Task plan evidence below.`,
    sourceLink:
      write.before === null
        ? null
        : {
            label: "Open task",
            href: `/tasks/${write.taskId}`,
          },
  };
}

const CONTRACT_BY_ID = Object.fromEntries(
  Object.entries(TASK_ACTION_CONTRACTS).flatMap(([exportName, contract]) =>
    contract.operationKind === "effect"
      ? [
          [
            contract.operationId,
            {
              ...contract,
              exportName: exportName as TaskEffectExport,
            },
          ],
        ]
      : []
  )
) as Record<
  string,
  (typeof TASK_ACTION_CONTRACTS)[TaskActionExport] & {
    exportName: TaskEffectExport;
  }
>;

function reviewFor(input: {
  identity: string;
  plan: EvryConversationPlanIdentity;
  step: EvryActionStep;
}) {
  const contract = CONTRACT_BY_ID[input.identity];
  if (
    !contract ||
    contract.operationKind !== "effect" ||
    !contract.actionLabel
  ) {
    throw new Error("Task review has no effect contract");
  }
  const args = TASKS_EFFECT_ARGUMENT_SCHEMAS[contract.exportName].parse(
    input.step.arguments
  );
  const { disclosure } = args;
  const taskTargetPrefixes = args.taskWrites.map(
    ({ taskId }) => `Task ${taskId}:`
  );
  const effectKind =
    contract.exportName === "deleteTaskAction"
      ? ("destructive" as const)
      : contract.mutationShape === "bulk_write"
        ? ("bulk_change" as const)
        : contract.exportName === "importTaskTemplateAction" ||
            contract.exportName === "importPhaseTemplatesAction"
          ? ("file_import" as const)
          : ("other" as const);
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: disclosure.title,
    actionLabel: contract.actionLabel,
    consequences: disclosure.consequences,
    steps: [
      {
        stepId: input.step.id,
        title: disclosure.title,
        effectKind,
        reversibility: disclosure.reversibility,
        resolvedTargets: [
          ...args.taskWrites.map(taskWriteTarget),
          ...disclosure.targets
            .filter(
              (value) =>
                !taskTargetPrefixes.some((prefix) => value.startsWith(prefix))
            )
            .map((value, index) => ({
              label: `Additional target ${index + 1}`,
              value,
              sourceLink: null,
            })),
        ],
        counts: disclosure.counts,
        // The immutable evidence below retains every exact Task target. The
        // bounded summary groups repeated resolver-owned reasons so a legal
        // 100-Task completion cannot disappear at the shared 32-row boundary.
        exclusions: groupedExclusions(args.exclusions),
        dateTime: null,
        contentPreviews: chunks(args, "Immutable Task plan evidence"),
        beforeAfter: disclosure.changes.slice(0, 32).map((item) => ({
          ...item,
          count: 1,
        })),
      },
    ],
  });
}

export const TASK_ARTIFACT_REVIEWS = Object.freeze(
  Object.keys(CONTRACT_BY_ID).map((identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0];
        if (!step || step.capabilityIdentity !== identity) {
          throw new Error("Task review source did not match its plan");
        }
        return reviewFor({ identity, plan, step });
      },
    })
  )
);

export const TASK_REVIEW_REGISTRY: EvryArtifactReviewRegistry =
  createEvryArtifactReviewRegistry(TASK_ARTIFACT_REVIEWS);
