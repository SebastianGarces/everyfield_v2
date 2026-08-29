import { createHash } from "node:crypto";

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

function serializedPreview(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized)
    throw new Error("Task confirmation content is not serializable");
  if (serialized.length <= PREVIEW_CHUNK) return serialized;
  const digest = createHash("sha256").update(serialized).digest("hex");
  const marker = "… exact middle omitted from this display …";
  const footer = `Exact length ${serialized.length}; SHA-256 ${digest}`;
  const room = PREVIEW_CHUNK - marker.length - footer.length - 2;
  const prefix = Math.ceil(room / 2);
  const suffix = Math.floor(room / 2);
  return `${serialized.slice(0, prefix)}\n${marker}\n${serialized.slice(-suffix)}\n${footer}`;
}

function chunks(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  if (!serialized)
    throw new Error("Task confirmation content is not serializable");
  if (serialized.length <= PREVIEW_CHUNK) {
    return [{ label, content: serialized }];
  }
  const parts: { label: string; content: string }[] = [];
  for (
    let index = 0;
    index < serialized.length && parts.length < 7;
    index += PREVIEW_CHUNK
  ) {
    parts.push({
      label: `${label} (${parts.length + 1})`,
      content: serialized.slice(index, index + PREVIEW_CHUNK),
    });
  }
  if (parts.length * PREVIEW_CHUNK < serialized.length) {
    parts.push({
      label: `${label} integrity`,
      content: serializedPreview(value),
    });
  }
  return parts;
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
  return {
    label: `Task ${index + 1}`,
    value: `Task ${write.taskId}: ${serializedPreview({
      title: write.after.title,
      changes,
    })}`,
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
        exclusions: args.exclusions.map(({ reason }) => ({
          reason,
          count: 1,
        })),
        dateTime: null,
        contentPreviews: chunks(
          {
            operation: args.operation,
            taskWrites: args.taskWrites,
            dependencySets: args.dependencySets,
            notifications: args.notifications,
            phaseTransition: args.phaseTransition,
            completionEffects: args.completionEffects,
            sourceAssertion: args.sourceAssertion,
          },
          "Immutable Task plan evidence"
        ),
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
