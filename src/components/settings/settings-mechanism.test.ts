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
// FIVE CLAIMS, EACH THE NEGATIVE OF A REAL WAY TO LOSE THIS:
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
//   5. NO INDIRECT SETTINGS HREF. A serialized artifact carries a section id,
//      never a prebuilt address, so a dynamic raw anchor cannot hide from the
//      direct-href scan. The UI validates the id and renders `SettingsLink`.
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
const STORE = path.join(SRC, "lib", "settings", "settings-hash.ts");
const LINK = path.join(SRC, "components", "settings", "settings-link.tsx");
const LAYOUT = path.join(SRC, "app", "(dashboard)", "layout.tsx");
const SETTINGS_ROUTES = path.join(SRC, "app", "(dashboard)", "settings");
const EVRY_BOUNDARY = path.join(
  SRC,
  "components",
  "evry",
  "boundary-message.tsx"
);
const EVRY_POLICY_ARTIFACTS = path.join(
  SRC,
  "lib",
  "evry",
  "policy",
  "artifacts.ts"
);

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
    [rel(STORE)],
    "only settings-hash.ts may write the settings fragment or move history for it"
  );

  // …and it is DRIVEN, not merely located. Every assertion in this file reads
  // source text, and three defects lived in that module's timing where no source
  // guard could see them.
  assert.ok(
    FILES.length &&
      readFileSync(
        path.join(SRC, "lib", "settings", "settings-hash.test.ts"),
        "utf8"
      ).includes("closes IN PLACE"),
    "the history policy must keep a behavioural test, not only a topological one"
  );
});

test("the section read is a route handler, never a server action", () => {
  // THE LOOP THIS FORBIDS WAS REAL, and only a browser found it. Every
  // server-ACTION response carries a fresh RSC render of the current route —
  // that is how `refresh()` delivers an update — which regenerates the
  // `serverRenderId` prop the modal re-reads on. Spelled as an action, this read
  // therefore asked for itself again on its own answer: one notification toggle
  // on the preview produced an unbounded loop at about seven requests a second,
  // for as long as the modal stayed open.
  //
  // A route handler answers with JSON and re-renders nothing, so the chain
  // terminates and a write costs exactly one extra read. Nothing about the two
  // spellings looks different in a diff, which is why this is a test.
  const data = read(path.join(SRC, "lib", "settings", "section-data.ts"));
  assert.doesNotMatch(
    data.split("\n").slice(0, 3).join("\n"),
    /^\s*["']use server["']/m,
    "section-data.ts must not be a `use server` module — its answer would re-render the route and re-trigger itself"
  );

  // …and the modal must REACH it over HTTP rather than by importing it, because
  // importing it back into a client component is how it becomes an action again.
  const store = stripComments(read(STORE));
  assert.doesNotMatch(
    store,
    /from "@\/lib\/settings\/section-data"/,
    "the client must fetch the read endpoint, not import the read"
  );
  assert.match(
    store,
    /fetch\(`\/api\/settings\/sections\//,
    "the section is read over the route handler"
  );

  // The endpoint exists, refuses a sessionless caller, and is not cached — one
  // reader's Team roster served to another is the one failure here that nothing
  // on screen would show.
  const route = read(
    path.join(
      SRC,
      "app",
      "api",
      "settings",
      "sections",
      "[section]",
      "route.ts"
    )
  );
  assert.match(route, /status: 401/);
  assert.match(route, /no-store/);
});

test("every in-app settings link goes through SettingsLink", () => {
  // A BARE `<a href="#settings/…">` OPENS THE MODAL AND THEN LOSES IT, which is
  // the worst kind of wrong: it works until the reader saves something. A native
  // fragment navigation is invisible to Next's client router, so the router's
  // copy of the URL still says `/dashboard` — and the first `refresh()` after
  // that (every settings write calls one) rewrites the address bar from that
  // copy and takes the fragment with it. Measured on the preview: toggle one
  // notification preference and the modal closed under the reader's hands.
  //
  // `SettingsLink` is the anchor and the cancelled click together, so no caller
  // can have one without the other.
  const offenders: string[] = [];
  for (const file of FILES) {
    if (file === MODAL || file === LINK) continue;
    const source = stripComments(read(file));
    if (/href=\{?\s*settingsSectionHref\(/.test(source))
      offenders.push(rel(file));
    if (/href="#settings\//.test(source)) offenders.push(rel(file));
  }

  assert.deepEqual(
    offenders,
    [],
    "a settings fragment in a raw href is invisible to the router — use <SettingsLink>"
  );

  // `settingsSectionUrl` — path AND fragment — is a different thing and stays
  // allowed in an href: it is a real navigation to another page, which the
  // router performs itself and therefore knows the fragment of.
  // …and `SettingsLink` FORWARDS what it is handed. Its first caller is
  // `<DropdownMenuItem asChild>`, and Radix composes by cloning the child with
  // the item's own props — `ref`, `role="menuitem"`, the roving-focus wiring,
  // the handler that closes the menu. A component taking three named props drops
  // all of it, and the menu quietly stops being a menu.
  const link = stripComments(read(LINK));
  assert.match(
    link,
    /ComponentPropsWithRef<"a">/,
    "SettingsLink must accept and forward every anchor prop, for `asChild`"
  );
  assert.match(link, /\{\.\.\.props\}/, "…and actually spread them");
});

test("Evry cannot smuggle a Settings href around SettingsLink", () => {
  // An earlier handoff put `/dashboard#settings/<id>` in a policy artifact and
  // rendered it through `<a href={artifact.destination.href}>`. The direct-href
  // scan above could not see across that data boundary, so it passed while Evry
  // had a second Settings-link mechanism. Hold both ends: the serialized policy
  // artifact carries an id but no href, and the UI resolves that id through the
  // one canonical component.
  const artifact = stripComments(read(EVRY_POLICY_ARTIFACTS));
  assert.match(artifact, /destination:[\s\S]*sectionId: string/);
  assert.doesNotMatch(
    artifact,
    /destination:[\s\S]*\bhref\s*:/,
    "a Settings artifact carries an id, never a prebuilt address"
  );

  const boundary = stripComments(read(EVRY_BOUNDARY));
  assert.match(boundary, /<SettingsLink\b/);
  assert.match(
    boundary,
    /resolveSettingsDestination\(artifact\.destination\.sectionId\)/,
    "Evry uses the canonical live/retired/unknown resolver"
  );
  assert.doesNotMatch(
    boundary,
    /<a\b/,
    "Evry delegates the address and router-aware click to SettingsLink"
  );
});
