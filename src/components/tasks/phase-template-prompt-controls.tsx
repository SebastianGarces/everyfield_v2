"use client";

import Link from "next/link";
import {
  useActionState,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import type {
  PhaseTemplateDismissOutcome,
  PhaseTemplateImportOutcome,
} from "@/lib/tasks/phase-prompt";
import {
  TEMPLATES_LINK_LABEL,
  TEMPLATES_ROUTE,
  taskCountLabel,
} from "@/lib/tasks/templates";

// ============================================================================
// T-020 — the prompt's form, its two buttons, and the only client code the
// prompt has.
//
// WHY THIS IS A SEPARATE FILE. `phase-template-prompt.tsx` is a server
// component: it reads the session, queries the transition and DEFINES the two
// server actions. `useActionState` is a client hook, and a module is either
// `"use client"` or it is not — so the form moves out and everything else stays
// where the auth surface can be reasoned about. The checklist rows and the fine
// print are handed in as `children`, so they are still SERVER-rendered markup;
// nothing but two server-action references crosses the boundary.
//
// WHY THE FORM LIVES HERE AND NOT IN THE SERVER COMPONENT (ruled 2026-08-12,
// round 3 on PR #393). Both actions used to return `void` and swallow every
// failure into `console.error`. A press that creates 22–26 tasks is the last
// place a planter should have to guess, so each action now RETURNS an outcome
// and `useActionState` renders it. `useActionState` puts its action on the
// `<form>`, which is why the form element is in this island.
//
// WHY THE IMPORT BUTTON DISABLES WHEN NOTHING IS TICKED (ruled 2026-08-12,
// round 3). Unticking every box and pressing Import used to be a completely
// silent no-op: no answer, no tasks, no message, and every box ticked again on
// the next render. That also made the round-2 copy false — the unticked
// checklists WERE offered again, immediately. Making the empty submit
// impossible is what makes the sentence true. "Not now" stays live, because
// dismissing everything is exactly what an empty selection means, and a screen
// with no enabled control is a trap.
//
// ONE LIVE REGION FOR THE FAILURES, AND ONE FOR THE REFUSAL. Each failure used
// to render its own `role="alert"`, independently — so a failed import followed
// by a failed dismiss announced twice, the older of the two describing a press
// the planter had already moved past. Both hooks keep their last result forever
// and neither knows which ran more recently, so the buttons record `lastPress`
// and `phaseTemplatePromptAlert` derives the single sentence from it. The
// separate `role="status"` hint is mounted from the first paint with its text
// toggled: a polite region inserted together with its first message is commonly
// not announced at all.
//
// TICK COUNTING IS A DOM READ, NOT A MIRROR OF THE CHECKBOXES. The boxes stay
// uncontrolled server markup; `change` bubbles to the form, and the handler
// counts what is checked right then. Holding a copy of the tick state in React
// would be a second source of truth for something the DOM already knows
// (`memory/contracts/data-patterns.md` — this is UI state, and the least of
// it).
// ============================================================================

// ----------------------------------------------------------------------------
// Outcomes — what the two actions report back
// ----------------------------------------------------------------------------

/**
 * The outcome shapes are DEFINED IN `@/lib/tasks/phase-prompt`, next to the pure
 * function that decides them, and re-exported here for the components and tests
 * that only ever draw them. `import type` is erased, so this island still pulls
 * nothing server-side into the browser bundle.
 */
export type { PhaseTemplateDismissOutcome, PhaseTemplateImportOutcome };

export const PHASE_TEMPLATE_IMPORT_IDLE: PhaseTemplateImportOutcome = {
  status: "idle",
};

export const PHASE_TEMPLATE_DISMISS_IDLE: PhaseTemplateDismissOutcome = {
  status: "idle",
};

// ----------------------------------------------------------------------------
// Copy
// ----------------------------------------------------------------------------

/** The request itself failed and nothing was created — the catalog's wording
 *  (`template-picker.tsx` → `IMPORT_FAILED_MESSAGE`), in the plural, because
 *  this surface imports several checklists at once. */
export const IMPORT_FAILED_MESSAGE =
  "We could not import those checklists just now. Nothing was created — try again.";

/** Declining failed. It creates nothing either way, so the only thing owed is
 *  "that press did not land". */
export const DISMISS_FAILED_MESSAGE =
  "We could not dismiss this just now. Nothing was changed — try again.";

/** A submit that named no checklist still on offer. Unreachable from the
 *  buttons; reachable from a forged POST, or from a plant that moved stage
 *  between the render and the press. */
export const NOTHING_IMPORTED_MESSAGE =
  "Nothing was imported — no checklist on offer was ticked. Tick one, or press Not now to dismiss this stage's checklists.";

/** Why Import refuses. A disabled button with no reason beside it is the same
 *  dead end the silent no-op was, so the sentence renders whenever the button
 *  is refusing, and names the control that IS live. */
export const NOTHING_TICKED_HINT =
  "Tick at least one checklist to import. Press Not now to dismiss them all.";

/** `"A"`, `"A and B"`, `"A, B and C"` — names read as a sentence, not a list. */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The partial-import receipt, ending mid-sentence so the catalog link finishes
 * it (the same shape as the prompt's untick note).
 *
 * It says three things in order, because the planter needs all three: what DID
 * land, that the rest did not, and that the stage change is now spent — so the
 * remainder has exactly one route left.
 */
export function partialImportMessage(
  createdCount: number,
  templateNames: readonly string[]
): string {
  const created = taskCountLabel(createdCount);
  const from =
    templateNames.length > 0 ? ` from ${nameList(templateNames)}` : "";

  return `Only part of that import went through: ${created} created${from}. The remaining checklists were not created, and this stage change is now answered — import them at any time from`;
}

// ----------------------------------------------------------------------------
// The one live region
// ----------------------------------------------------------------------------

/**
 * Which button was pressed last. UI state, and the only thing that can tell two
 * independent `useActionState` hooks apart in time.
 */
export type PhaseTemplatePromptPress = "import" | "dismiss";

export interface PhaseTemplatePromptAlertInput {
  lastPress: PhaseTemplatePromptPress;
  importOutcome: PhaseTemplateImportOutcome;
  dismissOutcome: PhaseTemplateDismissOutcome;
}

/**
 * The ONE sentence the prompt announces, or `null` for silence.
 *
 * There used to be three `role="alert"` paragraphs, one per failure, each
 * rendered independently. A failed import followed by a failed dismiss put TWO
 * live regions on the page at once — two announcements for one press, and the
 * older of them describing a press the planter had already moved on from. A
 * live region is a channel, not a list, so there is one, and it carries the
 * outcome of the press that was actually made.
 *
 * `lastPress` is what makes that possible. Each hook keeps its own last result
 * forever, so "import failed" survives every later dismiss and vice versa;
 * neither hook knows which ran more recently. The buttons record it.
 */
export function phaseTemplatePromptAlert(
  input: PhaseTemplatePromptAlertInput
): string | null {
  if (input.lastPress === "dismiss") {
    return input.dismissOutcome.status === "failed"
      ? DISMISS_FAILED_MESSAGE
      : null;
  }

  if (input.importOutcome.status === "failed") return IMPORT_FAILED_MESSAGE;
  if (input.importOutcome.status === "nothing") return NOTHING_IMPORTED_MESSAGE;

  return null;
}

// ----------------------------------------------------------------------------
// The two outcome surfaces
//
// WHY THEY ARE THEIR OWN COMPONENTS. Both are pure functions of their data and
// hold no hooks, and while they were inline in `PhaseTemplatePromptForm` the
// only way a test could reach either was to seed `useActionState` — which
// `renderToStaticMarkup` cannot drive, so the form grew three `initial*` props
// whose comment said "Production never passes these." Test scaffolding in a
// production component's public shape is a cost paid on every read of that
// shape; extracted, the markup is renderable directly and the seams delete
// themselves. What the FORM still owns is the CHOICE between them, and that
// half was already pure and separately tested (`phaseTemplatePromptAlert`).
// ----------------------------------------------------------------------------

/**
 * The partial-import receipt: what landed, what did not, and the one route the
 * remainder is still on.
 *
 * It REPLACES the panel body rather than sitting under it. A part-way import
 * keeps its claim (`phase-prompt.ts`), so the transition is answered and the
 * prompt never renders again — the offers above it are offers that can no
 * longer be taken, and this is the only screen that will ever say so.
 */
export function PartialImportReceipt({
  createdCount,
  templateNames,
}: {
  createdCount: number;
  templateNames: readonly string[];
}) {
  return (
    <p
      data-testid="prompt-partial"
      role="alert"
      className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
    >
      {partialImportMessage(createdCount, templateNames)}{" "}
      <Link
        href={TEMPLATES_ROUTE}
        className="cursor-pointer font-medium underline underline-offset-4"
      >
        {TEMPLATES_LINK_LABEL}
      </Link>
      .
    </p>
  );
}

/**
 * The prompt's ONE live region — `role="alert"`, the catalog's own treatment.
 *
 * It takes a message rather than the two outcomes on purpose: WHICH sentence is
 * `phaseTemplatePromptAlert`'s decision, and rendering it is this component's.
 * Keeping them apart is what stops a second live region being added beside this
 * one the next time a failure gets its own branch.
 */
export function PhaseTemplatePromptAlert({ message }: { message: string }) {
  return (
    <p
      role="alert"
      data-testid="prompt-alert"
      className="bg-destructive/10 text-destructive rounded-md p-2 text-sm"
    >
      {message}
    </p>
  );
}

// ----------------------------------------------------------------------------
// The button state
// ----------------------------------------------------------------------------

export interface PhaseTemplatePromptControlInput {
  importPending: boolean;
  dismissPending: boolean;
  /** How many checklists are ticked right now. Zero refuses the import. */
  tickedCount: number;
}

export interface PhaseTemplatePromptControlState {
  importDisabled: boolean;
  /** Declining is never refused for an empty selection — it IS the empty
   *  selection's answer. It only goes inert while a request is in flight. */
  dismissDisabled: boolean;
  importing: boolean;
  dismissing: boolean;
  importLabel: string;
  /** The sentence shown beside a refusing Import button, or `null`. */
  emptyHint: string | null;
}

/**
 * What the two buttons say and whether they accept a press.
 *
 * Pulled out of the component because neither pending flag can be driven from a
 * test — `useActionState` reports `pending: false` under `renderToStaticMarkup`
 * no matter what — and "the submit button is disabled while the request runs"
 * and "Import refuses an empty selection" are both acceptance criteria. As a
 * pure function of (in flight?, which action?, how many ticks?) it is assertable
 * at every combination, and the browser gate proves the wiring.
 *
 * Both buttons go inert together while ANY request is in flight: one form, one
 * answer.
 */
export function phaseTemplatePromptControlState(
  input: PhaseTemplatePromptControlInput
): PhaseTemplatePromptControlState {
  const busy = input.importPending || input.dismissPending;
  const empty = input.tickedCount === 0;

  return {
    importDisabled: busy || empty,
    dismissDisabled: busy,
    importing: input.importPending,
    dismissing: input.dismissPending,
    importLabel: input.importPending ? "Importing…" : "Import checklists",
    emptyHint: empty && !busy ? NOTHING_TICKED_HINT : null,
  };
}

// ----------------------------------------------------------------------------
// The island
// ----------------------------------------------------------------------------

export interface PhaseTemplatePromptFormProps {
  /**
   * The transition this prompt is asking about, posted back with the answer.
   *
   * "Not now" reads it (see the hidden input below) so a press on a STALE panel
   * cannot decline a stage change the planter never saw. It is not an aiming
   * device: the server refuses any id that is not its own latest transition, so
   * the only outcome a forged value can force is a no-op.
   */
  transitionId: string;
  /** How many boxes arrive ticked — every offer does, so this is the resting
   *  tick count and the value the server and the client both start from. */
  offerCount: number;
  /** The prompt's lead paragraphs, server-rendered and handed in, so a partial
   *  import can replace the whole panel body with its receipt. */
  lead: ReactNode;
  /** The checklist rows and the fine print — server markup, never client. */
  children: ReactNode;
  importAction: (
    state: PhaseTemplateImportOutcome,
    formData: FormData
  ) => Promise<PhaseTemplateImportOutcome>;
  dismissAction: (
    state: PhaseTemplateDismissOutcome,
    formData: FormData
  ) => Promise<PhaseTemplateDismissOutcome>;
}

export function PhaseTemplatePromptForm({
  transitionId,
  offerCount,
  lead,
  children,
  importAction,
  dismissAction,
}: PhaseTemplatePromptFormProps) {
  const [importOutcome, importFormAction, importPending] = useActionState(
    importAction,
    PHASE_TEMPLATE_IMPORT_IDLE
  );
  const [dismissOutcome, dismissFormAction, dismissPending] = useActionState(
    dismissAction,
    PHASE_TEMPLATE_DISMISS_IDLE
  );
  const [tickedCount, setTickedCount] = useState(offerCount);
  const [lastPress, setLastPress] =
    useState<PhaseTemplatePromptPress>("import");

  const {
    importDisabled,
    dismissDisabled,
    importing,
    dismissing,
    importLabel,
    emptyHint,
  } = phaseTemplatePromptControlState({
    importPending,
    dismissPending,
    tickedCount,
  });

  const alertMessage = phaseTemplatePromptAlert({
    lastPress,
    importOutcome,
    dismissOutcome,
  });

  /** `change` bubbles from the checkboxes to the form, so one handler on the
   *  form counts them all — and no row has to become a client component. */
  function countTicks(event: FormEvent<HTMLFormElement>) {
    setTickedCount(
      event.currentTarget.querySelectorAll('input[name="templateKey"]:checked')
        .length
    );
  }

  // A partial import KEEPS the claim, so the next render of this route has no
  // prompt at all — the panel body becomes the receipt, because there is no
  // later screen that will say this.
  if (importOutcome.status === "partial") {
    return (
      <PartialImportReceipt
        createdCount={importOutcome.createdCount}
        templateNames={importOutcome.templateNames}
      />
    );
  }

  return (
    <>
      {lead}

      <form
        action={importFormAction}
        onChange={countTicks}
        className="space-y-4"
      >
        {/*
          WHICH stage change this panel is answering. "Not now" still reads
          nothing ELSE from the form — the church comes from the session and the
          transition is re-read from the database — but the id the planter was
          LOOKING AT has to travel with the press, or a panel left open while
          the plant moved on declines the new stage change instead. The server
          compares it with its own latest transition and refuses a mismatch, so
          this input cannot aim the dismissal anywhere; the worst a forged value
          buys is a press that does nothing and says so.
        */}
        <input type="hidden" name="transitionId" value={transitionId} />

        {children}

        {/*
          ONE live region, whichever press failed. Nothing here ends up in the
          console alone, and nothing here ever announces twice: the sentence is
          chosen by `phaseTemplatePromptAlert` and drawn by one component.
        */}
        {alertMessage && <PhaseTemplatePromptAlert message={alertMessage} />}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            className="cursor-pointer"
            disabled={importDisabled}
            aria-busy={importing}
            onClick={() => setLastPress("import")}
          >
            {importLabel}
          </Button>
          {/*
            A second action on the same form rather than a nested one — a form
            may not contain a form, and the two answers belong to one control
            group. `formAction` is how React routes a submit to the other
            action, `useActionState`'s wrapper included.
          */}
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            formAction={dismissFormAction}
            className="cursor-pointer"
            disabled={dismissDisabled}
            aria-busy={dismissing}
            onClick={() => setLastPress("dismiss")}
          >
            Not now
          </Button>
        </div>

        {/*
          ALWAYS RENDERED, TEXT TOGGLED. `role="status"` is a polite live region,
          and a polite region that is inserted into the DOM together with its
          first message is commonly not announced at all — the assistive tech has
          nothing to compare against. Mounted empty from the first paint, the
          hint appearing IS a change, which is the event that gets read.

          There is no `aria-describedby` pointing here, and there was: it was
          dead. It sat on the Import button, which is DISABLED for exactly as
          long as this hint has anything to say, and a disabled button is not
          focusable — so the description could never be reached. This region is
          how a screen-reader user learns why Import stopped accepting the press.
        */}
        <p
          role="status"
          data-testid="prompt-empty-hint"
          className="text-muted-foreground text-xs"
        >
          {emptyHint ?? ""}
        </p>
      </form>
    </>
  );
}
