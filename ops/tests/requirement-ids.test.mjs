// Every requirement id cited in `src/` or `memory/` resolves to an FRD row
// (#549, after #548).
//
// THE BUG CLASS. A traceability id exists so a reader who meets it in a
// docstring can grep it and find the requirement. When the FRD has no such row
// the grep returns the docstring itself, and the honest conclusion — "this was
// never written down" — is wrong: the requirement is real, the row is missing.
// #548 closed four of those in People/CRM, #549 seven more across Meetings and
// Oversight, and both were found by a hand sweep nobody had run in months.
//
// WHY A TEST AND NOT A SCRIPT. The defect lands from two directions: code cites
// a new sub-lettered id, or an FRD edit drops a row something still cites. A
// script catches neither until someone remembers to run it. `pnpm test` runs
// here on every PR that touches code — and, because `product-docs/` is carved
// out of the docs-only shortcut in `pull-request-checks.yml`, on every PR that
// touches an FRD too. Removing that carve-out disarms this test against the
// second direction.
//
// THE MATCHER IS ANCHORED ON BOTH ENDS, deliberately. #549 was measured with an
// unanchored pattern and reported two ids that do not exist: `EET-011` is the
// tail of `MEET-011`, and `PRE-002` is the head of `PRE-0029`, a migration
// number in prose. Both dissolve under a word boundary, and the real `MEET-011`
// appears in their place.
//
// A DEFINITION IS NOT ONLY A TABLE ROW. The phase-engine FRD states PE-001
// through PE-018 as bold bullets rather than table rows; they are defined, and
// a table-only pattern reports that whole family as dangling. Bolding is
// optional on both forms — the notifications FRD bolds its table ids, the
// meetings FRD does not.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it
// is run from.
const ROOT = path.resolve(import.meta.dirname, "../..");

/** Where an id may be CITED. */
const CITING_ROOTS = ["src", "memory"];

/** The extensions a citation has ever lived in: code, migrations, prose. */
const TEXT = new Set([".ts", ".tsx", ".mjs", ".js", ".sql", ".md"]);

/**
 * An id: two to five capitals, a hyphen, three digits, an optional slice
 * letter. Anchored both ends — see the header.
 */
const ID = /\b[A-Z]{1,5}-[0-9]{3}[a-z]?\b/g;

/**
 * Cipher and digest names, not requirement ids. `AES-256` and `SHA-256` match
 * any reasonable id pattern and must never be "fixed" into an FRD.
 *
 * Add a prefix here only once it actually appears in the repo. A speculative
 * exclusion hides the next real family the day it is minted.
 */
const NON_IDS = /^(AES|SHA)-/;

function walk(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT.has(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Every id cited under `src/` and `memory/`, mapped to its first sighting. */
function cited() {
  const sightings = new Map();

  for (const root of CITING_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      const lines = fs.readFileSync(file, "utf8").split("\n");

      lines.forEach((line, index) => {
        for (const [id] of line.matchAll(ID)) {
          if (NON_IDS.test(id) || sightings.has(id)) continue;
          sightings.set(id, `${path.relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
  }

  return sightings;
}

/**
 * Every id an FRD DEFINES: a table row led by the id, or a line led by it.
 *
 * Both forms allow the surrounding `**`. The second is deliberately loose —
 * a paragraph or bullet opening with an id is that id being defined, and
 * tolerating the format is the whole lesson of #549. It admits a line that
 * merely opens with a citation, which can only ever add an id that some row
 * already defines.
 */
function defined() {
  const ROW = /^\| *\*{0,2}([A-Z]{1,5}-[0-9]{3}[a-z]?)\*{0,2} *\|/;
  const LED = /^(?:- +)?\*{0,2}([A-Z]{1,5}-[0-9]{3}[a-z]?)\b/;

  const ids = new Set();
  const features = path.join(ROOT, "product-docs/features");

  for (const feature of fs.readdirSync(features)) {
    const frd = path.join(features, feature, "frd.md");
    if (!fs.existsSync(frd)) continue;

    for (const line of fs.readFileSync(frd, "utf8").split("\n")) {
      const match = ROW.exec(line) ?? LED.exec(line);
      if (match) ids.add(match[1]);
    }
  }

  return ids;
}

test("every requirement id cited in src/ or memory/ resolves to an FRD row", () => {
  const sightings = cited();
  const rows = defined();

  const dangling = [...sightings]
    .filter(([id]) => !rows.has(id))
    .map(([id, where]) => `  ${id} — cited at ${where}`);

  assert.deepEqual(
    dangling,
    [],
    `${dangling.length} requirement id(s) cited in the code resolve to no FRD row:\n${dangling.join("\n")}\n\n` +
      "Write the row that describes what the code actually does — do not rename the citation to a row that already exists unless it truly means the same requirement. " +
      "If it is not a requirement id at all, add its prefix to NON_IDS in this file.\n" +
      `(cited: ${sightings.size}, defined: ${rows.size})`
  );
});
