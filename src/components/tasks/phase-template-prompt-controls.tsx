"use client";

import Link from "next/link";
import {
  useActionState,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { TEMPLATES_LINK_LABEL, TEMPLATES_ROUTE } from "@/lib/tasks/templates";

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
 * What answering the prompt with Import did.
 *
 * `partial` is the case the review singled out: the claim is deliberately KEPT
 * when an import got part-way (re-offering a checklist already in the list is
 * how a planter imports it twice), so the prompt is answered and will not
 * render again — this outcome is the only chance to say that half a set
 * arrived. `nothing` is "no checklist on offer was ticked", which the disabled
 * button makes unreachable from the UI but not from a forged POST or a stage
 * change that moved under the planter's feet.
 */
export type PhaseTemplateImportOutcome =
  | { status: "idle" }
  | { status: "partial"; createdCount: number; templateNames: string[] }
  | { status: "nothing" }
  | { status: "failed" };

export const PHASE_TEMPLATE_IMPORT_IDLE: PhaseTemplateImportOutcome = {
  status: "idle",
};

export type PhaseTemplateDismissOutcome =
  | { status: "idle" }
  | { status: "failed" };

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

function taskCountLabel(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}

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
    state: PhaseTemplateDismissOutcome
  ) => Promise<PhaseTemplateDismissOutcome>;
  /**
   * Test seam. `useActionState` has no way to be driven from
   * `renderToStaticMarkup`, so the outcome markup — the partial receipt, the
   * two alerts — is asserted by starting the hook at that outcome. Production
   * never passes these.
   */
  initialImportOutcome?: PhaseTemplateImportOutcome;
  initialDismissOutcome?: PhaseTemplateDismissOutcome;
}

export function PhaseTemplatePromptForm({
  offerCount,
  lead,
  children,
  importAction,
  dismissAction,
  initialImportOutcome = PHASE_TEMPLATE_IMPORT_IDLE,
  initialDismissOutcome = PHASE_TEMPLATE_DISMISS_IDLE,
}: PhaseTemplatePromptFormProps) {
  const [importOutcome, importFormAction, importPending] = useActionState(
    importAction,
    initialImportOutcome
  );
  const [dismissOutcome, dismissFormAction, dismissPending] = useActionState(
    dismissAction,
    initialDismissOutcome
  );
  const [tickedCount, setTickedCount] = useState(offerCount);
  const hintId = useId();

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
      <p
        data-testid="prompt-partial"
        role="alert"
        className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
      >
        {partialImportMessage(
          importOutcome.createdCount,
          importOutcome.templateNames
        )}{" "}
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

  return (
    <>
      {lead}

      <form
        action={importFormAction}
        onChange={countTicks}
        className="space-y-4"
      >
        {children}

        {/*
          Failures the planter can act on, said where the press happened —
          `role="alert"` and the catalog's own treatment
          (`template-picker.tsx`). Nothing here ends up in the console alone.
        */}
        {importOutcome.status === "failed" && (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md p-2 text-sm"
          >
            {IMPORT_FAILED_MESSAGE}
          </p>
        )}
        {importOutcome.status === "nothing" && (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md p-2 text-sm"
          >
            {NOTHING_IMPORTED_MESSAGE}
          </p>
        )}
        {dismissOutcome.status === "failed" && (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md p-2 text-sm"
          >
            {DISMISS_FAILED_MESSAGE}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            className="cursor-pointer"
            disabled={importDisabled}
            aria-busy={importing}
            aria-describedby={emptyHint ? hintId : undefined}
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
          >
            Not now
          </Button>
        </div>

        {/*
          Announced, not just shown: a disabled button is not focusable, so the
          `aria-describedby` above is never read out on its own. `role="status"`
          is what tells a screen-reader user why Import stopped accepting the
          press.
        */}
        {emptyHint && (
          <p
            id={hintId}
            role="status"
            data-testid="prompt-empty-hint"
            className="text-muted-foreground text-xs"
          >
            {emptyHint}
          </p>
        )}
      </form>
    </>
  );
}
