// ============================================================================
// Task Descriptions (T-021)
// ============================================================================
//
// A task description is stored as HTML, in exactly the shape COM-017's editor
// produces, and it is sanitised by the same allow-list sanitiser. Two rules
// hold this together, and they are the reason these functions exist rather
// than a `toRichTextHtml()` sprinkled at call sites:
//
//   1. The WRITE paths sanitise. `createTask` and `updateTask` are reached from
//      `"use server"` actions — POSTable endpoints that never saw the toolbar —
//      and `importTaskTemplate` writes the catalog's own authored strings.
//      Every one of them goes through `normalizeTaskDescription`.
//   2. The LIST surfaces carry plain text. `listTasks`/`listSubtasks` feed the
//      task cards, which render their fields as text; handing them markup would
//      print `<strong>` at the planter.
//
// `description` means ONE thing everywhere — the stored HTML — and a list row
// carries the readable summary BESIDE it, under its own name. It briefly meant
// two things: the list readers overwrote `description` with plain text while
// `getTask` returned markup, both typed `TaskWithAssignee`, so which shape a
// caller held depended on which query had produced it and nothing in the type
// said so.
//
// This module is import-free apart from the rich-text door, so a client
// component can take the row TYPE from it without pulling the database-backed
// service into the browser bundle.
// ============================================================================

import {
  isRichTextEmpty,
  richTextToPlainText,
  toRichTextHtml,
} from "@/lib/rich-text/format";

/**
 * The one door a description takes into storage.
 *
 * Markup is sanitised; a legacy plain-text description is converted to the same
 * shape, which is what lets a row written before T-021 render and edit without
 * a migration. An editor emptied by hand leaves `<p><br></p>` behind — truthy,
 * and a `!value.trim()` guard waves it through — so emptiness is decided by
 * `isRichTextEmpty` and stored as NULL, keeping "has a description" a single
 * question everywhere downstream.
 */
export function normalizeTaskDescription(
  value: string | null | undefined
): string | null {
  const html = toRichTextHtml(value);
  return isRichTextEmpty(html) ? null : html;
}

/**
 * The readable text of a description, for a surface that summarises rather than
 * renders — the task card above all.
 *
 * Not truncated here: how much fits is the card's question, and a service that
 * guesses at it hands the UI a string it cannot lengthen. The card clamps it
 * with `line-clamp-2`, which is a CSS decision the server has no business
 * making.
 */
export function taskDescriptionPreview(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const text = richTextToPlainText(toRichTextHtml(value));
  return text === "" ? null : text;
}

/**
 * A row from a LIST query: the stored description, plus its readable summary.
 *
 * Optional so the card view can also be handed a plain `TaskWithAssignee` (the
 * marketing vignettes do exactly that) without inventing a preview for it.
 */
export type WithDescriptionPreview<T> = T & {
  descriptionPreview?: string | null;
};

/** Add each row's readable preview alongside the description it summarises. */
export function withDescriptionPreviews<
  T extends { description: string | null },
>(rows: T[]): WithDescriptionPreview<T>[] {
  return rows.map((row) => ({
    ...row,
    descriptionPreview: taskDescriptionPreview(row.description),
  }));
}
