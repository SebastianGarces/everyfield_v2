import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader, stripComments } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// `cursor-pointer` ON EVERY CLICKABLE (AGENTS.md), GUARDED WHERE THE CLASS IS
// WRITTEN — NOT AT EVERY CALL SITE.
//
// The rule stands on two rungs, and each one is asserted here once:
//
//   1. `globals.css` gives the cursor to every NATIVE clickable — a `<button>`,
//      an `a[href]`, anything carrying `role="button"` or `tabindex="0"`. No
//      class is involved, so no call site can drop it.
//   2. The shadcn bases below render an element rung 1 cannot reach — a Radix
//      `div[role="option"]`, a `div[role="menuitem"]` — or are the primitive a
//      whole surface leans on. For those the class string in `src/components/ui/`
//      IS the rule, and `pnpm dlx shadcn@latest add select` overwrites it.
//
// That second case is why this file exists (#502): the app had per-call-site
// scans asserting `<SelectItem className="cursor-pointer">` in a handful of
// features, and nothing at all on `select.tsx`. A CLI re-add would have taken
// the cursor off every select in the product with every one of those scans
// still green.
//
// Anchors are DECLARATIONS read through `sourceReader`, so a renamed or deleted
// component throws here instead of quietly asserting on some other function's
// copy of the class.
//
// EVERY FILE IS READ THROUGH `stripComments` FIRST, and that is not tidiness.
// A source-shaped test that matches on raw text accepts a COMMENT as proof: a
// review of the first version of this file deleted the class from a base,
// dropped `// cursor-pointer` into the same span, and watched all of it stay
// green — the class-string assertion and the per-file count both fed on the
// comment. Prose is not a class attribute. Nothing here matches raw source.
// ----------------------------------------------------------------------------

const UI_DIR = path.join(process.cwd(), "src/components/ui");

/** A primitive's source with comments gone — see the header. Never raw. */
function read(file: string): string {
  return stripComments(readFileSync(path.join(UI_DIR, file), "utf8"));
}

/**
 * Which rung actually holds this base's cursor — and therefore what a red build
 * MEANS.
 *
 * `class-only`: the element is a Radix `div` with a role, or an `asChild` Slot
 * that can render anything. No selector in `globals.css` reaches it, so the
 * class string IS the cursor. Red here is a VISUAL REGRESSION.
 *
 * `belt-and-braces`: the element is a native `<button>`, which rung 1 covers
 * whatever this class does. The class is redundant, kept because ripping it out
 * of `src/components/ui/` is a change to shipped components and this test-only
 * lane does not own them (#502 W3). Red here is drift, not a regression.
 */
type Rung = "class-only" | "belt-and-braces";

interface ClickableBase {
  /** File under `src/components/ui/`. */
  readonly file: string;
  /** The declaration that owns the class string. */
  readonly from: string;
  /** The next declaration — the end of the span, never a comment. */
  readonly to: string;
  /** Which rung holds the cursor, and so what a failure here means. */
  readonly rung: Rung;
  /** What the browser actually gets. */
  readonly renders: string;
}

