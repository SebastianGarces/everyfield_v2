type ReviewTarget = Readonly<{
  label: string;
  value: string;
  sourceLink: Readonly<{ label: string; href: string }> | null;
}>;

type ContentPreview = Readonly<{
  label: string;
  content: string;
  format?: "plain_text" | "rich_text";
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_TARGET =
  /(^|\s)(id|ids|type|version|baseline|rows?|targets?|fields?|expected.*|created by)(\s|$)/i;
const INTERNAL_PREVIEW =
  /complete immutable plan|identity|notification(?:\s+\d+)?$/i;

function readableLabel(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function looksLikeStructuredData(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

/** Keep immutable review evidence in storage while projecting only customer data. */
export function customerReviewTargets(
  targets: readonly ReviewTarget[]
): readonly ReviewTarget[] {
  return targets.filter((target) => {
    const label = readableLabel(target.label);
    const value = target.value.trim();
    return (
      value.length > 0 &&
      value.toLocaleLowerCase("en-US") !== "null" &&
      !UUID.test(value) &&
      !looksLikeStructuredData(value) &&
      !INTERNAL_TARGET.test(label)
    );
  });
}

export function customerContentPreviews(
  previews: readonly ContentPreview[]
): readonly ContentPreview[] {
  return previews.flatMap((preview) => {
    if (
      INTERNAL_PREVIEW.test(readableLabel(preview.label)) ||
      looksLikeStructuredData(preview.content)
    ) {
      return [];
    }
    let content = preview.content;
    if (preview.format !== "rich_text") {
      try {
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed === "string") content = parsed;
      } catch {
        // Plain text is already customer-readable.
      }
    }
    return [{ ...preview, content }];
  });
}

export function readResultLabel(count: number): string {
  return `${count.toLocaleString()} result${count === 1 ? "" : "s"}`;
}
