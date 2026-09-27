import { wikiHref } from "./href";

export function wikiResumeHref(slug: string) {
  return `${wikiHref(slug)}?resume=1`;
}

export function readingPosition(value: number | null | undefined): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : 0;
}

export function resumeScrollTop(
  position: number,
  scrollHeight: number,
  clientHeight: number
): number {
  return readingPosition(position) * Math.max(0, scrollHeight - clientHeight);
}

/** Wait briefly for layout assets, but never hold up a reader's own scrolling. */
export function scheduleReadingRestore(
  assets: Promise<unknown>[],
  restore: () => void,
  timeoutMs = 1000
): () => void {
  let pending = true;
  const finish = () => {
    if (!pending) return;
    pending = false;
    clearTimeout(timeout);
    restore();
  };
  const timeout = setTimeout(finish, timeoutMs);
  void Promise.allSettled(assets).then(finish);
  return () => {
    pending = false;
    clearTimeout(timeout);
  };
}
