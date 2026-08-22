/**
 * THE BOX A TAILWIND CLASS STRING DECLARES, RESOLVED BY TAILWIND ITSELF.
 *
 * DECLARES, not "renders", and the difference is the module's one limitation:
 * what gets measured is an explicit `width`/`height` (`size-*`, or `w-*` with
 * `h-*`), never a box that emerges from padding around an intrinsically sized
 * child. `resolveTargetBox("p-2")` reports `null`, not 16-plus-padding, because
 * answering that needs the glyph's intrinsic size and a layout engine. So a
 * control whose target comes from padding is NOT measurable here — convert it
 * to an explicit box or an `::after` overlay, which is the fix anyway. It fails
 * closed: the unmeasurable case reports `null` and every caller reads that as
 * under the floor.
 *
 * A target-size test can be written two ways, and only one of them is evidence.
 * The cheap way asserts on the CLASS NAME — `assert.match(classes, /size-6/)` —
 * which proves that somebody typed six characters, not that anything is 24px.
 * It stays green when `--spacing` is retuned in `globals.css`, when a later
 * class in the same string overrides the first, and when the utility is renamed
 * out from under it by a major version. The claim under test is a MEASUREMENT
 * ("this control's border-box is at least 24 CSS px"), so the number has to come
 * out of the same compiler that ships the stylesheet.
 *
 * So this module loads the PROJECT'S OWN design system — `src/app/globals.css`,
 * with its imports and its `@theme` — and asks Tailwind what each candidate
 * compiles to. `--spacing` is read back out of that theme rather than assumed to
 * be 0.25rem, which is the whole point: change the token and every box this
 * module reports moves with it, exactly as the browser's would.
 *
 * WHAT IS AND IS NOT MEASURED, because the distinction is the guard:
 *
 *   * Only declarations at the TOP LEVEL of the rule count toward `self`. A
 *     Tailwind variant compiles to a NESTED rule (`&:focus-visible { … }`,
 *     `& svg:not([class*='size-']) { … }`), so a width that only applies on
 *     hover, or one that belongs to a descendant icon, can never be mistaken
 *     for the element's own unconditional box. That is why `[&_svg…]:size-4`
 *     does not make a padding-less button 16px wide here: it never did in the
 *     browser either.
 *   * `after` is reported separately, for the controls whose PAINTED size must
 *     stay small and whose hit area is extended by a centered `::after` overlay
 *     (see the better-accessibility skill's hit-areas reference).
 *
 * `toPx` REFUSES what it does not understand instead of returning 0 or NaN. A
 * length parser that guesses is a guard that passes on a class it has never
 * seen; a throw naming the value is a guard that tells the next author to teach
 * it. Fail closed, loudly.
 *
 * Nothing here names a feature, so it sits with the other domain-free test
 * infrastructure (`source-span.ts`, `theme-color.ts`) rather than beside any one
 * suite.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { __unstable__loadDesignSystem } from "tailwindcss";

/** CSS px in one `rem`, matching the browser default the app never overrides. */
const ROOT_FONT_SIZE = 16;

const ROOT = process.cwd();
const GLOBALS = path.join(ROOT, "src/app/globals.css");

/**
 * Resolve an `@import` the way the bundler does, including the `style`
 * condition — `tw-animate-css` publishes its stylesheet only through
 * `exports["."].style`, so a resolver that looks for `index.css` finds nothing
 * and the theme silently loads without it.
 */
function stylesheetEntry(id: string): string {
  const segments = id.split("/");
  const scoped = id.startsWith("@");
  const name = segments.slice(0, scoped ? 2 : 1).join("/");
  const rest = segments.slice(scoped ? 2 : 1);
  const dir = path.join(ROOT, "node_modules", name);

  if (rest.length > 0) return path.join(dir, ...rest);

  const meta = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8")
  ) as {
    exports?: { "."?: { style?: string } };
    style?: string;
    main?: string;
  };

  return path.join(
    dir,
    meta.exports?.["."]?.style ?? meta.style ?? meta.main ?? "index.css"
  );
}

/** The design system, built once — loading it parses the whole theme. */
let designSystem: ReturnType<typeof __unstable__loadDesignSystem> | null = null;

function projectDesignSystem() {
  designSystem ??= __unstable__loadDesignSystem(readFileSync(GLOBALS, "utf8"), {
    base: path.dirname(GLOBALS),
    loadStylesheet: async (id: string, base: string) => {
      const file = id.startsWith(".")
        ? path.resolve(base, id)
        : stylesheetEntry(id);

      return {
        path: file,
        base: path.dirname(file),
        content: readFileSync(file, "utf8"),
      };
    },
    // No `@plugin` or `@config` in this project; a JS module reaching the
    // loader means one arrived, and an empty stub would hide it.
    loadModule: async (id: string) => {
      throw new Error(`tailwind-box: globals.css now loads a JS module: ${id}`);
    },
  });

  return designSystem;
}

