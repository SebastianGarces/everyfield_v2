import assert from "node:assert/strict";
import { test } from "node:test";

import { startChurchCreatedConfetti } from "./church-created-confetti";

type ScheduledCallback = () => void;

function createFakeAnimationEnvironment({
  reducedMotion = false,
}: {
  reducedMotion?: boolean;
} = {}) {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, ScheduledCallback>();
  const frames = new Map<number, ScheduledCallback>();
  const clearedTimers: number[] = [];
  const canceledFrames: number[] = [];
  const instances: Array<{ calls: number; resets: number }> = [];
  const mediaQueries: string[] = [];

  return {
    environment: {
      createConfetti: () => {
        const instance = { calls: 0, resets: 0 };
        instances.push(instance);
        const fire = () => {
          instance.calls += 1;
          return null;
        };
        fire.reset = () => {
          instance.resets += 1;
        };
        return fire;
      },
      now: () => now,
      matchMedia: (query: string) => {
        mediaQueries.push(query);
        return { matches: reducedMotion };
      },
      requestAnimationFrame: (callback: ScheduledCallback) => {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle: number) => {
        canceledFrames.push(handle);
        frames.delete(handle);
      },
      setTimeout: (callback: ScheduledCallback) => {
        const handle = nextHandle++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle: number) => {
        clearedTimers.push(handle);
        timers.delete(handle);
      },
    },
    advanceTo(time: number) {
      now = time;
    },
    runTimer(handle: number) {
      const callback = timers.get(handle);
      assert.ok(callback, `timer ${handle} must still be scheduled`);
      timers.delete(handle);
      callback();
    },
    state() {
      return {
        canceledFrames,
        clearedTimers,
        frameHandles: [...frames.keys()],
        instances,
        mediaQueries,
        timerHandles: [...timers.keys()],
      };
    },
  };
}

test("church-created confetti does not start when matchMedia prefers reduced motion", () => {
  const fake = createFakeAnimationEnvironment({ reducedMotion: true });

  const stop = startChurchCreatedConfetti(fake.environment);

  assert.deepEqual(fake.state().mediaQueries, [
    "(prefers-reduced-motion: reduce)",
  ]);
  assert.equal(fake.state().instances.length, 0);
  assert.deepEqual(fake.state().timerHandles, []);
  assert.deepEqual(fake.state().frameHandles, []);

  stop();
});

test("unmount cancels one component's fake timers and animation handles without stopping another", () => {
  const fake = createFakeAnimationEnvironment();
  const stopFirst = startChurchCreatedConfetti(fake.environment);
  const stopSecond = startChurchCreatedConfetti(fake.environment);
  const beforeUnmount = fake.state();

  assert.equal(beforeUnmount.instances.length, 2);
  assert.deepEqual(beforeUnmount.timerHandles, [2, 3, 4, 5, 7, 8, 9, 10]);
  assert.deepEqual(beforeUnmount.frameHandles, [1, 6]);

  stopFirst();

  const afterFirstUnmount = fake.state();
  assert.deepEqual(afterFirstUnmount.clearedTimers, [2, 3, 4, 5]);
  assert.deepEqual(afterFirstUnmount.canceledFrames, [1]);
  assert.deepEqual(afterFirstUnmount.timerHandles, [7, 8, 9, 10]);
  assert.deepEqual(afterFirstUnmount.frameHandles, [6]);
  assert.deepEqual(
    afterFirstUnmount.instances.map((instance) => instance.resets),
    [1, 0],
    "each mount resets only the instance it created"
  );

  fake.advanceTo(500);
  fake.runTimer(7);
  assert.equal(afterFirstUnmount.instances[0].calls, 5);
  assert.equal(afterFirstUnmount.instances[1].calls, 7);

  stopSecond();
  assert.deepEqual(fake.state().clearedTimers, [2, 3, 4, 5, 7, 8, 9, 10]);
  assert.deepEqual(fake.state().canceledFrames, [1, 6]);
  assert.deepEqual(
    fake.state().instances.map((instance) => instance.resets),
    [1, 1]
  );
});
