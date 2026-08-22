/**
 * #657 — proof that the settings modal is a FRAGMENT and nothing else.
 *
 * Run against a `next start` server (NOT the dev server on :3000):
 *   pnpm build && PORT=3411 pnpm start &
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/prove-settings-hash.ts
 *
 * TWO CLAIMS, BOTH ONLY VISIBLE ON THE WIRE.
 *
 *   1. NO SERVER RESPONSE CARRIES A SETTINGS MODAL. Whatever a dashboard URL
 *      says after the `#`, the server sends the screen and only the screen — the
 *      modal is client state and the fragment never leaves the browser. This is
 *      the whole mechanism, stated as the thing that would be false if any of it
 *      had been left routed.
 *   2. THE RETIRED URLS STILL LAND, path to path-plus-fragment. A server can
 *      never READ a fragment and can always WRITE one, which is the asymmetry
 *      the four deleted routes are retired on.
 *
 * The browser gate on the preview is what proves the modal itself opens; this is
 * what proves the server has stopped having an opinion about it.
 */
import assert from "node:assert/strict";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  generateSessionToken,
  invalidateSession,
  hashToken,
} from "@/lib/auth/session";
import { SETTINGS_SECTIONS, settingsSectionUrl } from "@/lib/settings/sections";

const ORIGIN = process.env.PROVE_ORIGIN ?? "http://127.0.0.1:3411";

/**
 * Radix portals the dialog on the client, so a server response can only betray a
 * modal through the MARKUP OR THE PAYLOAD it would need to draw one. Both are
 * counted: `data-slot="dialog-content"` is what a server-rendered dialog leaves
 * in the HTML, and the rail's own `aria-label` is what a flight payload carrying
 * an open modal would serialize.
 */
function modalTraces(body: string): number {
  return (
    (body.match(/data-slot=\\?"dialog-content\\?"/g) ?? []).length +
    (body.match(/Settings sections/g) ?? []).length
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
  await createSession(token, owner.id, { userAgent: "prove-settings-hash" });
  console.log(`Probing as ${owner.email}\n`);

  async function get(path: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${ORIGIN}${path}`, {
      headers: {
        cookie: `session=${token}`,
        "user-agent": "prove-settings-hash",
        ...headers,
      },
      redirect: "manual",
    });
    return { response, body: await response.text() };
  }

  let failures = 0;
  function check(label: string, detail: string, ok: boolean) {
    console.log(`${ok ? "  ok" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
  }

  try {
    console.log("1. no dashboard response carries a modal\n");
    for (const path of ["/dashboard", "/meetings", "/people", "/tasks"]) {
      const { response, body } = await get(path);
      check(
        path,
        `${response.status} · modal traces: ${modalTraces(body)}`,
        response.status === 200 && modalTraces(body) === 0
      );

      // THE FRAGMENT IS NOT SENT, and this is what says so out loud: the same
      // request with the settings fragment appended is byte-for-byte the same
      // request as far as the server is concerned, because `fetch` — like a
      // browser — strips it before the wire.
      const { response: withHash, body: hashBody } = await get(
        `${path}#settings/church`
      );
      check(
        `${path}#settings/church`,
        `${withHash.status} · modal traces: ${modalTraces(hashBody)}`,
        withHash.status === 200 && modalTraces(hashBody) === 0
      );
    }

    console.log("\n2. every retired settings URL lands on its fragment\n");
    const retired: [string, string][] = [
      ["/settings", settingsSectionUrl("account")],
      // Every live section, by the URL that used to serve it.
      ...SETTINGS_SECTIONS.map((section): [string, string] => [
        `/settings/${section.id}`,
        settingsSectionUrl(section.id),
      ]),
      // The one retired id in the wild: the consent panel's own address until
      // #619 folded it into Church.
      ["/settings/sharing", settingsSectionUrl("church")],
      // A typo lands on the section every account has, never on a 404.
      ["/settings/nonsense", settingsSectionUrl("account")],
    ];

    for (const [from, to] of retired) {
      const { response } = await get(from);
      const location = response.headers.get("location");
      check(
        from,
        `${response.status} -> ${location}`,
        (response.status === 307 || response.status === 308) && location === to
      );
    }

    console.log(
      failures === 0 ? "\nALL PROBES PASSED" : `\n${failures} PROBE(S) FAILED`
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    await invalidateSession(hashToken(token));
  }
}

await main();
