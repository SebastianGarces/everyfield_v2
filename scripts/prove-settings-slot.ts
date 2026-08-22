/**
 * #646 / #640 — proof that every settings modal comes from the `@settings` slot,
 * and that exactly one is ever sent, on each of the five ways a reader arrives.
 *
 * Run against a `next start` server (NOT the dev server on :3000):
 *   pnpm build && PORT=3411 pnpm start &
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/prove-settings-slot.ts
 *
 * The discriminator is the `intercepted` prop. It is a client prop on
 * `SettingsModal`, so it is serialized into every flight payload that carries a
 * modal — once per modal. Counting it counts the copies; reading it says which
 * route matched (`true` = the interceptor, `false` = its non-intercepting twin).
 */
import assert from "node:assert/strict";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  generateSessionToken,
  hashToken,
  invalidateSession,
} from "@/lib/auth/session";

const ORIGIN = process.env.PROVE_ORIGIN ?? "http://127.0.0.1:3411";

/** Every `intercepted` value the response carries, in order. One per modal. */
function interceptedValues(payload: string): boolean[] {
  return [...payload.matchAll(/\\?"intercepted\\?":(true|false)/g)].map(
    (match) => match[1] === "true"
  );
}

async function main() {
  const [owner] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.seat, "owner"), isNotNull(users.churchId)))
    .limit(1);

  assert.ok(owner, "no plant Owner in the dev DB to probe as");
  const token = generateSessionToken();
  await createSession(token, owner.id, { userAgent: "prove-settings-slot" });
  console.log(`Probing as ${owner.email}\n`);

  async function probe(
    what: string,
    path: string,
    headers: Record<string, string>
  ) {
    const response = await fetch(`${ORIGIN}${path}`, {
      headers: { cookie: `session=${token}`, ...headers },
      redirect: "manual",
    });
    const body = await response.text();
    const modals = interceptedValues(body);
    console.log(
      `${what}\n  GET ${path} ${JSON.stringify(headers)}\n` +
        `  -> ${response.status} · modals: ${modals.length} · intercepted: ${JSON.stringify(modals)}`
    );
    return { status: response.status, body, modals };
  }

  try {
    // 1. COLD LOAD — the URL notification mail ships. Not intercepted, so this
    //    is the slot's non-intercepting twin.
    const cold = await probe(
      "1. cold load /settings/church",
      "/settings/church",
      { "user-agent": "prove-settings-slot" }
    );
    assert.equal(cold.status, 200);
    assert.deepEqual(
      cold.modals,
      [false],
      "cold load must send ONE cold modal"
    );
    assert.match(cold.body, /<title>Church · Settings<\/title>/);
    // The stand-down rule's prop is gone with the mechanism it served.
    assert.ok(!cold.body.includes('"ownPath"'), "`ownPath` is retired");

    // 2. IN-APP OPEN from /people — intercepted, so `children` keeps /people.
    const inApp = await probe(
      "2. in-app open /people -> /settings/church",
      "/settings/church",
      { RSC: "1", "Next-Url": "/people" }
    );
    assert.deepEqual(
      inApp.modals,
      [true],
      "an in-app open is ONE intercepted modal"
    );

    // 3. #646's SECOND LEG — a section switch after a cold load.
    //
    //    THE VALUE MATTERS AS MUCH AS THE COUNT, and this is the only probe that
    //    asks it: two routes in one slot now match `/settings/church`, and which
    //    of them wins a soft navigation is a NEW question. `false` here would
    //    mean the non-intercepting twin won — and then a reader who opened
    //    settings over `/people` would have `children` re-resolved to
    //    `default.tsx` on their first section switch, destroying the screen
    //    behind the modal and leaving Close pointing at nothing. Worse than
    //    #646, and invisible to a count.
    const away = await probe(
      "3. after a cold load, switch section",
      "/settings/account",
      { RSC: "1", "Next-Url": "/settings/church" }
    );
    assert.deepEqual(away.modals, [true], "a section switch is intercepted");

    // 4. #646's THIRD LEG, THE DEFECT — back to the section the document booted
    //    on. Before this fix the pinned `children` copy matched its own path
    //    again and drew a SECOND dialog beside the slot's.
    const back = await probe(
      "4. …and back to the entry section (#646)",
      "/settings/church",
      { RSC: "1", "Next-Url": "/settings/account" }
    );
    assert.deepEqual(back.modals, [true], "#646: returning stays ONE modal");

    // 5. CLOSE BY NAVIGATING — the slot stands down, no modal at all.
    const closed = await probe("5. navigate out to /people", "/people", {
      RSC: "1",
      "Next-Url": "/settings/church",
    });
    assert.deepEqual(closed.modals, [], "leaving settings sends no modal");

    // 6/7. THE BARE `/settings`, both ways. It moved with its `[section]`
    //      sibling and is a DIFFERENT match — a static slot segment competing
    //      with `(.)settings` and `[...catchAll]`, not the dynamic one every
    //      probe above exercised. It is also the URL in sent mail and bookmarks.
    const bareCold = await probe("6. cold load /settings", "/settings", {
      "user-agent": "prove-settings-slot",
    });
    assert.deepEqual(bareCold.modals, [false], "bare cold load is ONE modal");
    assert.match(bareCold.body, /<title>Settings<\/title>/);

    const bareInApp = await probe(
      "7. in-app open /people -> /settings",
      "/settings",
      { RSC: "1", "Next-Url": "/people" }
    );
    assert.deepEqual(bareInApp.modals, [true], "bare in-app open is ONE modal");

    console.log("\nALL PROBES PASSED");
  } finally {
    await invalidateSession(await hashToken(token));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
