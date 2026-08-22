import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// THE MECHANISM, HELD IN PLACE TOPOLOGICALLY (#657, ruled 2026-08-22).
//
// This file replaces `settings-slot.test.ts`, which forbade a second modal by
// forbidding a second ROUTE. There are no settings routes now, so the shapes
// worth forbidding are different — but the reason for asserting them here rather
// than trusting prose is the same one #646 taught: the failure mode of a modal
// mechanism is a second copy or a silent navigation, and both look fine in a
// diff.
//
// FOUR CLAIMS, EACH THE NEGATIVE OF A REAL WAY TO LOSE THIS:
//
//   1. ONE MOUNT. The modal is rendered by the dashboard layout and by nothing
//      else, so there is exactly one on any screen. A second mount is #646 with
//      a different cause.
//   2. NO SETTINGS ROUTE RENDERS. Everything left under `app/(dashboard)/
//      settings/` is a redirect or a non-page. A page that draws a section is
//      the routed mechanism creeping back, and it would take the screen behind
//      the modal with it.
//   3. NO IN-APP LINK SPELLS A SETTINGS PATH. `/settings/team` still resolves —
//      through a permanent redirect and a full navigation — so a hardcoded href
//      is not a broken link, it is a WORKING link that silently reloads the app
//      and throws away the screen the reader was on. Nothing is more likely to
//      be re-added by hand, and nothing is quieter when it is.
//   4. ONE PLACE WRITES HISTORY. The open/switch/close policy is the modal's
//      alone. A `pushState` or a `router.push` naming settings anywhere else is
//      how "settings occupies one history entry" stops being true.
// ============================================================================

const SRC = path.join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)
      ? [full]
      : [];
  });
}

const FILES = walk(SRC);
const rel = (file: string) => path.relative(process.cwd(), file);
const read = (file: string) => readFileSync(file, "utf8");

/**
 * Comments quote the shapes these tests forbid, so they are stripped first.
 *
 * TRAILING comments too, not only whole-line ones. The whole-line version was
 * written first and a red check caught it: `return null; // permanentRedirect(…)`
 * disables the redirect and leaves the word behind on the same line, so the
 * `permanentRedirect` assertion below passed over a page that had stopped
 * redirecting. The `[^:]` is what keeps `https://` out of it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MODAL = path.join(SRC, "components", "settings", "settings-modal.tsx");
const LAYOUT = path.join(SRC, "app", "(dashboard)", "layout.tsx");
const SETTINGS_ROUTES = path.join(SRC, "app", "(dashboard)", "settings");

test("the settings modal is mounted once, by the dashboard layout", () => {
  const mounts = FILES.filter(
    (file) =>
      file !== MODAL && /<SettingsModal[\s/>]/.test(stripComments(read(file)))
  ).map(rel);

  assert.deepEqual(
    mounts,
    [rel(LAYOUT)],
    "exactly one file may render <SettingsModal>, and it is the dashboard layout — a second mount is a second dialog, a second focus trap and a second Close (#646)"
  );

  // …and it is mounted UNCONDITIONALLY. A mount behind a condition is a screen
  // where the avatar menu's Settings item writes a fragment nothing is
  // listening for.
  const layout = stripComments(read(LAYOUT));
  assert.match(
    layout,
    /<SettingsModal\s+visibleIds=/,
    "the layout must render the modal directly, not behind a wrapper that could gate it"
  );
});

test("nothing under app/(dashboard)/settings renders a section", () => {
  // The folder SURVIVES ON PURPOSE — it holds `actions.ts` and the colocated
  // dialogs and queries under `association/` and `team/`, and
  // `src/lib/auth/capability-map.ts` keys seventeen entries by those exact
  // paths. What may not come back is a PAGE that draws settings.
  const pages = walk(SETTINGS_ROUTES).filter((file) =>
    /[/\\]page\.tsx$/.test(file)
  );

  assert.deepEqual(
    pages.map(rel).toSorted(),
    [
      "src/app/(dashboard)/settings/[section]/page.tsx",
      "src/app/(dashboard)/settings/page.tsx",
    ],
    "the only settings pages left are the two redirects that catch mailed and bookmarked URLs"
  );

  for (const page of pages) {
    const source = stripComments(read(page));
    assert.match(
      source,
      /permanentRedirect\(/,
      `${rel(page)} must redirect — a settings page that renders is the routed mechanism coming back`
    );
    assert.doesNotMatch(
      source,
      /SettingsModal|SECTION_BODIES|sections\//,
      `${rel(page)} must draw nothing`
    );
  }
});

test("no in-app link spells a settings PATH", () => {
  // A hardcoded `/settings/team` still WORKS — it redirects — which is exactly
  // why this is a test and not a convention: the reader gets the right section
  // after a full page load that discards the screen they were on, and nothing
  // in the diff says so. Every in-app link goes through `settingsSectionHref`
  // (a bare fragment, for a link on a dashboard screen) or `settingsSectionUrl`
  // (path plus fragment, for mail and for the two redirects).
  const offenders: string[] = [];

  for (const file of FILES) {
    // The redirect pages and the registry are where the old paths legitimately
    // appear — one resolves them, the other builds their replacement.
    if (file.startsWith(SETTINGS_ROUTES)) continue;
    if (file === path.join(SRC, "lib", "settings", "sections.ts")) continue;

    const source = stripComments(read(file));
    for (const match of source.matchAll(
      /(?:href|redirect|push|replace)\s*[=(]\s*["'`](\/settings[^"'`]*)["'`]/g
    )) {
      offenders.push(`${rel(file)} → ${match[1]}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a settings PATH is a full navigation that throws away the screen behind the modal — use settingsSectionHref or settingsSectionUrl"
  );
});

test("the history policy has one author", () => {
  // OPEN pushes one entry, SWITCH replaces, CLOSE goes back or strips the
  // fragment in place. All three live in the modal, so however many sections a
  // reader opens, settings occupies that one entry and Close is one step. A
  // second file writing the settings fragment is how the exception #619 removed
  // comes back — see `memory/invariants.md` → Settings.
  const authors = FILES.filter((file) => {
    const source = stripComments(read(file));
    return (
      /history\.(pushState|replaceState|back)\(/.test(source) &&
      /settings/i.test(source)
    );
  }).map(rel);

  assert.deepEqual(
    authors,
    [rel(MODAL)],
    "only settings-modal.tsx may write the settings fragment or move history for it"
  );
});