const CLICKABLE_BASES: readonly ClickableBase[] = [
  {
    file: "select.tsx",
    from: "function SelectTrigger(",
    to: "function SelectContent(",
    rung: "belt-and-braces",
    renders: "a native button — every select in the app opens through it",
  },
  {
    file: "select.tsx",
    from: "function SelectItem(",
    to: "function SelectSeparator(",
    rung: "class-only",
    renders: 'div[role="option"]',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuItem(",
    to: "function DropdownMenuCheckboxItem(",
    rung: "class-only",
    renders: 'div[role="menuitem"]',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuCheckboxItem(",
    to: "function DropdownMenuRadioGroup(",
    rung: "class-only",
    renders: 'div[role="menuitemcheckbox"]',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuRadioItem(",
    to: "function DropdownMenuLabel(",
    rung: "class-only",
    renders: 'div[role="menuitemradio"]',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuSubTrigger(",
    to: "function DropdownMenuSubContent(",
    rung: "class-only",
    renders: 'div[role="menuitem"] that opens a submenu',
  },
  {
    file: "command.tsx",
    from: "function CommandItem(",
    to: "function CommandShortcut(",
    rung: "class-only",
    renders: 'div[role="option"]',
  },
  {
    file: "checkbox.tsx",
    from: "function Checkbox(",
    to: "export { Checkbox }",
    rung: "belt-and-braces",
    renders: "a native button, and the label beside it is not one",
  },
  {
    file: "radio-group.tsx",
    from: "function RadioGroupItem(",
    to: "export { RadioGroup, RadioGroupItem }",
    rung: "belt-and-braces",
    renders: "a native button, and the label beside it is not one",
  },
  {
    file: "tabs.tsx",
    from: "function TabsTrigger(",
    to: "function TabsContent(",
    rung: "belt-and-braces",
    renders: "a native button — the tab strip is a navigation surface",
  },
  {
    file: "sidebar.tsx",
    from: "const sidebarMenuButtonVariants = cva(",
    to: "function SidebarMenuButton(",
    rung: "class-only",
    renders: "a button OR an `asChild` Slot, which can be anything at all",
  },
];

// SWEPT AND LEFT OUT, so the next reader does not re-derive it: every other
// interactive primitive under `src/components/ui/` renders a NATIVE clickable
// and takes the cursor from rung 1 — the Radix `Trigger`s and `Close`s
// (dialog, sheet, alert-dialog, popover, tooltip, hover-card, collapsible),
// `Switch` (`button[role=switch]`), `Button`, every `Sidebar*` action and rail,
// `BreadcrumbLink` (`a`). `SelectScrollUpButton` carries `cursor-default` on
// purpose. `Label` is deliberately NOT here: a label's cursor follows the
// control it names — a pointer over a checkbox, a text caret over a text field
// — so it is a call-site decision, and the call sites that need it are scanned
// where they are written.

/** What a red build on this entry means, said in the failure itself. */
function consequence(base: ClickableBase): string {
  return base.rung === "class-only"
    ? `VISUAL REGRESSION: it renders ${base.renders}, which no globals.css selector reaches, so this class was the only thing giving it a pointer.`
    : `REDUNDANT-CLASS DRIFT, not a visual regression: it renders ${base.renders}, so globals.css still gives it the pointer. The class is belt-and-braces the ui/ lane keeps on purpose — restore it, or retire the entry in a change that owns src/components/ui/.`;
}

test("every interactive shadcn base carries cursor-pointer in its own class", () => {
  for (const base of CLICKABLE_BASES) {
    const span = sourceReader(read(base.file), base.file).span(
      base.from,
      base.to
    );

    assert.match(
      span,
      /\bcursor-pointer\b/,
      `${base.file} › ${base.from} lost cursor-pointer. ${consequence(base)}`
    );
  }
});

test("globals.css keeps the native rung: button, role=button, a[href], tabindex=0", () => {
  // The rung the inventory above deliberately does NOT duplicate. Deleting a
  // selector from this list silently un-guards every plain `<Button>` and
  // `<Link>` in the product, which is why no call site scans for it any more.
  const globals = sourceReader(
    stripComments(
      readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
    ),
    "globals.css"
  );
  const selectors = globals.span("button:not(:disabled)", "cursor: pointer;");

  for (const selector of [
    '[role="button"]:not(:disabled)',
    "a[href]",
    '[tabindex="0"]',
  ]) {
    assert.ok(
      selectors.includes(selector),
      `globals.css no longer gives the pointer to ${selector}`
    );
  }
});

/**
 * The suites still allowed to scan a CALL SITE for the class, and why.
 *
 * Every entry names a clickable neither rung reaches: rung 1 is four selectors
 * wide and rung 2 only covers what `src/components/ui/` writes. The list is a
 * tripwire in both directions — an entry that stops scanning is dead weight and
 * fails here, so the list shrinks as coverage grows.
 */
const CALL_SITE_SCANS: readonly {
  readonly file: string;
  readonly clickable: string;
}[] = [
  {
    file: "src/app/(dashboard)/settings/actions.test.ts",
    clickable:
      "a <label htmlFor> — no selector and no base gives a label a cursor",
  },
  {
    file: "src/components/tasks/phase-template-prompt.test.ts",
    clickable: 'a native <input type="checkbox"> and its <label>',
  },
  {
    file: "src/components/phase-engine/exit-criteria.test.ts",
    clickable:
      '<summary> — focusable without a tabindex="0" attribute to match',
  },
  {
    file: "src/components/shared/rich-text-editor-controls.test.ts",
    clickable:
      "richTextControlClass — a shared constant, guarded where it is written",
  },
];

function testFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) return testFilesUnder(full);

    return entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

test("no suite outside the allowlist scans a call site for cursor-pointer", () => {
  // #502's second half. The scans this replaced went green on every call site
  // they knew about while `select.tsx` — the file the class actually lives in —
  // had no test at all, which is the shape of a rule enforced in the wrong
  // place. Two weak rungs read as coverage; they are not.
  const here = path.join(
    process.cwd(),
    "src/components/ui/cursor-pointer.test.ts"
  );
  const allowed = new Set(
    CALL_SITE_SCANS.map((scan) =>
      path.join(process.cwd(), ...scan.file.split("/"))
    )
  );

  for (const file of testFilesUnder(path.join(process.cwd(), "src"))) {
    if (file === here || allowed.has(file)) continue;

    assert.doesNotMatch(
      stripComments(readFileSync(file, "utf8")),
      /cursor-pointer/,
      `${path.relative(process.cwd(), file)} scans a call site for cursor-pointer. If the clickable is a native button, an a[href], or a shadcn base, this file already guards it — delete the scan. If it is neither, add the file to CALL_SITE_SCANS with what it renders.`
    );
  }

  for (const scan of CALL_SITE_SCANS) {
    assert.match(
      stripComments(
        readFileSync(path.join(process.cwd(), ...scan.file.split("/")), "utf8")
      ),
      /cursor-pointer/,
      `${scan.file} no longer scans for the class — drop it from CALL_SITE_SCANS`
    );
  }
});

/**
 * Every primitive this file has classified — the whole directory, frozen.
 *
 * The counting ratchet below cannot see a primitive that arrives with NO
 * `cursor-pointer` anywhere: found 0, guarded 0, green. That is exactly the
 * shape of `pnpm dlx shadcn@latest add context-menu`, which drops in a fresh
 * set of `div[role="menuitem"]`s with no cursor at all. So the directory
 * LISTING is frozen too: a new file fails here until someone classifies it.
 */
const UI_FILES: readonly string[] = [
  "alert-dialog.tsx",
  "alert.tsx",
  "avatar.tsx",
  "badge.tsx",
  "breadcrumb.tsx",
  "button.tsx",
  "card.tsx",
  "checkbox.tsx",
  "collapsible.tsx",
  "command.tsx",
  "dialog.tsx",
  "dropdown-menu.tsx",
  "hover-card.tsx",
  "input.tsx",
  "kbd.tsx",
  "label.tsx",
  "popover.tsx",
  "progress.tsx",
  "radio-group.tsx",
  "scroll-area.tsx",
  "select.tsx",
  "separator.tsx",
  "sheet.tsx",
  "sidebar.tsx",
  "skeleton.tsx",
  "sonner.tsx",
  "switch.tsx",
  "table.tsx",
  "tabs.tsx",
  "textarea.tsx",
  "tooltip.tsx",
];

function uiPrimitives(): string[] {
  return readdirSync(UI_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .sort();
}

test("src/components/ui/ holds exactly the primitives this file has classified", () => {
  assert.deepEqual(
    uiPrimitives(),
    [...UI_FILES].sort(),
    `src/components/ui/ no longer holds the primitives this guard has classified, and a new one is invisible to the count below (no class anywhere means found 0, guarded 0, green).

Classify it, then add it to UI_FILES:
  • Does it render a native <button>, an a[href], [role="button"] or [tabindex="0"]? Rung 1 covers it. Add the filename and name it in the swept-and-left-out note.
  • Does it render a div carrying a role, or an \`asChild\` Slot? Nothing reaches it. Give it cursor-pointer in its class string AND an entry in CLICKABLE_BASES with rung: "class-only".
  • Is it not clickable at all (a card, a skeleton, a separator)? Add the filename and stop.`
  );
});

test("no base in src/components/ui/ carries cursor-pointer outside the inventory", () => {
  // The counting ratchet, in both directions. Above it the listing is frozen,
  // so between them a primitive cannot arrive, gain the class, or lose it
  // without a person saying which of the three happened.
  for (const file of uiPrimitives()) {
    const found = (read(file).match(/\bcursor-pointer\b/g) ?? []).length;
    const guarded = CLICKABLE_BASES.filter((b) => b.file === file).length;

    assert.equal(
      found,
      guarded,
      found < guarded
        ? `${file} writes cursor-pointer ${found} time(s) but ${guarded} declaration(s) are guarded — a guarded base lost its class. Restore it. (The class-string test above names which base and what it costs.)`
        : `${file} writes cursor-pointer ${found} time(s) and only ${guarded} are guarded — a primitive gained the class where nothing re-checks it after the next \`shadcn add\`. Add the declaration to CLICKABLE_BASES.`
    );
  }
});
