import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// ============================================================================
// THE HISTORY POLICY, DRIVEN (#657).
//
// Every other guard on this mechanism reads SOURCE — one mount, no settings
// page, no raw href, one history author. Those catch a shape coming back. They
// caught none of the three defects a review found in this module, because all
// three are about what happens WHEN, and the only way to see that is to run it:
//
//   * Close walked the reader off the page when the arrival changed the page and
//     the fragment in one entry (`verify-email-confirm.tsx` does exactly that);
//   * a read outlived the visit, so reopening a section showed the previous
//     visit's rows;
//   * a failed read was cached under a key nothing moved, so a retry replayed it.
//
// So this file drives the real module against a fake `window`. Nothing is
// injected: `settings-hash.ts` reaches `window` when it is CALLED, which is what
// makes a fake enough — and what keeps the production code free of a seam
// parameter threaded through nine functions to serve a test.
// ============================================================================

type Entry = { url: string };

/**
 * A history stack with a cursor, which is what the policy is actually about.
 *
 * `length` grows on a push and NEVER on a back — the browser's own rule, and the
 * one that makes "settings occupies one entry" a claim worth asserting.
 */
class FakeWindow {
  entries: Entry[];
  index = 0;
  listeners: Record<string, ((event?: unknown) => void)[]> = {};

  constructor(url: string) {
    this.entries = [{ url }];
    // Arrow functions, so the object closes over the instance rather than over
    // its own `this` — the patch in `watchHistory` reassigns these properties,
    // and a `this`-dependent method would then be called on the wrong receiver.
    this.history = {
      pushState: (_state: unknown, _title: string, to: string) => {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push({ url: new URL(to, this.href()).href });
        this.index = this.entries.length - 1;
      },
      replaceState: (_state: unknown, _title: string, to: string) => {
        this.entries[this.index] = { url: new URL(to, this.href()).href };
      },
      back: () => {
        if (this.index > 0) {
          this.index -= 1;
          this.emit("popstate");
        }
      },
      forward: () => {
        if (this.index < this.entries.length - 1) {
          this.index += 1;
          this.emit("popstate");
        }
      },
    };
  }

  /** How many entries the stack holds — a browser's `history.length`. */
  get depth(): number {
    return this.entries.length;
  }

  href(): string {
    return this.entries[this.index].url;
  }

  private current(): URL {
    return new URL(this.entries[this.index].url);
  }

  get location() {
    const url = this.current();
    return {
      get hash() {
        return url.hash;
      },
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      href: url.href,
    };
  }

  /**
   * ONE OBJECT, not a fresh one per access — and that is not a shortcut, it is
   * the thing under test. `watchHistory` PATCHES `pushState` and `replaceState`
   * in place, so a `history` getter that minted a new object every read would
   * throw the patch away and this file would report a pass over a store that
   * notices nothing.
   */
  readonly history: {
    pushState(state: unknown, title: string, to: string): void;
    replaceState(state: unknown, title: string, to: string): void;
    back(): void;
    forward(): void;
  };

