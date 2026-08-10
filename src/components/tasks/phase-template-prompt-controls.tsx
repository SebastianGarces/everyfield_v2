"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

// ============================================================================
// T-020 — the prompt's two buttons, and the only client code the prompt has.
//
// WHY THIS IS A SEPARATE FILE. `phase-template-prompt.tsx` is a server
// component: it reads the session, queries the transition and DEFINES the two
// server actions. `useFormStatus` is a client hook, and a module is either
// `"use client"` or it is not — so the buttons move out and everything else
// stays where the auth surface can be reasoned about. Nothing but the dismiss
// action crosses the boundary, and a server action reference is exactly what is
// allowed to.
//
// WHY THE GUARD EXISTS AT ALL (ruled 2026-08-10, PR #393). Accepting imports
// 22–26 tasks. Before this, two fast presses sent two submissions, and the
// second was already in flight before the first had written anything. The
// database now refuses the second answer outright — `acceptPhaseTemplatePrompt`
// claims a row keyed by transition id — so this guard is not what makes the
// repeat harmless; it is what stops the planter watching a second request they
// have no reason to believe is a no-op. Belt over the braces, in that order.
//
// WHY "WHICH BUTTON" IS LOCAL STATE AND NOT THE SUBMITTER'S NAME. A submit
// button's `name`/`value` normally rides along in the FormData, which would
// answer this for free — but React uses those two attributes itself to encode
// which server function a `formAction` button invokes, and warns that it will
// override them. So the press is recorded in an ordinary `useState`, which is
// UI state and nothing else (`memory/contracts/data-patterns.md`): it is only
// ever read while a request is in flight, so it never needs resetting.
// ============================================================================

export type PhaseTemplatePromptPress = "import" | "dismiss" | null;

export interface PhaseTemplatePromptControlState {
  /** Both buttons go inert together — one form, one answer. */
  disabled: boolean;
  importing: boolean;
  dismissing: boolean;
  importLabel: string;
}

/**
 * What the two buttons say and whether they accept a press.
 *
 * Pulled out of the component because `useFormStatus` cannot be driven from a
 * test — it reports `pending: false` under `renderToStaticMarkup` no matter
 * what — and "the submit button is disabled while the request runs" is the
 * acceptance criterion. As a pure function of (in flight?, which button?) it is
 * assertable at every combination, and the browser gate proves the wiring.
 *
 * An unknown press while pending reads as an import: a submit that reached the
 * form without going through either handler is the default action, which is the
 * import.
 */
export function phaseTemplatePromptControlState(
  pending: boolean,
  pressed: PhaseTemplatePromptPress
): PhaseTemplatePromptControlState {
  const dismissing = pending && pressed === "dismiss";
  const importing = pending && !dismissing;

  return {
    disabled: pending,
    importing,
    dismissing,
    importLabel: importing ? "Importing…" : "Import checklists",
  };
}

export interface PhaseTemplatePromptControlsProps {
  /** The decline action, routed by `formAction` on the second button. */
  dismissAction: (formData: FormData) => void | Promise<void>;
}

export function PhaseTemplatePromptControls({
  dismissAction,
}: PhaseTemplatePromptControlsProps) {
  // Reads the status of the FORM this renders inside, which is why the
  // component sits in the markup rather than wrapping it.
  const { pending } = useFormStatus();
  const [pressed, setPressed] = useState<PhaseTemplatePromptPress>(null);

  const { disabled, importing, dismissing, importLabel } =
    phaseTemplatePromptControlState(pending, pressed);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        size="sm"
        className="cursor-pointer"
        disabled={disabled}
        aria-busy={importing}
        onClick={() => setPressed("import")}
      >
        {importLabel}
      </Button>
      {/*
        A second action on the same form rather than a nested one — a form may
        not contain a form, and the two answers belong to one control group.
        `formAction` is how React routes a submit to the other server function.
      */}
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        formAction={dismissAction}
        className="cursor-pointer"
        disabled={disabled}
        aria-busy={dismissing}
        onClick={() => setPressed("dismiss")}
      >
        Not now
      </Button>
    </div>
  );
}
