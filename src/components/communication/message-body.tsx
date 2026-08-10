import { cn } from "@/lib/utils";
import { toRichTextHtml } from "@/lib/rich-text/format";

/**
 * Read-only rendering of a stored message body (COM-017).
 *
 * Every surface that shows a body a planter composed goes through here, for two
 * reasons. It renders the formatting rather than the markup — a sent message
 * detail page that prints `<strong>` at the reader is the bug this component
 * exists to prevent. And it re-sanitises on the way out: the send path already
 * sanitised before storing, but a row can predate that, and a renderer that
 * trusts its input is one migration away from being wrong.
 *
 * `toRichTextHtml` also carries the legacy bodies — everything sent before this
 * shipped is plain text with newlines, and there is no migration.
 */
export function MessageBody({
  body,
  className,
}: {
  body: string | null | undefined;
  className?: string;
}) {
  const html = toRichTextHtml(body);

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
