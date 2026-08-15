import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getTemplateById } from "@/lib/documents";
import { resolveMergeValues } from "@/lib/documents/merge";
import {
  JOURNEY_STAGE_OPTIONS,
  isSkippableOnboardingStep,
  onboardingStep,
} from "@/lib/onboarding/steps";
import {
  assembleFactSnapshot,
  type SnapshotInputs,
} from "@/lib/phase-engine/signals/build-fact-snapshot";

// ============================================================================
// F12 / OB-003 + OB-005 — step 3, the journey declaration.
//
// The two hardest guarantees here are both NEGATIVES, and neither is observable
// by rendering the step:
//
//   * the launch date is written through the launch ENTITY's service write path
//     and never to a column on `churches`. `churches.launch_date` was dropped
//     by migration 0032 (LS-001), so a second write path would not merely
//     duplicate the journal, the oversight announcement and the Playbook
//     milestone seed — it would not compile against a column that exists.
//     Going through `scheduleLaunchAction` is what makes "setting the date from
//     onboarding lands on the same rail as any other date set" structural.
//
//   * "no date yet" writes NOTHING. A `planning` placeholder row would be
//     indistinguishable, to every reader downstream, from a plant that has
//     started planning a launch — and the countdown has to read empty, not
//     zero.
//
// Both live in the import graph and in one branch of one action, so they are
// pinned against the source — the repo's established form for a call site
// (`people-step.test.ts`, `onboarding-flow.test.ts`).
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/**
 * Comments are prose, not code. The forbidden-symbol scans below run on the
 * stripped source so these files stay free to EXPLAIN which write paths they
 * deliberately do not touch — naming a dropped column is how that explanation
 * gets written.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const STEP = read("components", "onboarding", "journey-step.tsx");
const STEP_CODE = stripComments(STEP);
// The interactive half of the flow — `onboarding-flow.tsx` is the server
// component that resolves OB-015's facts and renders this one.
const FLOW_CODE = stripComments(
  read("components", "onboarding", "onboarding-flow-client.tsx")
);
const ACTIONS_CODE = stripComments(
  read("app", "(dashboard)", "dashboard", "actions.ts")
);
// Step 3's write path itself — extracted out of the `"use server"` module so
// the ruled branches are drivable by `declare-journey.test.ts`; the source
// pins below follow it there. The action stays a thin mint.
const DECLARE_CODE = stripComments(
  read("lib", "onboarding", "declare-journey.ts")
);

// ----------------------------------------------------------------------------
// 1. The launch date goes through the entity, never a column on `churches`
// ----------------------------------------------------------------------------

test("the date is written through the launch entity's service rail", () => {
  // The composition root is the ACTION (ruling on 408's item 5): only the app
  // layer may bind a route-group `"use server"` action, so the import and the
  // binding are pinned against `dashboard/actions.ts`, not the lib module —
  // which stays free of `@/app` imports so its test runs without a request.
  assert.match(
    ACTIONS_CODE,
    /import \{ scheduleLaunchAction \} from "@\/app\/\(dashboard\)\/launch\/actions"/
  );
  // The runner writes through its dep; the action binds that dep to the rail
  // and nothing else.
  assert.match(DECLARE_CODE, /await deps\.scheduleLaunch\(\{/);
  assert.match(ACTIONS_CODE, /scheduleLaunch: scheduleLaunchAction,/);
});

test("no onboarding surface writes a launch date to the church row", () => {
  // `churches.launch_date` does not exist (migration 0032). Naming it — or
  // reaching for the service that used to own it — is the regression this
  // guards, and it is worth guarding because the column shape is what every
  // pre-0032 example in the repo's history shows.
  for (const source of [STEP_CODE, ACTIONS_CODE, DECLARE_CODE]) {
    assert.equal(/launch_date/.test(source), false);
    assert.equal(/churches\/launch-date/.test(source), false);

    // The write path may not hand-roll the write either: the guards (the row
    // lock, the compare-and-set, the `launch_events` journal) live in
    // `src/lib/launch/service.ts`, and a module with its own statement would
    // be a second write path with none of them.
    assert.equal(/setLaunchDateStatement/.test(source), false);
    assert.equal(/update\(launches\)/.test(source), false);
  }
});

// ----------------------------------------------------------------------------
// 2. "No date yet" stores nothing
// ----------------------------------------------------------------------------

test("'no date yet' reaches no launch write at all", () => {
  // The schedule call is inside the branch that has a date. Hoisted out — or
  // called with a null/empty target "so the row exists" — a planter who said
  // they have no date would get a launch row anyway, and the countdown would
  // have something to render.
  const branch = DECLARE_CODE.slice(
    DECLARE_CODE.indexOf("if (rawDate)"),
    DECLARE_CODE.indexOf("try {")
  );
  assert.match(branch, /await deps\.scheduleLaunch\(/);
  assert.equal(
    (DECLARE_CODE.match(/deps\.scheduleLaunch\(/g) ?? []).length,
    1,
    "exactly one call site, and it is the one inside the has-a-date branch"
  );

  // No placeholder row by any other route either.
  assert.equal(/planning/.test(DECLARE_CODE), false);
  assert.equal(/insert\(launches\)/.test(DECLARE_CODE), false);
});

// ----------------------------------------------------------------------------
// 3. The stage declaration is a declaration, not a transition
// ----------------------------------------------------------------------------

test("the stage goes through declareInitialPhase, not transitionPhase", () => {
  // The concrete binding lives in the action's composition root, alongside the
  // other deps (ruling on 408's item 5); the runner only knows its dep.
  assert.match(
    ACTIONS_CODE,
    /import \{ declareInitialPhase \} from "@\/lib\/phase-engine\/transitions"/
  );
  assert.match(ACTIONS_CODE, /declareInitialPhase,/);
  assert.match(DECLARE_CODE, /await deps\.declareInitialPhase\(/);
  for (const source of [ACTIONS_CODE, DECLARE_CODE]) {
    assert.equal(
      /transitionPhase\(/.test(source),
      false,
      "a transition would claim the planter moved phases inside EveryField"
    );
  }
});

test("the date is written BEFORE the declaration captures its snapshot", () => {
  // The declaration's fact snapshot includes the launch countdown. Declared
  // first, the plant's own audit row would record it as having no launch date
  // moments before it acquired one.
  const scheduleAt = DECLARE_CODE.indexOf("deps.scheduleLaunch(");
  const declareAt = DECLARE_CODE.indexOf("deps.declareInitialPhase(");
  assert.ok(scheduleAt > -1 && declareAt > scheduleAt);
});

test("the stage value becomes a phase through the one parser", () => {
  assert.match(DECLARE_CODE, /phaseForJourneyStage\(input\.stage\)/);
  assert.match(
    DECLARE_CODE,
    /if \(phase === null\)/,
    "an unrecognised stage is refused, not defaulted"
  );
});

// ----------------------------------------------------------------------------
// 4. The step is wired into the flow, commits independently, and is skippable
// ----------------------------------------------------------------------------

test("the flow renders the journey step rather than a shell", () => {
  assert.match(FLOW_CODE, /import \{ JourneyStep \} from "\.\/journey-step"/);
  assert.match(FLOW_CODE, /<JourneyStep/);

  // The flow still owns no step's write (OB-007): step 3's action belongs to
  // step 3, exactly as step 1's and step 2's belong to theirs.
  assert.equal(/declareJourney/.test(FLOW_CODE), false);
});

test("the flow advances only once the declaration has committed", () => {
  // `handleDeclared` is `goForward` plus one thing: it remembers the phase the
  // server reported, which is what OB-015's offer is gated on. The forward move
  // itself is unchanged, and is still the flow's.
  assert.match(FLOW_CODE, /onDeclared=\{handleDeclared\}/);
  assert.match(FLOW_CODE, /function handleDeclared\(phase: number\) \{/);
  assert.match(
    FLOW_CODE,
    /function handleDeclared\(phase: number\) \{\s*setDeclaredThisVisit\(phase\);\s*goForward\(\);/
  );

  // The step reports the phase the server now HOLDS, not the value submitted —
  // on a re-declaration those differ, and the offer that follows must match the
  // dashboard the planter is about to see.
  assert.match(STEP_CODE, /onDeclared\(result\.phase\)/);

  // …and the advance is inside the success arm, after the error arm returns.
  const errorAt = STEP_CODE.indexOf('result.status === "error"');
  const advanceAt = STEP_CODE.indexOf("onDeclared(result.phase)");
  assert.ok(errorAt > -1 && advanceAt > errorAt);
});

test("step 3 is skippable, and skipping writes nothing", () => {
  assert.equal(isSkippableOnboardingStep("journey"), true);
  assert.equal(onboardingStep("journey").number, 3);

  // Skip is the flow's plain forward move — a skip with its own handler could
  // grow a save, and the whole point of the control is that nothing commits.
  assert.match(FLOW_CODE, /onSkip=\{goForward\}/);
});

test("the step holds no server data in state", () => {
  // memory/contracts/data-patterns.md. Every `useState` here is the planter's
  // own in-progress input or the outcome the action just reported back; server
  // data never round-trips through state, and nothing is SYNCED.
  assert.equal(/router\.refresh/.test(STEP_CODE), false);

  // The contract is "no effect syncs data", not "no effect exists" — the flow
  // itself focuses its heading in one (`onboarding-flow-client.tsx`). So the
  // effects are counted and read: there is exactly one, and its whole body
  // moves focus onto the refusal panel. An effect that fetched, or that pushed
  // a prop into state, would fail both assertions.
  const effects = STEP_CODE.match(/useEffect\(/g) ?? [];
  assert.equal(effects.length, 1);
  assert.match(
    STEP_CODE,
    /useEffect\(\(\) => \{\n\s*if \(recorded\) recordedRef\.current\?\.focus\(\);\n\s*\}, \[recorded\]\);/
  );
});

// ----------------------------------------------------------------------------
// 4b. The step behaves like every other step in the flow (better-interface G3)
// ----------------------------------------------------------------------------

test("the step is a real form, so Enter in the date field submits", () => {
  // Every other step is a `<form>` (`church-basics-step.tsx`,
  // `leadership-step.tsx`). As a bare `<div>` with a click handler, typing a
  // date and pressing Enter did nothing here and worked everywhere else.
  assert.match(STEP_CODE, /<form/);
  assert.match(STEP_CODE, /event\.preventDefault\(\)/);
  assert.match(STEP_CODE, /type="submit"/);
});

test("a validation message is attached to the question that failed", () => {
  // This is the tallest step in the flow — nine options across two fieldsets —
  // so one message pinned to the top is, on a phone, a message the planter
  // cannot see from the button that produced it. Each error renders under its
  // own fieldset and is named by that group's `aria-describedby`, so it is
  // readable again when focus returns rather than only announced once.
  assert.match(STEP_CODE, /aria-describedby=\{dateError \? dateErrorId/);
  assert.match(STEP_CODE, /aria-describedby=\{stageError \? stageErrorId/);
  assert.match(STEP_CODE, /aria-invalid=\{dateError \? true : undefined\}/);
  assert.match(STEP_CODE, /aria-invalid=\{stageError \? true : undefined\}/);
  assert.match(STEP_CODE, /role="alert"/);

  // Field errors are field-scoped, never a single shared string again. Every
  // one goes through `refuse()`, which renders the message AND moves focus to
  // the question it belongs to (see section 10).
  assert.match(STEP_CODE, /refuse\("date",/);
  assert.match(STEP_CODE, /refuse\("stage",/);
  // A failed SAVE is not a field error — it sits by the button that tried.
  assert.match(STEP_CODE, /refuse\(\s*"form",/);
});

test("every stage and launch-date radio has an accessible name", () => {
  // #397. shadcn's `RadioGroupItem` renders `<button type="button"
  // role="radio">`, and `<label for>` names FORM CONTROLS — it moves a click to
  // the button and contributes nothing to the accessible name of an element
  // whose role is `radio`. So all ten radios on this step were unnamed: axe
  // reported one `button-name` violation over ten nodes, and a screen reader
  // read "radio button, not checked" ten times with nothing to tell them apart
  // — on the step the alpha demo path walks through.
  //
  // `aria-labelledby` pointing at the label is the fix, and the `htmlFor` stays
  // because it is what makes the words clickable. Both halves are asserted:
  // dropping either one is a regression with no other symptom in this suite.
  assert.match(STEP_CODE, /aria-labelledby=\{labelId\}/);
  assert.match(STEP_CODE, /<Label\s+id=\{labelId\}\s+htmlFor=\{id\}/);
  assert.match(STEP_CODE, /const labelId = `\$\{id\}-label`;/);

  // The hint (and the phase name beside it) are the DESCRIPTION, announced
  // after the name rather than folded into it.
  assert.match(
    STEP_CODE,
    /aria-describedby=\{tag \? `\$\{hintId\} \$\{tagId\}` : hintId\}/
  );
  assert.match(STEP_CODE, /<p id=\{hintId\}/);

  // ONE component draws all ten options, which is why one fix reaches all ten:
  // the two launch-date choices and the eight stages (seven phases plus the
  // "not sure" escape hatch) are the same `ChoiceOption`.
  assert.equal((STEP_CODE.match(/<ChoiceOption/g) ?? []).length, 3);
  assert.equal(JOURNEY_STAGE_OPTIONS.length, 8);
  assert.equal((STEP_CODE.match(/<RadioGroupItem/g) ?? []).length, 1);
});

test("revealing the date input moves the caret into it", () => {
  // Choosing "We have a date in mind" mounts a field below the radio. Leaving
  // focus on the radio makes a keyboard planter Tab back through the group to
  // reach what their own click just produced.
  assert.match(STEP_CODE, /focusDateOnMount/);
  assert.match(STEP_CODE, /node\.focus\(\)/);
});

// ----------------------------------------------------------------------------
// 5. "Did they answer step 3?" is asked of phase history
// ----------------------------------------------------------------------------

test("the step-3 fact comes from the declaration record, not the columns", () => {
  // Inferring it from `current_phase > 0 || a launch date` cannot see the
  // honest answer: "not sure — start me at the beginning" plus "no date yet"
  // leaves phase 0 and no launch row, so the planter who answered and the
  // planter who never saw the step look identical, and the OB-011 nudge would
  // keep asking forever.
  const page = stripComments(
    read("app", "(dashboard)", "dashboard", "plant-dashboard.tsx")
  );

  assert.match(page, /hasInitialPhaseDeclaration\(churchId\)/);
  assert.match(page, /journeyDeclared,/);
  assert.equal(
    /journeyDeclared: !!launch\?\.targetDate/.test(page),
    false,
    "the column-shaped inference is gone, not merely supplemented"
  );
});

// ----------------------------------------------------------------------------
// 6. The document merge fields read the real value
// ----------------------------------------------------------------------------

test("both document call sites source the launch date from the entity", () => {
  // Both surfaces resolve their MergeContext through ONE resolver,
  // `resolveDocumentMergeContext` (`src/lib/documents/merge-context.ts`), and
  // THAT resolver reads the launch entity. One function is what keeps the
  // dialog's preview and the generated file agreeing about the day (#306) —
  // stronger than the two-copies-that-must-agree shape this test used to pin.
  const page = read("app", "(dashboard)", "documents", "page.tsx");
  const route = read("app", "api", "documents", "[templateId]", "route.ts");
  const resolver = read("lib", "documents", "merge-context.ts");

  for (const [name, source] of [
    ["documents/page.tsx", page],
    ["api/documents/[templateId]/route.ts", route],
  ] as const) {
    assert.match(
      source,
      /import \{ resolveDocumentMergeContext \} from "@\/lib\/documents\/merge-context"/,
      `${name} must resolve its merge context through the shared resolver`
    );
  }

  assert.match(
    resolver,
    /import \{ getLaunchForChurch \} from "@\/lib\/launch\/queries"/,
    "the resolver must read the launch entity"
  );
  assert.match(
    resolver,
    /launchDate: launch\?\.targetDate \?\? null/,
    "the resolver must pass the stored date, not a stub"
  );
  // The stale "null because sourcing is #203's job" stubs are gone — a
  // hardcoded null that outlives its reason reads as a decision.
  for (const [name, source] of [
    ["documents/page.tsx", page],
    ["api/documents/[templateId]/route.ts", route],
    ["lib/documents/merge-context.ts", resolver],
  ] as const) {
    assert.equal(
      /launchDate: null/.test(stripComments(source)),
      false,
      `${name} must no longer hardcode a null launch date`
    );
  }
});

test("a declared date reaches {{launch_date}}, and 'no date yet' leaves it empty", () => {
  // The scan above proves both call sites READ the entity; this proves what a
  // planter then sees in the file, which is the AC's own wording ("a populated
  // {{launch_date}} merge field"). Both step-3 answers are asserted because the
  // claim is that they DIFFER — a resolver returning "" for everything would
  // pass a one-sided test, and "" is exactly what the stub used to produce.
  const template = getTemplateById("launch-sunday-checklists");
  assert.ok(
    template,
    "the one template whose merge fields name the launch day"
  );

  const withDate = resolveMergeValues(
    template,
    {
      churchName: "Grace City Church",
      userName: "Sebastian",
      // What `getLaunchForChurch(...)?.targetDate` hands the call sites after
      // step 3 wrote it: the stored `yyyy-mm-dd` wall clock, never a `Date`.
      launchDate: "2026-09-20",
    },
    {}
  );

  // Formatted in APP_TIME_ZONE, so the day does not drift by runtime zone
  // (memory/invariants.md → Date & Time Rendering).
  assert.equal(withDate.launch_date, "September 20, 2026");

  const withoutDate = resolveMergeValues(
    template,
    {
      churchName: "Grace City Church",
      userName: "Sebastian",
      // "No date yet" writes no launch row, so the call sites resolve null.
      launchDate: null,
    },
    {}
  );

  assert.equal(withoutDate.launch_date, "");
  // An empty day must not cost the planter the fields that ARE known.
  assert.equal(withoutDate.church_name, "Grace City Church");
});

// ----------------------------------------------------------------------------
// 7. What each answer does to the COUNTDOWN SIGNAL
//
// The tests above pin what the action writes; these pin what the phase engine
// then reads, which is the half of the AC a call-site scan cannot reach. Both
// step-3 answers are asserted here rather than only the empty one, because the
// interesting claim is that they DIFFER — "no date yet" has to be empty while a
// named day is a live countdown, and a builder that returned `isEmpty: true`
// for both would pass a one-sided test.
//
// `assembleFactSnapshot` is the pure, DB-free assembly the snapshot is built
// from, so the two onboarding outcomes are expressible as inputs: "no date yet"
// writes no launch row at all (`launch: null`), and a named day is the row
// `setLaunchDate` leaves behind.
// ----------------------------------------------------------------------------

const SNAPSHOT_CHURCH_ID = "11111111-1111-4111-8111-111111111111";
/** Fixed reference instant — the countdown is day-vs-day, never "now". */
const SNAPSHOT_AS_OF = new Date("2026-08-08T13:45:00.000Z");