  addEventListener(type: string, handler: (event?: unknown) => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  removeEventListener(type: string, handler: (event?: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (h) => h !== handler
    );
  }

  emit(type: string) {
    for (const handler of this.listeners[type] ?? []) handler();
  }

  get url(): string {
    return this.entries[this.index].url;
  }
}

const ORIGIN = "https://app.test";

/** Arrive on `url`, subscribe as the modal does, and hand back the driver. */
async function arriveOn(url: string) {
  const fake = new FakeWindow(`${ORIGIN}${url}`);
  (globalThis as { window?: unknown }).window = fake;

  const mod = await import("./settings-hash.js");
  mod.__resetSettingsHashForTest();

  let renders = 0;
  const unsubscribe = mod.subscribeToSettingsHash(() => {
    renders++;
  });
  return {
    fake,
    mod,
    unsubscribe,
    renders: () => renders,
    /** What the modal would show: the section, or `null` for shut. */
    open: () => mod.settingsHashSnapshot(),
  };
}

beforeEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("a cold load into settings closes IN PLACE, and never navigates", async () => {
  const { fake, mod } = await arriveOn("/phase#settings/church");
  const entriesBefore = fake.depth;

  mod.closeSettings();

  assert.equal(fake.url, `${ORIGIN}/phase`, "the fragment is stripped");
  assert.equal(
    fake.depth,
    entriesBefore,
    "closing a cold load adds no entry and consumes none — there was nothing behind it"
  );
  assert.equal(fake.index, 0, "the reader has not been walked backwards");
});

test("opened from a dashboard screen, close is ONE step back", async () => {
  const { fake, mod } = await arriveOn("/meetings");

  mod.openSettings("account");
  assert.equal(fake.url, `${ORIGIN}/meetings#settings/account`);
  assert.equal(fake.depth, 2, "opening pushes exactly one entry");

  mod.closeSettings();
  assert.equal(fake.url, `${ORIGIN}/meetings`, "back to the screen behind");
  assert.equal(fake.index, 0, "one step, not two");
});

test("switching sections replaces, so settings is ONE entry however far you roam", async () => {
  const { fake, mod } = await arriveOn("/meetings");

  mod.openSettings("account");
  for (const id of [
    "church",
    "team",
    "association",
    "notifications",
  ] as const) {
    mod.showSection(id);
  }

  assert.equal(fake.url, `${ORIGIN}/meetings#settings/notifications`);
  assert.equal(
    fake.depth,
    2,
    "four switches added no entries — the open is still the only one"
  );

  mod.closeSettings();
  assert.equal(
    fake.url,
    `${ORIGIN}/meetings`,
    "and close is still one step, from the last section the reader was on"
  );
});

test("an arrival that changes PAGE and fragment together closes in place", async () => {
  // THE REGRESSION, and it shipped once. `verify-email-confirm.tsx` links to
  // `/dashboard#settings/account` from `/verify-email`, which is inside the
  // dashboard group — so the modal is already mounted and the router's push
  // moves the page and the fragment in ONE entry. A latch that watched only the
  // fragment concluded "this document pushed it" and closed with `back()`,
  // returning the reader to a consumed token screen instead of shutting the
  // modal.
  const { fake, mod } = await arriveOn("/verify-email?token=abc");

  // What the router does: one entry, new page, new fragment.
  fake.history.pushState(null, "", `${ORIGIN}/dashboard#settings/account`);

  assert.equal(mod.settingsHashSnapshot(), "#settings/account");

  mod.closeSettings();
  assert.equal(
    fake.url,
    `${ORIGIN}/dashboard`,
    "the modal closes and the reader stays on the page they arrived at"
  );
  assert.notEqual(
    fake.url,
    `${ORIGIN}/verify-email?token=abc`,
    "and is NOT walked back to the token screen"
  );
});

test("Back closes an opened modal; Forward reopens it", async () => {
  const { fake, mod } = await arriveOn("/phase");

  mod.openSettings("team");
  fake.history.back();
  assert.equal(fake.url, `${ORIGIN}/phase`, "Back closes it");
  assert.equal(mod.settingsHashSnapshot(), "", "the store agrees it is shut");

  fake.history.forward();
  assert.equal(mod.settingsHashSnapshot(), "#settings/team", "Forward reopens");

  // …and Close still works from there, because Forward put an entry behind it.
  mod.closeSettings();
  assert.equal(fake.url, `${ORIGIN}/phase`);
});

test("the store notices a URL written with the history API, which fires nothing", async () => {
  // Next's client router writes every URL it navigates to with pushState /
  // replaceState. Watching only `hashchange` left the modal shut with
  // `#settings/notifications` in the address bar — measured on the preview,
  // following a mailed link through the login round trip.
  const { fake, mod, renders } = await arriveOn("/dashboard");
  const before = renders();

  fake.history.replaceState(null, "", `${ORIGIN}/dashboard#settings/church`);

  assert.equal(mod.settingsHashSnapshot(), "#settings/church");
  assert.ok(renders() > before, "the subscriber was told");
});

test("a read is cached for the visit, and only for the visit", async () => {
  const { fake, mod } = await arriveOn("/dashboard");
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    calls.push(String(input));
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, view: { section: "team" } }),
    };
  }) as unknown as typeof fetch;

  try {
    mod.openSettings("team");
    // The same three inputs must not ask twice — this is what stops the
    // suspended-replay loop.
    await mod.sectionRequest("team", "render-1", 0);
    await mod.sectionRequest("team", "render-1", 0);
    assert.equal(calls.length, 1, "one read for one section at one render");

    // A write moved the server: `refresh()` re-renders the layout and the id
    // changes, which is the ONLY thing that re-reads an open section.
    await mod.sectionRequest("team", "render-2", 0);
    assert.equal(calls.length, 2, "a new server render re-reads");

    // The interleaved-render case: an urgent update re-renders the committed
    // tree at the OLD id while a transition renders at the new one. With one
    // cache slot each evicts the other and mints a fresh promise — the same loop
    // at a lower rate.
    await mod.sectionRequest("team", "render-1", 0);
    assert.equal(calls.length, 2, "the previous render's read is still held");

    // CLOSING ENDS THE VISIT. Without this a reader who opens Team, closes, and
    // reopens minutes later is served the first visit's roster.
    mod.closeSettings();
    assert.equal(fake.url, `${ORIGIN}/dashboard`);
    await mod.sectionRequest("team", "render-2", 0);
    assert.equal(calls.length, 3, "reopening reads again");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a retry is a new request, not a replay of the cached failure", async () => {
  await arriveOn("/dashboard");
  const mod = await import("./settings-hash.js");
  let attempt = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    attempt++;
    if (attempt === 1) throw new Error("network");
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, view: {} }),
    };
  }) as unknown as typeof fetch;

  try {
    const first = await mod.sectionRequest("church", "render-1", 0);
    assert.deepEqual(first, { ok: false, reason: "failed" });

    // The same key would replay the failure for ever; the retry count is part of
    // the key precisely so a Try again button is worth pressing.
    const replayed = await mod.sectionRequest("church", "render-1", 0);
    assert.deepEqual(replayed, { ok: false, reason: "failed" }, "cached");
    assert.equal(attempt, 1);

    const retried = await mod.sectionRequest("church", "render-1", 1);
    assert.equal(attempt, 2, "the retry actually asked again");
    assert.equal(retried.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the three read failures are told apart", async () => {
  await arriveOn("/dashboard");
  const mod = await import("./settings-hash.js");
  const originalFetch = globalThis.fetch;

  const cases: [number, string][] = [
    [401, "unauthorized"],
    [500, "failed"],
  ];
  try {
    for (const [status, reason] of cases) {
      globalThis.fetch = (async () => ({
        ok: false,
        status,
        json: async () => ({}),
      })) as unknown as typeof fetch;
      assert.deepEqual(
        await mod.readSection("account"),
        { ok: false, reason },
        `${status} must read as ${reason}`
      );
    }

    // A refusal is the SERVER's answer and travels through untouched, because
    // only the server knows a gate said no.
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, reason: "refused" }),
    })) as unknown as typeof fetch;
    assert.deepEqual(await mod.readSection("church"), {
      ok: false,
      reason: "refused",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
