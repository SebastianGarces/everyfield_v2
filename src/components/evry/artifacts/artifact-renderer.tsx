"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  CircleX,
  Clock3,
  FileText,
  ListChecks,
  LoaderCircle,
  MapPin,
  MinusCircle,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { EvryBoundaryMessage } from "@/components/evry/boundary-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  EVRY_UNEXPECTED_ERROR_COPY,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "@/lib/evry/artifacts/review";
import type { EvryPublicArtifact } from "@/lib/evry/artifacts/public";
import { formatDateTimeWithZone, formatTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const EVRY_ARTIFACT_RENDER_VARIANTS = [
  "context",
  "clarification",
  "read",
  "settings",
  "confirmation",
  "progress",
  "receipt",
  "boundary",
] as const;

export type EvryArtifactRenderVariant =
  (typeof EVRY_ARTIFACT_RENDER_VARIANTS)[number];

type PublicArtifactOf<Kind extends EvryPublicArtifact["kind"]> = Extract<
  EvryPublicArtifact,
  { kind: Kind }
>;

type EvryContextRenderArtifact = Readonly<{
  sourceKind: string;
  recordId: string;
  label: string;
}>;

type ArtifactByVariant = {
  context: EvryContextRenderArtifact;
  clarification: PublicArtifactOf<"clarification">;
  read: PublicArtifactOf<"read">;
  settings: PublicArtifactOf<"settings_handoff">;
  confirmation: PublicArtifactOf<"confirmation">;
  progress: PublicArtifactOf<"progress">;
  receipt: PublicArtifactOf<"result">;
  boundary: PublicArtifactOf<"boundary">;
};

export type EvryRenderableArtifact = {
  [Variant in EvryArtifactRenderVariant]: Readonly<{
    variant: Variant;
    artifact: ArtifactByVariant[Variant];
  }>;
}[EvryArtifactRenderVariant];

export type EvryConfirmationControls = Readonly<{
  onCancel(): void;
  onEdit(): void;
  onExecute(): void;
}>;

export type EvryProgressControls = Readonly<{
  onSafeRetry(): void;
}>;

export type EvryArtifactRenderOptions = Readonly<{
  confirmationControls?: EvryConfirmationControls;
  progressControls?: EvryProgressControls;
  onChoice?: (choiceId: string) => void;
}>;

function ArtifactFrame({
  badge,
  title,
  icon,
  children,
  footer,
  className,
  busy,
  variant,
}: {
  badge: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  busy?: boolean;
  variant: EvryArtifactRenderVariant;
}) {
  const titleId = useId();
  return (
    <article
      data-artifact-variant={variant}
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <Card className={cn("gap-4 py-4 shadow-none", className)}>
        <CardHeader className="gap-2 px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="text-muted-foreground shrink-0">
              {icon}
            </span>
            <Badge variant="outline">{badge}</Badge>
          </div>
          <h3
            id={titleId}
            className="text-base leading-snug font-semibold text-pretty"
          >
            {title}
          </h3>
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-5">{children}</CardContent>
        {footer ? (
          <CardFooter className="flex flex-wrap justify-end gap-2 border-t px-4 pt-4 sm:px-5">
            {footer}
          </CardFooter>
        ) : null}
      </Card>
    </article>
  );
}

const linkClassName =
  "text-primary font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2";

function renderContext(artifact: EvryContextRenderArtifact) {
  return (
    <ArtifactFrame
      variant="context"
      badge="Context"
      title={artifact.label}
      icon={<MapPin className="size-4" />}
    >
      <p className="text-muted-foreground text-sm">
        This {artifact.sourceKind.replaceAll("_", " ")} was attached visibly
        when the message was sent.
      </p>
    </ArtifactFrame>
  );
}

function renderClarification(
  artifact: ArtifactByVariant["clarification"],
  options: EvryArtifactRenderOptions
) {
  return (
    <ArtifactFrame
      variant="clarification"
      badge={artifact.mode === "choice" ? "Choose one" : "Needs a detail"}
      title={artifact.prompt}
      icon={<CircleDashed className="size-4" />}
    >
      {artifact.mode === "missing" ? (
        <p className="text-muted-foreground text-sm">
          Add this detail in your next message. Nothing has been changed.
        </p>
      ) : (
        <ul className="space-y-2" aria-label={`${artifact.entityType} choices`}>
          {artifact.choices.map((choice) => (
            <li key={choice.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{choice.label}</p>
                  {choice.distinguishingFacts.map((fact) => (
                    <p
                      key={fact.label}
                      className="text-muted-foreground text-sm"
                    >
                      <span className="font-medium">{fact.label}:</span>{" "}
                      {fact.value}
                    </p>
                  ))}
                </div>
                {options.onChoice ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => options.onChoice?.(choice.id)}
                  >
                    Choose {choice.label}
                  </Button>
                ) : (
                  <Link href={choice.sourceLink.href} className={linkClassName}>
                    Open {choice.sourceLink.label}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ArtifactFrame>
  );
}

function renderRead(artifact: ArtifactByVariant["read"]) {
  return (
    <ArtifactFrame
      variant="read"
      badge="Read result"
      title={artifact.title}
      icon={<ListChecks className="size-4" />}
    >
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Matched", artifact.counts.matched],
          ["Shown", artifact.counts.returned],
          ["Excluded", artifact.counts.excluded],
        ].map(([label, value]) => (
          <div key={label} className="bg-muted/40 rounded-lg border px-2 py-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {artifact.filters.length ? (
        <div>
          <h4 className="text-sm font-medium">Applied filters</h4>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {artifact.filters.map((filter) => (
              <div key={filter.label} className="text-sm">
                <dt className="text-muted-foreground">{filter.label}</dt>
                <dd>{filter.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <ul className="space-y-2">
        {artifact.items.map((item) => (
          <li key={item.id} className="rounded-lg border p-3">
            <Link href={item.sourceLink.href} className={linkClassName}>
              {item.label}
            </Link>
            <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {item.facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-muted-foreground inline">
                    {fact.label}:{" "}
                  </dt>
                  <dd className="inline">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <div className="text-sm">
        <h4 className="font-medium">Exclusions</h4>
        {artifact.exclusions.length ? (
          <ul className="text-muted-foreground mt-1 list-disc pl-5">
            {artifact.exclusions.map((exclusion) => (
              <li key={exclusion.reason}>
                {exclusion.count} · {exclusion.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-1">None</p>
        )}
      </div>
    </ArtifactFrame>
  );
}

function dateTimeLabel(
  range: NonNullable<
    EvryDetailedConfirmationArtifactDocument["steps"][number]["dateTime"]
  >
): string {
  const { startsAt, endsAt } = range;
  const start = formatDateTimeWithZone(
    new Date(startsAt.instantUtc),
    startsAt.timeZone
  );
  const end = endsAt
    ? `–${formatTime(new Date(endsAt.instantUtc), endsAt.timeZone)}`
    : "";
  return `${start}${end} · ${startsAt.timeZone} (UTC${startsAt.utcOffset})`;
}

function DetailedConfirmation({
  artifact,
}: {
  artifact: EvryDetailedConfirmationArtifactDocument;
}) {
  return (
    <div className="space-y-5">
      <ol className="space-y-5">
        {artifact.steps.map((step, index) => (
          <li
            key={step.stepId}
            className="space-y-3 border-b pb-5 last:border-0 last:pb-0"
          >
            <div className="flex items-start gap-3">
              <span className="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h4 className="font-medium">{step.title}</h4>
                <p className="text-muted-foreground text-xs">
                  {step.effectKind.replaceAll("_", " ")} ·{" "}
                  {step.reversibility === "difficult_to_reverse"
                    ? "Difficult to reverse"
                    : step.reversibility === "irreversible"
                      ? "Irreversible"
                      : "Reversible"}
                </p>
              </div>
            </div>

            <section>
              <h5 className="text-sm font-medium">Resolved targets</h5>
              <ul className="mt-1 space-y-1 text-sm">
                {step.resolvedTargets.map((target, targetIndex) => (
                  <li key={`${target.label}-${targetIndex}`}>
                    <span className="text-muted-foreground">
                      {target.label}:{" "}
                    </span>
                    {target.sourceLink ? (
                      <Link
                        href={target.sourceLink.href}
                        className={linkClassName}
                      >
                        {target.value}
                      </Link>
                    ) : (
                      target.value
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {step.dateTime ? (
              <section className="bg-muted/40 rounded-lg border p-3">
                <h5 className="flex items-center gap-2 text-sm font-medium">
                  <Clock3 aria-hidden="true" className="size-4" />
                  Absolute date and time
                </h5>
                <p className="mt-1 text-sm">{dateTimeLabel(step.dateTime)}</p>
              </section>
            ) : null}

            <section>
              <h5 className="text-sm font-medium">Counts and exclusions</h5>
              <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                {step.counts.map((count) => (
                  <div
                    key={count.label}
                    className="flex justify-between gap-3 rounded-md border px-2.5 py-2"
                  >
                    <dt className="text-muted-foreground">{count.label}</dt>
                    <dd className="font-medium tabular-nums">{count.count}</dd>
                  </div>
                ))}
              </dl>
              {step.exclusions.length ? (
                <ul className="text-muted-foreground mt-2 list-disc pl-5 text-sm">
                  {step.exclusions.map((exclusion) => (
                    <li key={exclusion.reason}>
                      {exclusion.count} excluded · {exclusion.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground mt-2 text-sm">
                  Exclusions: none
                </p>
              )}
            </section>

            {step.beforeAfter.length ? (
              <section>
                <h5 className="text-sm font-medium">Before and after</h5>
                <ul className="mt-2 space-y-2">
                  {step.beforeAfter.map((change) => (
                    <li
                      key={change.label}
                      className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border p-3 text-sm"
                    >
                      <div>
                        <p className="text-muted-foreground text-xs">Before</p>
                        <p>{change.before}</p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="text-muted-foreground size-4"
                      />
                      <div>
                        <p className="text-muted-foreground text-xs">After</p>
                        <p>{change.after}</p>
                      </div>
                      <p className="text-muted-foreground col-span-3 text-xs">
                        {change.count} · {change.label}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {step.contentPreviews.length ? (
              <section>
                <h5 className="text-sm font-medium">Content preview</h5>
                <dl className="mt-2 space-y-2">
                  {step.contentPreviews.map((preview) => (
                    <div
                      key={preview.label}
                      className="bg-muted/40 rounded-lg border p-3 text-sm"
                    >
                      <dt className="text-muted-foreground text-xs font-medium">
                        {preview.label}
                      </dt>
                      <dd className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {preview.content}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </li>
        ))}
      </ol>

      <section className="border-destructive/40 bg-destructive/5 rounded-lg border p-3">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert aria-hidden="true" className="size-4" />
          Consequences
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {artifact.consequences.map((consequence) => (
            <li key={consequence}>{consequence}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function renderConfirmation(
  artifact: ArtifactByVariant["confirmation"],
  options: EvryArtifactRenderOptions
) {
  const controls = options.confirmationControls;
  return (
    <ArtifactFrame
      variant="confirmation"
      badge="Review before Evry acts"
      title={artifact.title}
      icon={<ShieldAlert className="size-4" />}
      className="border-foreground/30"
      footer={
        controls ? (
          <>
            <Button type="button" variant="ghost" onClick={controls.onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={controls.onEdit}>
              Edit plan
            </Button>
            <Button type="button" onClick={controls.onExecute}>
              {artifact.actionLabel}
            </Button>
          </>
        ) : null
      }
    >
      {"artifactVersion" in artifact ? (
        <DetailedConfirmation artifact={artifact} />
      ) : (
        <div className="space-y-4">
          <dl className="space-y-2 text-sm">
            {artifact.items.map((item) => (
              <div key={item.label}>
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {artifact.consequences.map((consequence) => (
              <li key={consequence}>{consequence}</li>
            ))}
          </ul>
        </div>
      )}
    </ArtifactFrame>
  );
}

type StepStatus =
  | EvryDetailedProgressArtifactDocument["steps"][number]["status"]
  | EvryDetailedReceiptArtifactDocument["steps"][number]["status"];

const STEP_STATUS = {
  pending: { label: "Pending", icon: CircleDashed, badge: "outline" },
  active: { label: "In progress", icon: LoaderCircle, badge: "secondary" },
  safe_retry: { label: "Safe retry", icon: RotateCcw, badge: "secondary" },
  completed: { label: "Completed", icon: CheckCircle2, badge: "outline" },
  refused: { label: "Refused", icon: ShieldX, badge: "destructive" },
  failed: { label: "Failed", icon: CircleX, badge: "destructive" },
  skipped: { label: "Skipped", icon: MinusCircle, badge: "outline" },
} as const satisfies Record<
  StepStatus,
  Readonly<{
    label: string;
    icon: typeof CheckCircle2;
    badge: "outline" | "secondary" | "destructive";
  }>
>;

function StepStatusBadge({ status }: { status: StepStatus }) {
  const presentation = STEP_STATUS[status];
  const Icon = presentation.icon;
  return (
    <Badge variant={presentation.badge}>
      <Icon
        aria-hidden="true"
        className={cn(status === "active" && "motion-safe:animate-spin")}
      />
      {presentation.label}
    </Badge>
  );
}

function renderProgress(
  artifact: ArtifactByVariant["progress"],
  options: EvryArtifactRenderOptions
) {
  const detailed = "artifactVersion" in artifact;
  const steps = detailed
    ? artifact.steps
    : [
        ...artifact.completedSteps.map((step) => ({
          ...step,
          status: "completed" as const,
          affectedCount: 0,
          excludedCount: 0,
        })),
        ...(artifact.activeStep
          ? [
              {
                ...artifact.activeStep,
                status: "active" as const,
                affectedCount: 0,
                excludedCount: 0,
              },
            ]
          : []),
      ];
  const completed = steps.filter(({ status }) => status === "completed").length;
  const canRetry =
    detailed && steps.some(({ status }) => status === "safe_retry");
  return (
    <ArtifactFrame
      variant="progress"
      badge="Execution progress"
      title={artifact.title}
      icon={
        canRetry ? (
          <RotateCcw className="size-4" />
        ) : (
          <LoaderCircle className="size-4 motion-safe:animate-spin" />
        )
      }
      busy={!canRetry}
      footer={
        canRetry && options.progressControls ? (
          <Button type="button" onClick={options.progressControls.onSafeRetry}>
            Retry exact plan safely
          </Button>
        ) : null
      }
    >
      <Progress
        value={completed}
        max={steps.length}
        aria-label={`${completed} of ${steps.length} steps completed`}
        className="[&_[data-slot=progress-indicator]]:motion-reduce:transition-none"
      />
      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.stepId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
          >
            <span className="font-medium">{step.label}</span>
            <StepStatusBadge status={step.status} />
          </li>
        ))}
      </ol>
      {detailed && artifact.error ? (
        <ReceiptError error={artifact.error} />
      ) : null}
      <p className="text-muted-foreground text-sm">
        {canRetry
          ? "Durable outcomes are preserved. Only the same exact plan can resume unfinished work."
          : "This plan is already running. A second execution is unavailable."}
      </p>
    </ArtifactFrame>
  );
}

function ReceiptError({
  error,
}: {
  error: NonNullable<
    EvryDetailedReceiptArtifactDocument["steps"][number]["error"]
  >;
}) {
  return (
    <div className="border-destructive/40 bg-destructive/5 mt-3 rounded-lg border p-3 text-sm">
      <p className="font-medium">
        {error.kind === "expected"
          ? "This step needs attention"
          : "Evry couldn't complete this step"}
      </p>
      <p className="mt-1">
        {error.kind === "expected" ? error.message : EVRY_UNEXPECTED_ERROR_COPY}
      </p>
      {error.kind === "unexpected" ? (
        <p className="text-muted-foreground mt-2 [overflow-wrap:anywhere]">
          Support reference:{" "}
          <span className="font-mono">{error.correlationId}</span>
        </p>
      ) : null}
    </div>
  );
}

function renderReceipt(artifact: ArtifactByVariant["receipt"]) {
  return (
    <ArtifactFrame
      variant="receipt"
      badge="Execution receipt"
      title={artifact.title}
      icon={<FileText className="size-4" />}
    >
      <ol className="space-y-3">
        {artifact.steps.map((step) => (
          <li key={step.stepId} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{step.label}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {step.affectedCount} affected · {step.excludedCount} excluded
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StepStatusBadge status={step.status} />
                {"retry" in step && step.retry.status === "safe_retry" ? (
                  <Badge variant="secondary">
                    <RotateCcw aria-hidden="true" />
                    Safe retry
                  </Badge>
                ) : null}
              </div>
            </div>

            {step.sourceLinks.length ? (
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {step.sourceLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClassName}>
                      Open {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            {"retry" in step && step.retry.status === "safe_retry" ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {step.retry.label}. This receipt cannot run it a second time.
              </p>
            ) : null}
            {"error" in step && step.error ? (
              <ReceiptError error={step.error} />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground text-sm">
        Completed and terminal steps are recorded. This receipt has no execute
        control.
      </p>
    </ArtifactFrame>
  );
}

function renderSettings(artifact: ArtifactByVariant["settings"]) {
  return (
    <div data-artifact-variant="settings">
      <span className="sr-only">
        <Settings2 aria-hidden="true" /> Settings handoff
      </span>
      <EvryBoundaryMessage artifact={artifact} />
    </div>
  );
}

function renderBoundary(artifact: ArtifactByVariant["boundary"]) {
  return (
    <div data-artifact-variant="boundary">
      <span className="sr-only">
        <AlertCircle aria-hidden="true" /> Application boundary
      </span>
      <EvryBoundaryMessage artifact={artifact} />
    </div>
  );
}

type EvryArtifactRegistry = {
  [Variant in EvryArtifactRenderVariant]: (
    artifact: ArtifactByVariant[Variant],
    options: EvryArtifactRenderOptions
  ) => ReactNode;
};

/** One explicit entry per reviewable artifact kind; additions fail the type. */
export const EVRY_ARTIFACT_REGISTRY = {
  context: (artifact, _options) => renderContext(artifact),
  clarification: (artifact, options) => renderClarification(artifact, options),
  read: (artifact, _options) => renderRead(artifact),
  settings: (artifact, _options) => renderSettings(artifact),
  confirmation: (artifact, options) => renderConfirmation(artifact, options),
  progress: (artifact, options) => renderProgress(artifact, options),
  receipt: (artifact, _options) => renderReceipt(artifact),
  boundary: (artifact, _options) => renderBoundary(artifact),
} satisfies EvryArtifactRegistry;

export function renderableEvryArtifact(
  artifact: EvryPublicArtifact
): Exclude<EvryRenderableArtifact, { variant: "context" }> {
  switch (artifact.kind) {
    case "clarification":
      return { variant: "clarification", artifact };
    case "read":
      return { variant: "read", artifact };
    case "settings_handoff":
      return { variant: "settings", artifact };
    case "confirmation":
      return { variant: "confirmation", artifact };
    case "progress":
      return { variant: "progress", artifact };
    case "result":
      return { variant: "receipt", artifact };
    case "boundary":
      return { variant: "boundary", artifact };
    default: {
      const exhaustive: never = artifact;
      return exhaustive;
    }
  }
}

export function EvryArtifactRenderer({
  model,
  options = {},
}: {
  model: EvryRenderableArtifact;
  options?: EvryArtifactRenderOptions;
}) {
  switch (model.variant) {
    case "context":
      return EVRY_ARTIFACT_REGISTRY.context(model.artifact, options);
    case "clarification":
      return EVRY_ARTIFACT_REGISTRY.clarification(model.artifact, options);
    case "read":
      return EVRY_ARTIFACT_REGISTRY.read(model.artifact, options);
    case "settings":
      return EVRY_ARTIFACT_REGISTRY.settings(model.artifact, options);
    case "confirmation":
      return EVRY_ARTIFACT_REGISTRY.confirmation(model.artifact, options);
    case "progress":
      return EVRY_ARTIFACT_REGISTRY.progress(model.artifact, options);
    case "receipt":
      return EVRY_ARTIFACT_REGISTRY.receipt(model.artifact, options);
    case "boundary":
      return EVRY_ARTIFACT_REGISTRY.boundary(model.artifact, options);
    default: {
      const exhaustive: never = model;
      return exhaustive;
    }
  }
}