/**
 * A freshly onboarded plant: nothing but a church row and whatever step 3
 * wrote. Every other signal is empty on purpose — this is the state the
 * declaration's own fact snapshot is captured in.
 */
function onboardedInputs(launch: SnapshotInputs["launch"]): SnapshotInputs {
  return {
    church: { id: SNAPSHOT_CHURCH_ID, currentPhase: 3 },
    launch,
    launchMilestones: [],
    commitments: [],
    visionMeetings: [],
    followUp: [],
    ministryTeams: [],
    leadershipCandidates: [],
    meetingsAttendedByPerson: [],
    activeMembershipsByPerson: [],
    teamLeaderPersonIds: [],
    trainingPrograms: [],
    trainingCompletions: [],
    plantSignals: [],
  };
}

test("the visible countdown lives on /launch, and NOT on /phase", () => {
  // Ruling 2 (2026-08-09): AC2 originally asked for the browser assertion on
  // `/phase`, which has no countdown UI and is not getting one — that surface
  // belongs to #319. `/launch` (#305) is where the date this step writes
  // becomes visible, through the ONE countdown implementation
  // (`daysUntilTarget`; memory/invariants.md → the day-vs-instant rule). This
  // pins both halves so neither a second copy of the maths nor a countdown
  // smuggled onto `/phase` can land unnoticed.
  const launchPage = read("app", "(dashboard)", "launch", "page.tsx");
  assert.match(
    stripComments(launchPage),
    /import \{ daysUntilTarget \} from "@\/lib\/launch\/countdown"/
  );
  assert.match(
    stripComments(launchPage),
    /daysUntilTarget\(launch\?\.targetDate/
  );

  const phasePage = stripComments(
    read("app", "(dashboard)", "phase", "page.tsx")
  );
  assert.equal(
    /daysUntilTarget|countdown/i.test(phasePage),
    false,
    "no countdown UI on /phase — #319 owns that surface"
  );
});

test("'no date yet' leaves the countdown EMPTY, not zero", () => {
  // The AC's snapshot assertion. Zero is a countdown that has run out — it is
  // what "launch is today" looks like — so a plant that never named a day must
  // not produce it. `isEmpty` is the flag every downstream reader branches on.
  const snap = assembleFactSnapshot(
    SNAPSHOT_CHURCH_ID,
    onboardedInputs(null),
    SNAPSHOT_AS_OF
  );

  assert.equal(snap.launch.isEmpty, true);
  assert.equal(snap.launch.launchDate, null);
  assert.equal(snap.launch.daysUntilLaunch, null);
  assert.notEqual(snap.launch.daysUntilLaunch, 0);
  // Nor is a plant with no launch overdue for one.
  assert.equal(snap.launch.isPastDue, false);
  assert.equal(snap.launch.status, null);
});

test("a declared date feeds the countdown signal immediately", () => {
  // The other half of the same AC: what `setLaunchDate` leaves behind is what
  // the engine reads, with no further step. 43 days from the reference instant.
  const snap = assembleFactSnapshot(
    SNAPSHOT_CHURCH_ID,
    onboardedInputs({
      targetDate: "2026-09-20",
      status: "scheduled",
      outcomeRecordedAt: null,
      attendanceCount: null,
      decisionsCount: null,
    }),
    SNAPSHOT_AS_OF
  );

  assert.equal(snap.launch.isEmpty, false);
  assert.equal(snap.launch.launchDate, "2026-09-20");
  assert.equal(snap.launch.daysUntilLaunch, 43);
  assert.equal(snap.launch.isPastDue, false);
});

test("the declared phase is the snapshot's phase, with no ladder behind it", () => {
  // The declaration sets `churches.current_phase` and the snapshot copies it
  // straight off that row — so a plant that declared 3 is scored as a phase-3
  // plant from its first assessment, without three transitions having been
  // invented to get it there (FRD AC 1 + AC 3).
  const snap = assembleFactSnapshot(
    SNAPSHOT_CHURCH_ID,
    onboardedInputs(null),
    SNAPSHOT_AS_OF
  );

  assert.equal(snap.currentPhase, 3);
});

// ----------------------------------------------------------------------------
// 8. A second declaration is REFUSED, and the refusal is said out loud
//
// Ruled 2026-08-09: re-declaration is refused, never overwritten and never
// half-applied. `phase_transitions_initial_declaration_unique_idx` already
// refused the write; what was missing was the sentence. The action collapsed
// both outcomes to `status: "declared"`, so the second submit wrote the launch
// date, discarded the stage, and advanced the flow reporting success — reachable
// with no race at all by pressing Back from step 4.
// ----------------------------------------------------------------------------

test("the action reports a refused declaration as a refusal", () => {
  // The two outcomes of `declareInitialPhase` reach the client as two states.
  assert.match(DECLARE_CODE, /status: "already_declared"; phase: number/);
  assert.match(
    DECLARE_CODE,
    /declared\.status === "already_declared"\s*\?\s*"already_declared"\s*:\s*"declared"/
  );

  // And the phase reported is the STORED one in both arms — `declared.phase`,
  // which `declareInitialPhase` reads off the locked church row — never the
  // number this request submitted.
  assert.match(DECLARE_CODE, /phase: declared\.phase/);
  assert.equal(/phase: phase,/.test(DECLARE_CODE), false);
});

test("the refusal names the stage, where to change it, and that the date saved", () => {
  // All three facts are owed. Without the third, "already recorded" reads as
  // "nothing went through", and the planter re-enters a date the launch page
  // will refuse to move.
  assert.match(STEP_CODE, /result\.status === "already_declared"/);
  assert.match(
    STEP_CODE,
    /setRecorded\(\{ phase: result\.phase, targetDate: result\.targetDate \}\)/
  );
  assert.match(STEP_CODE, /journeyStageForPhase\(recorded\.phase\)/);
  assert.match(STEP_CODE, /Your starting stage is already recorded/);
  assert.match(STEP_CODE, /from the phase page/);
  assert.match(STEP_CODE, /Your launch date was saved/);

  // The date is formatted through the zone-pinned helpers, never `toLocale*`
  // (memory/invariants.md → Date & Time Rendering).
  assert.match(
    STEP_CODE,
    /formatDate\(parseTargetDate\(recorded\.targetDate\)\)/
  );
  assert.equal(/toLocaleDateString/.test(STEP_CODE), false);
});

test("a refused declaration does not advance the flow by itself", () => {
  // `onDeclared` is what moves the planter on and what the OB-015 team offer is
  // gated on. On a refusal it is reachable only from the Continue button the
  // planter presses AFTER reading the panel — never from the submit handler.
  const submitBranch = STEP_CODE.slice(
    STEP_CODE.indexOf('if (result.status === "already_declared")'),
    STEP_CODE.indexOf("onDeclared(result.phase);")
  );
  assert.equal(/onDeclared\(/.test(submitBranch), false);

  // And when it is pressed it carries the STORED phase.
  assert.match(STEP_CODE, /onClick=\{\(\) => onDeclared\(recorded\.phase\)\}/);
});

// ----------------------------------------------------------------------------
// 9. "No date yet" on RE-ENTRY is an answer, not silence
//
// On a first pass the branch writes nothing and the countdown stays empty,
// which is the AC. On a re-entry by a planter who already set a date, writing
// nothing left `launches.target_date` counting while the radio hint promised
// the opposite. Silence is the one option that hint rules out.
// ----------------------------------------------------------------------------

test("'no date yet' over an existing date is refused, and refused before any write", () => {
  const branch = DECLARE_CODE.slice(
    DECLARE_CODE.indexOf("} else {"),
    DECLARE_CODE.indexOf("const declared = await deps.declareInitialPhase")
  );

  // It READS the stored launch through the launch module's own query (bound as
  // `readLaunch` by the action's composition root), and returns a refusal
  // attached to the date question.
  assert.match(branch, /await deps\.readLaunch\(actor\.churchId\)/);
  assert.match(ACTIONS_CODE, /readLaunch: getLaunchForChurch,/);
  assert.match(branch, /if \(launch\?\.targetDate\)/);
  assert.match(branch, /status: "error"/);
  assert.match(branch, /field: "date"/);
  assert.match(branch, /Your launch date is already set to/);

  // The refusal returns BEFORE the declaration, so nothing is half-applied: no
  // date write, no stage write.
  assert.match(branch, /formatDate\(parseTargetDate\(launch\.targetDate\)\)/);

  // And it does not quietly clear the date either — clearing is a launch write
  // path that does not exist, and inventing one here would be a second rail.
  assert.equal(/delete\(launches\)/.test(DECLARE_CODE), false);
  assert.equal(/targetDate: null/.test(branch), false);
});

test("the refusal is rendered under the date question that produced it", () => {
  // The action names the field; the step trusts that name and falls back to the
  // save-level slot only when there is none.
  assert.match(DECLARE_CODE, /field\?: DeclareJourneyErrorField/);
  assert.match(STEP_CODE, /refuse\(result\.field \?\? "form", result\.error\)/);
});

// ----------------------------------------------------------------------------
// 10. better-interface G3 — a refusal is reached, not merely rendered
// ----------------------------------------------------------------------------

test("a refusal moves focus to the question that failed", () => {
  // Rendering the message under its own fieldset is half the fix. This is the
  // tallest step in the flow and its submit sits below both questions, so a
  // message attached to the first fieldset is off the top of a phone screen —
  // and a submit that appears to do nothing. Every refusal goes through
  // `refuse()`, which renders AND goes there.
  assert.match(
    STEP_CODE,
    /function refuse\(field: JourneyErrorField, message: string\)/
  );
  assert.match(
    STEP_CODE,
    /if \(field === "date"\) dateFieldsetRef\.current\?\.focus\(\)/
  );
  assert.match(
    STEP_CODE,
    /if \(field === "stage"\) stageFieldsetRef\.current\?\.focus\(\)/
  );

  // `tabIndex={-1}` on both fieldsets: focusable programmatically, never a stop
  // in the tab order (the device the flow uses on its step heading).
  assert.equal((STEP_CODE.match(/tabIndex=\{-1\}/g) ?? []).length, 3);

  // No refusal sets the error directly any more — that is how one grows back
  // without the focus move.
  assert.equal(
    (STEP_CODE.match(/setError\(\{ field:/g) ?? []).length,
    0,
    "every refusal must go through refuse()"
  );
});

test("the disabled picker shows the RECORDED stage, not the rejected one", () => {
  // Two claims about one fact in a single glance: the panel naming the stored
  // stage while the picker above it still shows the answer that was refused.
  assert.match(
    STEP_CODE,
    /const onRecord = journeyStageForPhase\(result\.phase\)/
  );
  assert.match(STEP_CODE, /if \(onRecord\) setStage\(onRecord\.value\)/);
});

test("the submit reports its own progress to assistive technology", () => {
  assert.match(STEP_CODE, /aria-busy=\{pending\}/);
});
