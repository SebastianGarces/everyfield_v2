import { cn } from "@/lib/utils";
import { renderTemplate } from "@/lib/communication/merge";
import { escapeMergeValues, toRichTextHtml } from "@/lib/rich-text/format";

import { RICH_TEXT_PROSE_CLASS } from "./rich-text-editor-controls";

/**
 * Read-only rendering of a stored rich-text value (COM-017 / T-021).
 *
 * ONE reader, for every surface: the sent-message detail page, the task detail
 * page, and anything that comes next. It was `MessageBody` under
 * `components/communication/` while messages were the only rich text in the
 * product; the task detail page then hand-rolled a second copy of it —
 * `dangerouslySetInnerHTML` plus its own prose classes — and the two had
 * already drifted apart in spacing and link colour before either shipped. The
 * name is surface-neutral now so the next feature borrows this instead of
 * writing a third one.
 *
 * Three things happen here and nowhere else per surface:
 *
 *  - it renders the FORMATTING, not the markup. A detail page that prints
 *    `<strong>` at a planter is the bug this component exists to prevent;
 *  - it sanitises on the way OUT. The write path already sanitised, but a row
 *    can predate that, and a renderer that trusts its input is one migration
 *    away from being wrong. `toRichTextHtml` also carries the legacy values —
 *    everything written before this shipped is plain text with newlines, and
 *    there is no migration;
 *  - it substitutes merge fields, behind the optional `mergeData`, so the value
 *    is sanitised EXACTLY ONCE on its way to the screen. A caller that
 *    sanitised first and let this component sanitise again is the shape that
 *    corrupted the message detail page: two passes over an escaping sanitiser
 *    turned `Bob & Sue` into `Bob &amp; Sue`. The sanitiser is idempotent now,
 *    but one pass in one place is the property worth keeping — and it preserves
 *    the send path's order, sanitise THEN substitute escaped values, so a
 *    person named `Bobby <script>` is a name here as well.
 */
export function RichText({
  body,
  mergeData,
  className,
}: {
  body: string | null | undefined;
  mergeData?: Record<string, string>;
  className?: string;
}) {
  const sanitized = toRichTextHtml(body);
  const html = mergeData
    ? renderTemplate(sanitized, escapeMergeValues(mergeData))
    : sanitized;

  if (!html) {
    return <p className="text-muted-foreground text-sm italic">(No content)</p>;
  }

  return (
    <div
      className={cn(RICH_TEXT_PROSE_CLASS, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