/** A resolved length, in CSS px, or a throw naming what could not be read. */
function toPx(value: string, spacing: string): number {
  const trimmed = value.trim();

  const scaled = /^calc\(var\(--spacing\)\s*\*\s*([\d.]+)\)$/.exec(trimmed);
  if (scaled) return Number(scaled[1]) * toPx(spacing, spacing);

  const px = /^([\d.]+)px$/.exec(trimmed);
  if (px) return Number(px[1]);

  const rem = /^([\d.]+)rem$/.exec(trimmed);
  if (rem) return Number(rem[1]) * ROOT_FONT_SIZE;

  throw new Error(
    `tailwind-box: cannot measure the length "${trimmed}". Teach toPx this form rather than letting a target go unmeasured.`
  );
}

/** The body of the first rule in `css`, or "" when there is no rule. */
function firstRuleBody(css: string): string {
  const open = css.indexOf("{");
  if (open === -1) return "";

  let depth = 0;

  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }

  return "";
}

/** `body` with every nested rule removed — what the element itself gets. */
function topLevelDeclarations(body: string): string {
  let out = "";
  let depth = 0;

  for (const char of body) {
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (depth === 0) out += char;
  }

  return out;
}

function declaration(block: string, property: string): string | null {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`).exec(block);

  return found ? found[1].replace("!important", "").trim() : null;
}

/** A resolved border-box. `null` where the class string declares nothing. */
export interface Box {
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * An `::after` hit-area overlay: its box, and whether it is actually laid over
 * the control.
 *
 * Size alone is not the property. An `::after` that is 24x24 but not positioned
 * is a flex or block child INSIDE the control — it enlarges nothing, and on a
 * `display: flex` control it shoves the glyph off centre. So the two halves are
 * reported together and a caller has to check both.
 */
export interface Overlay extends Box {
  /** Absolutely positioned and centred on the control. */
  readonly centred: boolean;
}

/** The element's own box, and any `::after` hit-area overlay. */
export interface TargetBox {
  readonly self: Box;
  readonly after: Overlay;
}

/**
 * Read one declaration across the candidates that contributed to a block.
 *
 * A property declared TWICE is a throw, not a winner. Resolving it would mean
 * reproducing Tailwind's cascade, and the obvious shortcut — last one in the
 * class attribute wins — is simply false: Tailwind sorts utilities into its own
 * emitted order, so `w-4 size-6` paints 16px wide while the attribute order says
 * `size-6` is last. Reporting 24 there would be a FALSE PASS in the one
 * direction this module must never fail. `prettier-plugin-tailwindcss` hides the
 * problem for `className` literals by rewriting them into emitted order, but it
 * does not touch object property values, so a class string in a `classNames`
 * map keeps whatever order it was typed in.
 */
function readOnce(blocks: string[], property: string): string | null {
  const values = blocks
    .map((block) => declaration(block, property))
    .filter((value): value is string => value !== null);

  if (values.length > 1) {
    throw new Error(
      `tailwind-box: "${property}" is declared ${values.length} times (${values.join(
        ", "
      )}). Which one wins is Tailwind's sort order, not the class attribute's, so this module refuses to guess. Declare it once.`
    );
  }

  return values.length === 0 ? null : values[0].trim() || null;
}

function measure(blocks: string[], spacing: string): Box {
  const read = (property: string): number | null => {
    const value = readOnce(blocks, property);

    return value === null ? null : toPx(value, spacing);
  };

  return { width: read("width"), height: read("height") };
}

/** Laid over the control, rather than sitting inside it as an ordinary child. */
function isCentred(blocks: string[]): boolean {
  const at = (property: string) => readOnce(blocks, property);

  return (
    at("position") === "absolute" &&
    at("top") === "50%" &&
    at("left") === "50%" &&
    at("translate") === "-50% -50%"
  );
}

/**
 * Compile `classes` through the project's Tailwind and report the box.
 *
 * Candidates Tailwind does not recognise are skipped: they carry no width or
 * height by definition, and a class string full of colours and variants would
 * otherwise be unmeasurable. A candidate that SHOULD have contributed a length
 * and did not leaves the box `null`, which reads as "undeclared" and fails the
 * caller's assertion — never as a pass.
 */
export async function resolveTargetBox(classes: string): Promise<TargetBox> {
  const system = await projectDesignSystem();
  const spacing = system.resolveThemeValue("--spacing");

  if (!spacing) {
    throw new Error("tailwind-box: the theme declares no --spacing");
  }

  const selfBlocks: string[] = [];
  const afterBlocks: string[] = [];

  for (const candidate of classes.split(/\s+/).filter(Boolean)) {
    const css = system.candidatesToCss([candidate])[0];
    if (css === null) continue;

    const body = firstRuleBody(css);

    selfBlocks.push(topLevelDeclarations(body));

    const after = /&::after\s*\{([^{}]*)\}/.exec(body);
    if (after) afterBlocks.push(after[1]);
  }

  return {
    self: measure(selfBlocks, spacing),
    after: {
      ...measure(afterBlocks, spacing),
      centred: isCentred(afterBlocks),
    },
  };
}
