/**
 * WHAT THE THREE PHASE-PROMPT SUITES SHARE, AND WHY THERE ARE THREE (#411).
 *
 * The panel used to be pinned by ONE 1,276-line suite covering four unrelated
 * subjects — the asking body's copy, the island's pure control state, the
 * server module's action wiring, and the flash cookie's road. A file that size
 * is not readable as a whole, and coverage over it is not steerable: a change
 * to the fine print re-ran the receipt's assertions, a failure named a file
 * rather than a subject, and there was no smaller thing to run. So the tests
 * were split by SUBJECT, one file each:
 *
 *   - `phase-template-prompt.test.ts` — the PANEL: both bodies' markup and copy,
 *     and the one chrome they share;
 *   - `phase-template-prompt-controls.test.ts` — the ISLAND: the pure control
 *     state, what feeds its tick count, and its one live region;
 *   - `phase-template-prompt-receipt.test.ts` — the RECEIPT'S ROAD: what the two
 *     server actions do with a decision, which loader branch reads the flash,
 *     and how the flash is spent.
 *
 * The split only works if the three cannot drift on how they RENDER the thing
 * they are describing, so every fixture and every markup reader lives here and
 * nowhere else. This module is not a `*.test.ts`, so the runner never treats it
 * as a suite of its own — it holds no assertions beyond the two that guard its
 * own helpers (`promptData`, `seam`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildPhaseTemplatePrompt,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";

import {
  PhaseTemplatePromptAlert,
  PhaseTemplatePromptForm,
  type PhaseTemplateDismissOutcome,
  type PhaseTemplateImportOutcome,
} from "./phase-template-prompt-controls";
import {
  PhaseTemplatePartialReceiptView,
  PhaseTemplatePromptView,
} from "./phase-template-prompt";

export const TRANSITIONED_AT = new Date("2026-03-02T09:15:00.000Z");

/** The transition every fixture here is answering. */
export const TRANSITION_ID = "22222222-2222-4222-8222-222222222222";

/** The server module and the island, as source — three of the properties below
 *  are about what a `"use server"` closure or a `"use client"` module DOES, and
 *  neither can be called from a test process. */
export const PROMPT_SOURCE_PATH =
  "src/components/tasks/phase-template-prompt.tsx";
export const CONTROLS_SOURCE_PATH =
  "src/components/tasks/phase-template-prompt-controls.tsx";

export function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

export function promptData(toPhase = 2): PhaseTemplatePromptData {
  const prompt = buildPhaseTemplatePrompt({
    id: "11111111-1111-4111-8111-111111111111",
    fromPhase: toPhase - 1,
    toPhase,
    createdAt: TRANSITIONED_AT,
  });

  assert.ok(prompt, `phase ${toPhase} offers nothing to render`);
  return prompt;
}

export const IDLE_IMPORT: PhaseTemplateImportOutcome = { status: "idle" };
export const IDLE_DISMISS: PhaseTemplateDismissOutcome = { status: "idle" };

export async function noopImport(): Promise<PhaseTemplateImportOutcome> {
  return IDLE_IMPORT;
}

export async function noopDismiss(): Promise<PhaseTemplateDismissOutcome> {
  return IDLE_DISMISS;
}

/**
 * The prompt, rendered. DOM assertions, not source scans: the Cursor Pointer
 * Rule is about what ships to a browser, so it is asserted on the markup a
 * browser would receive.
 *
 * The view takes its data and its two actions as props, so this renders the
 * real component with no session, no database and no phase transition.
 */
export function render(prompt: PhaseTemplatePromptData = promptData()): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptView, {
      prompt,
      importAction: noopImport,
      dismissAction: noopDismiss,
    })
  );
}

