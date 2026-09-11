import type { EvryPublicArtifact } from "@/lib/evry/artifacts/public";

/** Older messages retain their text-then-cards order. */
export function evryResponseContent<T extends { artifact: EvryPublicArtifact }>(
  body: string,
  artifacts: readonly T[]
) {
  const parts: (
    | { kind: "text"; text: string }
    | { kind: "artifact"; entry: T }
  )[] = [];
  let offset = 0;
  for (const entry of artifacts) {
    const next =
      entry.artifact.kind === "read"
        ? (entry.artifact.textOffset ?? body.length)
        : body.length;
    if (next > offset)
      parts.push({ kind: "text", text: body.slice(offset, next) });
    parts.push({ kind: "artifact", entry });
    offset = next;
  }
  if (offset < body.length)
    parts.push({ kind: "text", text: body.slice(offset) });
  return parts;
}
