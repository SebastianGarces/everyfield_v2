import { cn } from "@/lib/utils";
import { renderTemplate } from "@/lib/communication/merge";
import { escapeMergeValues, toRichTextHtml } from "@/lib/rich-text/format";

/**
 * Read-only rendering of a stored message body (COM-017).
 *
 * Every surface that shows a body a planter composed goes through here, for two
 * reasons. It renders the formatting rather than the markup — a sent message
 * detail page that prints `<strong>` at the reader is the bug this component
 * exists to prevent. And it sanitises on the way out: the send path already
 * sanitised before storing, but a row can predate that, and a renderer that
 * trusts its input is one migration away from being wrong.
 *
 * `toRichTextHtml` also carries the legacy bodies — everything sent before this
 * shipped is plain text with newlines, and there is no migration.
 *
 * The merge substitution lives HERE, behind the optional `mergeData`, so the
 * body is sanitised EXACTLY ONCE on its way to the screen. A caller that
 * sanitised first and let this component sanitise again was the shape that
 * corrupted the detail page: two passes over an escaping sanitiser turned
 * `Bob & Sue` into `Bob &amp; Sue`. The sanitiser is idempotent now, but one
 * pass in one place is the property worth keeping — and it preserves the send
 * path's order, sanitise THEN substitute escaped values, so a person named
 * `Bobby <script>` is a name here as well.
 */
export function MessageBody({
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
      className={cn(
        "text-sm break-words",
        "[&_p]:mb-2 [&_p:last-child]:mb-0",
        "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-6",
        "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