/**
 * The island on its own, at a tick count a full render cannot reach.
 *
 * The checkboxes are uncontrolled server markup, so "no box is ticked" is set
 * here, at the island's own resting count, rather than simulated.
 *
 * THE OUTCOME MARKUP IS NOT REACHED THROUGH THIS. `useActionState` holds its
 * initial state under `renderToStaticMarkup`, and the island used to carry
 * three `initial*` props so a test could seed it — production scaffolding for
 * test reach. The two outcome surfaces are components now, rendered directly;
 * what the island still decides is WHICH of them, and that decision is
 * `phaseTemplatePromptAlert`, asserted as the pure function it is.
 */
export function renderIsland(overrides: { offerCount?: number } = {}): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptForm, {
      transitionId: TRANSITION_ID,
      offerCount: overrides.offerCount ?? 2,
      children: null,
      importAction: noopImport,
      dismissAction: noopDismiss,
    })
  );
}

/** The one live region, on its own. */
export function renderAlert(message: string): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptAlert, { message })
  );
}

/**
 * The panel in its OTHER body: the receipt, rendered by the server component
 * from the flash cookie the action wrote.
 *
 * It takes no actions and no prompt, because by the time it renders there is
 * neither — which is the whole reason it is not island state.
 */
export function renderReceipt(
  createdCount: number,
  templateNames: string[]
): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePartialReceiptView, {
      receipt: { transitionId: TRANSITION_ID, createdCount, templateNames },
    })
  );
}

/**
 * Every element of one component type in a returned tree, at any depth.
 *
 * A MARKUP ASSERTION CANNOT SEE `ClearReceiptCookie`: it renders `null`, so
 * `renderReceipt` produces the same HTML whether it is there or not. The flash
 * is spent by being shown, and "shown" means that component mounted — so the
 * only honest place to assert it is the element tree the server component
 * returns, before React throws the empty render away.
 */
export function elementsOfType(
  node: ReactNode,
  type: unknown
): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => elementsOfType(child as ReactNode, type));
  }
  if (!isValidElement(node)) return [];

  const props = (node.props ?? {}) as Record<string, unknown>;
  const nested = elementsOfType((props.children ?? null) as ReactNode, type);

  return node.type === type ? [{ props }, ...nested] : nested;
}

/** How many `role="alert"` live regions the markup carries. */
export function alertCount(html: string): number {
  return (html.match(/role="alert"/g) ?? []).length;
}

/** The `<button>` tags in document order — Import first, then Not now. */
export function buttons(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

/** Undo React's HTML escaping, so an assertion can be written in the words a
 *  reader sees ("Children's Ministry", "Training & Preparation"). */
export function decode(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Strip tags — what a reader actually sees. */
export function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
}

/**
 * One `data-testid` block of the prompt, split into its tag and its contents.
 *
 * The structural rules are about WHICH BLOCK a sentence lives in — the lead or
 * the fine print — not about how a block is styled. Anchored to the serialized
 * `class` attribute they broke whenever prettier reordered a utility class;
 * anchored to the seam they break only when a sentence actually moves. The size
 * token is still checked, but loosely, because "the fine print is smaller than
 * the lead" IS part of the rule.
 *
 * Neither seam nests a `<div>`, so "up to the next `</div>`" delimits it
 * exactly — and that is asserted, so the day one grows a wrapper this fails
 * loudly instead of silently measuring half a block.
 */
export function seam(
  html: string,
  testId: string
): { tag: string; inner: string } {
  const open = new RegExp(`<div[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  assert.ok(open, `the ${testId} seam is missing`);

  const start = open.index + open[0].length;
  const end = html.indexOf("</div>", start);
  assert.ok(end > start, `the ${testId} seam is never closed`);

  const inner = html.slice(start, end);
  assert.ok(
    !inner.includes("<div"),
    `the ${testId} seam grew a nested <div>, so this helper no longer delimits it`
  );

  return { tag: open[0], inner };
}

export function clickables(html: string): string[] {
  return [
    ...(html.match(/<button[^>]*>/g) ?? []),
    ...(html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []),
    ...(html.match(/<label[^>]*>/g) ?? []),
  ];
}
