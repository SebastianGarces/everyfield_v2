import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.join(process.cwd(), "src");

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

const CONTEXT_FREE_ROUTES = [
  "app/(dashboard)/people/page.tsx",
  "app/(dashboard)/meetings/page.tsx",
  "app/(dashboard)/teams/page.tsx",
  "app/(dashboard)/notifications/page.tsx",
  "app/(dashboard)/verify-email/page.tsx",
  "app/(dashboard)/verify-email/confirmed/page.tsx",
] as const;

const ATTACHED_ROUTES = [
  "app/(dashboard)/people/new/page.tsx",
  "components/people/person-profile-shell.tsx",
  "components/people/assessment-entry-shell.tsx",
  "app/(dashboard)/meetings/new/page.tsx",
  "app/(dashboard)/meetings/[id]/layout.tsx",
  "app/(dashboard)/teams/health/page.tsx",
  "app/(dashboard)/teams/org-chart/page.tsx",
  "app/(dashboard)/teams/[teamId]/layout.tsx",
] as const;

test("directory and verification landing workspaces suppress redundant shell context", () => {
  for (const relativePath of CONTEXT_FREE_ROUTES) {
    const file = source(relativePath);

    assert.match(
      file,
      /<PageCanvas[\s\S]*?context="none"[\s\S]*?contentFocusTarget[\s\S]*?>/,
      `${relativePath} must keep the page-owned heading as its only visible context`
    );
    assert.match(
      file,
      /<HeaderBreadcrumbs(?:\s|>)/,
      `${relativePath} must still declare route state for nested consumers`
    );
  }
});

test("ruled directory detail and form workspaces opt into the attached seam", () => {
  for (const relativePath of ATTACHED_ROUTES) {
    const file = source(relativePath);

    assert.match(
      file,
      /<PageCanvas[\s\S]*?contextAttachment="attached"[\s\S]*?contextItems=\{/,
      `${relativePath} must attach server-known context to its workspace`
    );
    assert.match(
      file,
      /<WorkspacePanel(?:\s|>)/,
      `${relativePath} must give the attached context a workspace-panel seam`
    );
  }
});

test("dynamic directory labels cross the server render as direct context inputs", () => {
  const profile = source("components/people/person-profile-shell.tsx");
  const assessment = source("components/people/assessment-entry-shell.tsx");
  const meeting = source("app/(dashboard)/meetings/[id]/layout.tsx");
  const team = source("app/(dashboard)/teams/[teamId]/layout.tsx");

  assert.match(profile, /\{ label: personName \}/);
  assert.match(
    assessment,
    /\{ label: personName, href: `\/people\/\$\{personId\}` \}/
  );
  assert.match(assessment, /\{ label: title \}/);
  assert.match(assessment, /aria-label=\{`Back to \$\{backTab\}`\}/);
  assert.match(assessment, /<ArrowLeft aria-hidden="true"/);
  assert.match(meeting, /\{ label: meetingDisplayTitle\(meeting\) \}/);
  assert.match(team, /\{ label: team\.name \}/);

  for (const file of [profile, assessment, meeting, team]) {
    assert.doesNotMatch(
      file,
      /useEffect|useLayoutEffect/,
      "breadcrumb geometry must not wait for hydration"
    );
  }
});

test("hybrid composition preserves specialized scroll ownership", () => {
  const people = source("app/(dashboard)/people/page.tsx");
  const meetings = source("app/(dashboard)/meetings/page.tsx");
  const teams = source("app/(dashboard)/teams/page.tsx");
  const profile = source("components/people/person-profile-shell.tsx");

  assert.match(
    people,
    /isPipelineView\s*\? "min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-6"\s*:\s*"min-w-0 p-4 sm:p-6"/
  );
  assert.match(meetings, /className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"/);
  assert.match(teams, /className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"/);
  assert.doesNotMatch(profile, /overflow-auto|overflow-y-auto/);
});

test("the approved directory composition contains no prototype artifacts", () => {
  for (const relativePath of [...CONTEXT_FREE_ROUTES, ...ATTACHED_ROUTES]) {
    assert.doesNotMatch(
      source(relativePath),
      /PrototypeSwitcher|prototypeVariant|data-prototype/,
      `${relativePath} must contain only the ruled production composition`
    );
  }
});
