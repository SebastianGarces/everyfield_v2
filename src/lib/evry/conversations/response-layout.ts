/** Placement is server-computed UTF-16 text position, never model arithmetic. */
export function validEvryResponseLayout(
  body: string,
  artifacts: readonly { kind: string; textOffset?: number }[]
) {
  let previous = 0;
  return artifacts.every((artifact) => {
    const offset =
      artifact.kind === "read"
        ? (artifact.textOffset ?? body.length)
        : body.length;
    const valid =
      Number.isInteger(offset) && offset >= previous && offset <= body.length;
    previous = offset;
    return valid;
  });
}
