import type { EveJsonValue } from "../capabilities/registry";

const sensitiveField =
  /password|secret|credential|authorization|cookie|session|api.?key|access.?token|refresh.?token/i;
const redactString = (value: string) =>
  value
    .replace(
      /\b(?:sk|pk)-(?:proj-|lf-|live-|test-)?[a-zA-Z0-9_-]{12,}\b/g,
      "[redacted credential]"
    )
    .replace(/\bBearer\s+[a-zA-Z0-9._~+/=-]+/gi, "Bearer [redacted credential]")
    .replace(
      /\b(password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret)\s*[:=]\s*["']?[^\s"',;]+["']?/gi,
      "$1=[redacted credential]"
    );

/** Best-effort known-format scrubbing, not a promise to recognize arbitrary secrets. */
export function scrubJevRoutingPayload(value: EveJsonValue): EveJsonValue {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(scrubJevRoutingPayload);
  if (value && typeof value === "object") {
    // Draft facts encode their field name as data: {key:'password', value:'...'}.
    if (typeof value.key === "string" && sensitiveField.test(value.key))
      return { key: "[redacted field]", value: "[redacted credential]" };
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveField.test(key)
          ? "[redacted credential]"
          : scrubJevRoutingPayload(entry),
      ])
    );
  }
  return value;
}
