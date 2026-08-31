"use client";

import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  CircleX,
  Clock3,
  FileText,
  ListChecks,
  LoaderCircle,
  Mail,
  MapPin,
  MinusCircle,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldX,
  UsersRound,
} from "lucide-react";
import { useId, type ReactNode } from "react";

import { EvryBoundaryMessage } from "@/components/evry/boundary-message";
import { RichText } from "@/components/shared/rich-text";
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
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeZoneName,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { AuthenticatedLink } from "@/components/authenticated-navigation";

import {
  customerContentPreviews,
  customerReviewTargets,
  readResultLabel,
} from "./artifact-presentation";

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

export type EvryReceiptControls = Readonly<{
  disabled: boolean;
  label: string;
  onReuse(): void;
}>;

export type EvryArtifactRenderOptions = Readonly<{
  confirmationControls?: EvryConfirmationControls;
  progressControls?: EvryProgressControls;
  receiptControls?: EvryReceiptControls;
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
          <CardFooter
            className={cn(
              "flex flex-col gap-2 border-t px-4 pt-4 sm:flex-row sm:flex-wrap sm:justify-end sm:px-5",
              variant === "confirmation" &&
                "bg-card/95 sticky bottom-0 z-10 supports-[backdrop-filter]:backdrop-blur"
            )}
          >
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
                  <AuthenticatedLink
                    href={choice.sourceLink.href}
                    className={linkClassName}
                  >
                    Open {choice.sourceLink.label}
                  </AuthenticatedLink>
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
      <p className="text-2xl font-semibold tabular-nums">
        {readResultLabel(artifact.counts.returned)}
      </p>

      {artifact.items.length ? (
        <ul className="space-y-2">
          {artifact.items.map((item) => (
            <li key={item.id} className="rounded-lg border p-3">
              <AuthenticatedLink
                href={item.sourceLink.href}
                className={linkClassName}
              >
                {item.label}
              </AuthenticatedLink>
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
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing needs your attention right now.
        </p>
      )}

      {artifact.exclusions.length ? (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">
            {artifact.counts.excluded.toLocaleString()} additional result
            {artifact.counts.excluded === 1 ? "" : "s"} not shown
          </summary>
          <ul className="text-muted-foreground mt-1 list-disc pl-5">
            {artifact.exclusions.map((exclusion) => (
              <li key={exclusion.reason}>
                {exclusion.count} · {exclusion.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </ArtifactFrame>
  );
}

function dateTimeLabel(
  range: NonNullable<
    EvryDetailedConfirmationArtifactDocument["steps"][number]["dateTime"]
  >
): string {
  const { startsAt, endsAt } = range;
  const startInstant = new Date(startsAt.instantUtc);
  const start = formatDateTime(startInstant, "long", startsAt.timeZone);
  const zone = formatTimeZoneName(startInstant, startsAt.timeZone);
  if (!endsAt) return `${start} ${zone}`;

  const endInstant = new Date(endsAt.instantUtc);
  const end =
    formatDate(startInstant, "long", startsAt.timeZone) ===
    formatDate(endInstant, "long", endsAt.timeZone)
      ? formatTime(endInstant, endsAt.timeZone)
      : formatDateTime(endInstant, "long", endsAt.timeZone);
  return `${start}–${end} ${zone}`;
}

function confirmationStepTitle(
  step: EvryDetailedConfirmationArtifactDocument["steps"][number]
): string {
  if (step.stepId === "create-meeting") return "Meeting";
  if (step.stepId === "add-guests") return "Guests";
  if (step.stepId === "send-invitations") return "Invitation email";
  return step.title;
}

function confirmationStepLead(
  step: EvryDetailedConfirmationArtifactDocument["steps"][number]
): string | null {
  if (step.stepId === "create-meeting") {
    return "Evry will create this meeting after you confirm.";
  }
  if (step.stepId === "add-guests") {
    const count = step.counts.find(({ label }) =>
      /guests (?:added|to add)/i.test(label)
    );
    if (!count) return null;
    return `Evry will add ${count.count.toLocaleString()} ${count.count === 1 ? "person" : "people"} to the guest list.`;
  }
  if (step.effectKind === "communication") {
    const count = step.counts.find(({ label }) =>
      /emails|recipients/i.test(label)
    );
    if (!count) return null;
    return `Evry will use this template for ${count.count.toLocaleString()} ${count.count === 1 ? "person" : "people"}.`;
  }
  return null;
}

function confirmationStepIcon(
  step: EvryDetailedConfirmationArtifactDocument["steps"][number]
) {
  if (step.effectKind === "meeting") return CalendarDays;
  if (step.stepId === "add-guests") return UsersRound;
  if (step.effectKind === "communication") return Mail;
  return ListChecks;
}

function customerCountLabel(label: string): string {
  return label
    .replace(
      /\s+(?:created|added|sent|scheduled|changed|deleted|imported|parsed)$/i,
      ""
    )
    .trim();
}

function DetailedConfirmation({
  artifact,
}: {
  artifact: EvryDetailedConfirmationArtifactDocument;
}) {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground max-w-prose text-sm leading-relaxed text-pretty">
        Nothing has changed yet. Review the details, then confirm or edit the
        plan.
      </p>

      <ol className="space-y-4">
        {artifact.steps.map((step) => {
          const targets = customerReviewTargets(
            step.resolvedTargets,
            step.effectKind
          );
          const previews = customerContentPreviews(step.contentPreviews);
          const title = confirmationStepTitle(step);
          const lead = confirmationStepLead(step);
          const StepIcon = confirmationStepIcon(step);
          const showChanges =
            step.effectKind === "bulk_change" ||
            step.effectKind === "destructive" ||
            step.effectKind === "file_import";
          const excludedCount = step.exclusions.reduce(
            (sum, exclusion) => sum + exclusion.count,
            0
          );
          return (
            <li
              key={step.stepId}
              className="bg-muted/35 space-y-4 rounded-xl p-4"
            >
              <div className="flex items-start gap-3">
                <span className="bg-background text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg border">
                  <StepIcon aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h4 className="font-semibold text-balance">{title}</h4>
                  {lead ? (
                    <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
                      {lead}
                    </p>
                  ) : null}
                </div>
              </div>

              {targets.length ? (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {targets.map((target, targetIndex) => (
                    <div key={`${target.label}-${targetIndex}`}>
                      <dt className="text-muted-foreground text-xs font-medium">
                        {target.label}
                      </dt>
                      <dd className="mt-0.5 leading-relaxed [overflow-wrap:anywhere]">
                        {target.sourceLink ? (
                          <AuthenticatedLink
                            href={target.sourceLink.href}
                            className={linkClassName}
                          >
                            {target.value}
                          </AuthenticatedLink>
                        ) : (
                          target.value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {step.dateTime ? (
                <section className="bg-background/80 rounded-lg p-3">
                  <h5 className="flex items-center gap-2 text-sm font-medium">
                    <Clock3 aria-hidden="true" className="size-4" />
                    Date and time
                  </h5>
                  <p className="mt-1 text-sm leading-relaxed text-pretty">
                    {dateTimeLabel(step.dateTime)}
                  </p>
                </section>
              ) : null}

              {!lead ? (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {step.counts.map((count) => (
                    <div
                      key={count.label}
                      className="bg-background/80 flex justify-between gap-3 rounded-lg px-3 py-2.5"
                    >
                      <dt className="text-muted-foreground">
                        {customerCountLabel(count.label)}
                      </dt>
                      <dd className="font-medium tabular-nums">
                        {count.count}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {step.exclusions.length ? (
                <details className="text-muted-foreground text-sm">
                  <summary className="min-h-6 cursor-pointer font-medium">
                    {excludedCount.toLocaleString()} not included
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 ps-5">
                    {step.exclusions.map((exclusion) => (
                      <li key={exclusion.reason}>
                        {exclusion.count.toLocaleString()} {exclusion.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {showChanges && step.beforeAfter.length ? (
                <section>
                  <h5 className="text-sm font-medium">
                    Changes after confirmation
                  </h5>
                  <ul className="mt-2 space-y-2">
                    {step.beforeAfter.map((change) => (
                      <li
                        key={change.label}
                        className="bg-background/80 grid gap-3 rounded-lg p-3 text-sm sm:grid-cols-2"
                      >
                        <div>
                          <p className="text-muted-foreground text-xs">
                            Current
                          </p>
                          <p>{change.before}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">
                            After confirmation
                          </p>
                          <p>{change.after}</p>
                        </div>
                        <p className="text-muted-foreground text-xs sm:col-span-2">
                          {change.count.toLocaleString()} {change.label}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {previews.length ? (
                <section>
                  {step.effectKind === "communication" ? null : (
                    <h5 className="text-sm font-medium">Preview</h5>
                  )}
                  <dl
                    className={cn(
                      "space-y-2",
                      step.effectKind === "communication" ? "" : "mt-2"
                    )}
                  >
                    {previews.map((preview) => (
                      <div
                        key={`${preview.label}:${preview.content}`}
                        className="bg-background/80 rounded-lg p-3 text-sm"
                      >
                        <dt className="text-muted-foreground text-xs font-medium">
                          {preview.label}
                        </dt>
                        <dd className="mt-1 [overflow-wrap:anywhere]">
                          {preview.format === "rich_text" ? (
                            <RichText body={preview.content} />
                          ) : (
                            <span className="whitespace-pre-wrap">
                              {preview.content}
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              {step.effectKind === "communication" ? (
                <p className="text-destructive flex gap-2 text-sm leading-relaxed">
                  <AlertCircle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  Emails send immediately after you confirm and cannot be
                  recalled.
                </p>
              ) : step.reversibility !== "reversible" ? (
                <p className="text-destructive flex gap-2 text-sm leading-relaxed">
                  <AlertCircle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  {step.reversibility === "irreversible"
                    ? "This change cannot be undone after you confirm."
                    : "This change may be difficult to undo after you confirm."}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
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
            <Button
              type="button"
              variant="ghost"
              onClick={controls.onCancel}
              className="min-h-10 w-full active:scale-[0.96] sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={controls.onEdit}
              className="min-h-10 w-full active:scale-[0.96] sm:w-auto"
            >
              Edit plan
            </Button>
            <Button
              type="button"
              onClick={controls.onExecute}
              className="min-h-10 w-full active:scale-[0.96] sm:w-auto"
            >
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

function renderReceipt(
  artifact: ArtifactByVariant["receipt"],
  options: EvryArtifactRenderOptions
) {
  return (
    <ArtifactFrame
      variant="receipt"
      badge="Execution receipt"
      title={artifact.title}
      icon={<FileText className="size-4" />}
      footer={
        options.receiptControls ? (
          <Button
            type="button"
            variant="outline"
            disabled={options.receiptControls.disabled}
            onClick={options.receiptControls.onReuse}
            className="cursor-pointer active:scale-[0.96]"
          >
            <RotateCcw aria-hidden="true" />
            {options.receiptControls.label}
          </Button>
        ) : null
      }
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
                    <AuthenticatedLink
                      href={link.href}
                      className={linkClassName}
                    >
                      Open {link.label}
                    </AuthenticatedLink>
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
  receipt: (artifact, options) => renderReceipt(artifact, options),
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
