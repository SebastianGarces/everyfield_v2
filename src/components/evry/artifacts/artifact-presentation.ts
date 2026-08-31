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
  /(^|\s)(id|ids|type|version|mode|baseline|rows?|targets?|fields?|exclusions?|recipient source|audience|expected.*|created by)(\s|$)/i;
const INTERNAL_PREVIEW =
  /complete immutable plan|identity|notification(?:\s+\d+)?$/i;
const MEETING_INTERNAL_TARGET =
  /^(datetime|timezone|status|estimated attendance|duration minutes|agenda|meeting number|checklist items)$/i;

const CUSTOMER_TARGET_LABELS = new Map([
  ["title", "Meeting"],
  ["location name", "Location"],
  ["location address", "Address"],
]);

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
  targets: readonly ReviewTarget[],
  effectKind?: string
): readonly ReviewTarget[] {
  return targets.flatMap((target) => {
    const label = readableLabel(target.label);
    const value = target.value.trim();
    if (
      effectKind === "meeting" &&
      MEETING_INTERNAL_TARGET.test(label.toLocaleLowerCase("en-US"))
    ) {
      return [];
    }
    if (
      value.length > 0 &&
      value.toLocaleLowerCase("en-US") !== "null" &&
      !UUID.test(value) &&
      !looksLikeStructuredData(value) &&
      !INTERNAL_TARGET.test(label)
    ) {
      return [
        {
          ...target,
          label:
            CUSTOMER_TARGET_LABELS.get(label.toLocaleLowerCase("en-US")) ??
            label,
          value,
        },
      ];
    }
    return [];
  });
}

export function customerContentPreviews(
  previews: readonly ContentPreview[]
): readonly ContentPreview[] {
  const seen = new Set<string>();
  return previews.flatMap((preview) => {
    const readable = readableLabel(preview.label);
    if (
      INTERNAL_PREVIEW.test(readable) ||
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
    const label = /subject/i.test(readable)
      ? "Subject"
      : /message|body/i.test(readable)
        ? "Message"
        : readable;
    const identity = `${label}\u0000${content}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...preview, label, content }];
  });
}

export function readResultLabel(count: number): string {
  return `${count.toLocaleString()} result${count === 1 ? "" : "s"}`;
}
