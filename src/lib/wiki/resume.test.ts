import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readingPosition,
  resumeScrollTop,
  wikiResumeHref,
  scheduleReadingRestore,
} from "./resume";

test("resume intent preserves encoded article slugs", () => {
  assert.equal(
    wikiResumeHref("guide/what #now?"),
    "/wiki/guide/what%20%23now%3F?resume=1"
  );
});

test("invalid, absent and obsolete saved positions open at the start", () => {
  for (const value of [undefined, null, NaN, Infinity, -0.1, 1.1])
    assert.equal(readingPosition(value), 0);
  assert.equal(readingPosition(0.4), 0.4);
});

test("resume position is bounded by current content and viewport dimensions", () => {
  assert.equal(resumeScrollTop(0.5, 2400, 800), 800);
  assert.equal(resumeScrollTop(0.5, 3200, 600), 1300);
  assert.equal(resumeScrollTop(1, 300, 800), 0);
  assert.equal(resumeScrollTop(1, 2400, 800), 1600);
});

test("failed assets permit restoration and slow assets have a bounded wait", async () => {
  let restores = 0;
  scheduleReadingRestore(
    [Promise.reject(new Error("failed image"))],
    () => restores++
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(restores, 1);
  scheduleReadingRestore([new Promise(() => {})], () => restores++, 10);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(restores, 2);
});

test("reader input cancels delayed restoration even when the image later loads", async () => {
  let loaded!: () => void;
  const image = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  let scrollTop = 200;
  const cancel = scheduleReadingRestore(
    [image],
    () => {
      scrollTop = 800;
    },
    10
  );
  cancel();
  scrollTop = 450; // The reader's own scroll remains authoritative.
  loaded();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(scrollTop, 450);
});
