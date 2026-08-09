import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  isLastOnboardingStep,
  isSkippableOnboardingStep,
  onboardingStep,
} from "@/lib/onboarding/steps";

// ============================================================================
// F12 / OB-006 — the bring-your-people step.
//
// The requirement is unusual in that its whole content is a NEGATIVE: the step
// must surface the CSV wizard and quick-add "without duplicating them", and an
// import started from onboarding must behave identically to one started from
// /people. Neither is observable by rendering the step — a forked copy of the
// wizard would look and behave the same right up until the day the two copies
// disagree about duplicates, activities or events.
//
// So the guarantee is pinned where it actually lives: in the import graph. The
// step imports the SAME two components /people renders, and imports no part of
// the import machinery itself. Assertions are source-shaped (the repo's
// established form for pinning a call site — see invitations-ui.test.ts)
// because the thing being pinned IS a piece of source.
//
// A second reason the negative matters: this is a client component, and
// `@/lib/people/import` pulls in the Neon database client at module scope. An
// innocent-looking `import { generateCsvTemplate }` here would drag the DB
// client into the browser bundle.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * Comments are prose, not code. The forbidden-symbol scan below runs on the
 * stripped source so the file stays free to EXPLAIN why it does not import the
 * import machinery — naming the module it must not reach for is exactly how
 * that explanation is written.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const PEOPLE_STEP = read("components", "onboarding", "people-step.tsx");
const PEOPLE_PAGE = read("app", "(dashboard)", "people", "page.tsx");
// The interactive half of the flow — `onboarding-flow.tsx` is the server
// component that resolves OB-015's facts and renders this one.
const ONBOARDING_FLOW = read(
  "components",
  "onboarding",
  "onboarding-flow-client.tsx"
);

const IMPORT_WIZARD_MODULE = "@/components/people/import-wizard";
const QUICK_ADD_MODULE = "@/components/people/quick-add-form";

// ----------------------------------------------------------------------------
// 1. It surfaces the EXISTING wizard and quick-add.
// ----------------------------------------------------------------------------

test("the step imports the existing CSV import wizard and quick-add", () => {
  assert.match(
    PEOPLE_STEP,
    new RegExp(`import \\{ ImportWizard \\} from "${IMPORT_WIZARD_MODULE}"`),
    "the step must call the existing ImportWizard, not carry its own"
  );
  assert.match(
    PEOPLE_STEP,
    new RegExp(`import \\{ QuickAddForm \\} from "${QUICK_ADD_MODULE}"`),
    "the step must call the existing QuickAddForm, not carry its own"
  );

  // Rendered, not merely imported — an unused import would satisfy the above.
  assert.match(PEOPLE_STEP, /<ImportWizard>/);
  assert.match(PEOPLE_STEP, /<QuickAddForm>/);
});

test("onboarding and /people reach the wizard through the same modules", () => {
  // The other half of "behaves identically": /people must still be rendering
  // the very components onboarding imports. If either surface forks to a copy,
  // this fails on the surface that forked.
  for (const symbol of ["ImportWizard", "QuickAddForm"]) {
    assert.match(
      PEOPLE_PAGE,
      new RegExp(`<${symbol}\\s*/?>`),
      `/people must still render ${symbol}`
    );
  }
  assert.match(PEOPLE_PAGE, /from "@\/components\/people"/);
});

// ----------------------------------------------------------------------------
// 2. No duplicated implementation — and no server-only module in the bundle.
// ----------------------------------------------------------------------------

test("the step owns no import machinery of its own", () => {
  // The parsing/duplicate/insert layer, and the server actions that wrap it.
  // Reaching for any of these means a second import path exists, which is the
  // exact failure "no duplicated implementations" is written against.
  const forbidden = [
    "@/lib/people/import",
    "previewImportAction",
    "executeBulkImportAction",
    "downloadCsvTemplateAction",
    "quickAddPersonAction",
    "checkForDuplicatesAction",
    "parseCsvImport",
    "executeBulkImport",
    "generateCsvTemplate",
  ];

  const code = stripComments(PEOPLE_STEP);

  for (const symbol of forbidden) {
    assert.equal(
      code.includes(symbol),
      false,
      `people-step.tsx must not reference ${symbol} — the wizard owns it`
    );
  }

  // No hand-rolled CSV surface either: no file input, no CSV parsing.
  assert.equal(
    /type="file"/.test(code),
    false,
    "the file input belongs to the wizard"
  );
});

// ----------------------------------------------------------------------------
// 3. The step is wired into the flow, and is skippable.
// ----------------------------------------------------------------------------

test("the flow renders the people step rather than the shell", () => {
  assert.match(
    ONBOARDING_FLOW,
    /import \{ PeopleStep \} from "\.\/people-step"/
  );
  assert.match(ONBOARDING_FLOW, /<PeopleStep/);

  // The shell is GONE, not merely bypassed. It carried a placeholder
  // description of every not-yet-built step, and two descriptions of the same
  // step is how they drift; with step 3 built (#306) there is no step left for
  // it to describe, so the file that once held the second description no longer
  // exists.
  assert.equal(
    existsSync(
      path.join(ROOT, "components", "onboarding", "upcoming-step.tsx")
    ),
    false,
    "upcoming-step.tsx is dead once every onboarding step is real"
  );
});

test("the people step is skippable and is the flow's last step", () => {
  // OB-007. Asserted through the step model rather than the component so the
  // rule is read from where it is declared; the component's controls are
  // derived from these two facts.
  assert.equal(isSkippableOnboardingStep("people"), true);
  assert.equal(isLastOnboardingStep("people"), true);

  // Being last is why the step offers "Go to my dashboard" instead of a
  // separate skip button — on the last step, skipping and finishing are the
  // same move.
  assert.match(PEOPLE_STEP, /Go to my dashboard/);
  assert.match(PEOPLE_STEP, /Nothing here is required/);
});

// ----------------------------------------------------------------------------
// 4. Copy explains what the import unlocks.
// ----------------------------------------------------------------------------

test("the step says what bringing people in turns on", () => {
  // The step's own title/description come from the step model; the body has to
  // add the reason, or the planter is being asked for work with no argument.
  const step = onboardingStep("people");
  assert.equal(step.title, "Bring your people");

  for (const consequence of ["pipeline", "meetings", "core group"]) {
    assert.match(
      PEOPLE_STEP.toLowerCase(),
      new RegExp(consequence),
      `the copy should name what "${consequence}" gains from having people`
    );
  }

  // Duplicate detection is one of the three things OB-006 names as already
  // built; the copy promises it because the wizard delivers it.
  assert.match(PEOPLE_STEP, /duplicates/i);
  assert.match(PEOPLE_STEP, /template/i);
});

// ----------------------------------------------------------------------------
// 5. Every clickable carries cursor-pointer (repo rule, FRD AC 7).
// ----------------------------------------------------------------------------

test("every button the step renders is marked cursor-pointer", () => {
  const buttons = PEOPLE_STEP.match(/<Button\b[\s\S]*?>/g) ?? [];
  assert.ok(buttons.length > 0, "expected the step to render buttons");

  for (const button of buttons) {
    assert.match(
      button,
      /cursor-pointer/,
      `a <Button> in people-step.tsx is missing cursor-pointer: ${button}`
    );
  }
});
