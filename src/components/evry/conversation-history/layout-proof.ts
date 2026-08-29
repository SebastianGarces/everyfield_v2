type LayoutRect = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}>;

export type EvryHistoryControlLayoutEvidence = Readonly<{
  control: LayoutRect;
  hitPointCount: number;
  pane: LayoutRect;
}>;

/** Browser-gate contract: the whole New target belongs to and hits inside the history pane. */
export function proveEvryHistoryNewControlLayout(
  document: Document
): EvryHistoryControlLayoutEvidence {
  const pane = document.querySelector<HTMLElement>(
    '[data-testid="evry-history-pane-content"]'
  );
  const control = document.querySelector<HTMLElement>(
    '[data-testid="evry-history-new"]'
  );
  if (!pane || !control) {
    throw new Error("Conversation history pane or New control is unavailable.");
  }

  const paneRect = pane.getBoundingClientRect();
  const controlRect = control.getBoundingClientRect();
  const tolerance = 0.5;
  if (
    controlRect.left < paneRect.left - tolerance ||
    controlRect.right > paneRect.right + tolerance ||
    controlRect.top < paneRect.top - tolerance ||
    controlRect.bottom > paneRect.bottom + tolerance
  ) {
    throw new Error("The New control extends outside the history pane.");
  }

  const inset = 1;
  const points = [
    [controlRect.left + inset, controlRect.top + inset],
    [controlRect.right - inset, controlRect.top + inset],
    [controlRect.left + inset, controlRect.bottom - inset],
    [controlRect.right - inset, controlRect.bottom - inset],
    [
      controlRect.left + (controlRect.right - controlRect.left) / 2,
      controlRect.top + (controlRect.bottom - controlRect.top) / 2,
    ],
  ] as const;
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(x, y);
    if (hit === null || !control.contains(hit)) {
      throw new Error("The New control is covered by another hit target.");
    }
  }

  return Object.freeze({
    control: rectOf(controlRect),
    hitPointCount: points.length,
    pane: rectOf(paneRect),
  });
}

function rectOf(rect: DOMRect): LayoutRect {
  return Object.freeze({
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  });
}
