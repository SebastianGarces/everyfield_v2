// ============================================================================
// Document PDFs — the faces every generated PDF is set in
// ============================================================================
//
// WHY THIS FILE EXISTS
//
// `@react-pdf/renderer` ships the standard-14 PDF fonts (Helvetica, Courier),
// and those carry WINANSI ENCODING ONLY. A character outside WinAnsi is not
// refused — it is written with the WRONG GLYPH, silently:
//
//     →  U+2192  →  byte 0x92  →  reads as ’
//     ↓  U+2193  →  byte 0x93  →  reads as “
//     ✓  U+2713  →  byte 0x13  →  a control byte
//     ─  U+2500  →  byte 0x00  →  nothing at all
//
// Em dashes, curly quotes, `…` and `•` ARE inside WinAnsi, which is why this
// was easy to miss for so long. The browser's own ⌘P output never had the
// problem, so the downloaded article and the printed page disagreed — the last
// divergence between the two controls that PR #391 otherwise closed.
//
// The fix is a registered Unicode font, which means shipping a font asset:
// eight subset DejaVu faces under `public/fonts/` (provenance, licence and the
// exact subsetting command are in `public/fonts/README.md`).
//
// NOT TAKEN, DELIBERATELY: transliterating `→` to `->` while extracting. That
// trades a corrupt glyph for a DIFFERENT DOCUMENT than the printed one, which
// is the divergence this feature exists to remove.
//
// WHY ONE TABLE FOR BOTH PATHS
//
// Two different renderers reach for these faces — the wiki article download
// (`src/components/wiki/article-pdf/render.tsx`, in the browser) and the F6
// document templates (`./index.tsx`, on the server) — and both used to pin the
// standard-14 names by hand. Anywhere a template merges user-entered text, the
// same corruption was reachable. One table means the two paths cannot drift
// apart again.
//
// A FAMILY IS ONE FACE, NEVER AN AXIS
//
// Each of the eight names below is registered as its own SINGLE-SOURCE family
// at weight 400 / style normal, exactly as the standard-14 names behaved.
// `@react-pdf/font` resolves a face by filtering on `fontStyle` FIRST, so
// asking a bold family for an italic child finds nothing and THROWS. Naming the
// combined face — `EFDoc-BoldItalic`, not bold + italic — cannot miss.
//
// THIS FILE IMPORTS NOTHING AT RUNTIME
//
// `article-actions.tsx` imports it, and that file's whole bundle discipline is
// that `@react-pdf/renderer` is loaded ON CLICK. So the registry arrives as an
// ARGUMENT and is only named here in a type position (`typeof import(...)`,
// which ships nothing). Reading the bytes is the caller's job too: the browser
// fetches them from this app's own origin, the server reads them off disk.
// ============================================================================

/** `@react-pdf/renderer`'s `Font` object, named without importing the module. */
export type PdfFontRegistry = (typeof import("@react-pdf/renderer"))["Font"];

/** Where the shipped faces are served from, on this app's own origin. */
export const PDF_FONT_BASE_PATH = "/fonts";

/**
 * The eight faces, by role.
 *
 * `standard` is the standard-14 family this role was set in before this table
 * existed — the behaviour a failed font load falls back to, and why it is an
 * ALIAS rather than a re-registration. See `register` at the bottom.
 */
const FACES = {
  body: { family: "EFDoc", file: "dejavu-sans.ttf", standard: "Helvetica" },
  bold: {
    family: "EFDoc-Bold",
    file: "dejavu-sans-bold.ttf",
    standard: "Helvetica-Bold",
  },
  italic: {
    family: "EFDoc-Italic",
    file: "dejavu-sans-italic.ttf",
    standard: "Helvetica-Oblique",
  },
  boldItalic: {
    family: "EFDoc-BoldItalic",
    file: "dejavu-sans-bold-italic.ttf",
    standard: "Helvetica-BoldOblique",
  },
  mono: { family: "EFDocMono", file: "dejavu-mono.ttf", standard: "Courier" },
  monoBold: {
    family: "EFDocMono-Bold",
    file: "dejavu-mono-bold.ttf",
    standard: "Courier-Bold",
  },
  monoItalic: {
    family: "EFDocMono-Italic",
    file: "dejavu-mono-italic.ttf",
    standard: "Courier-Oblique",
  },
  monoBoldItalic: {
    family: "EFDocMono-BoldItalic",
    file: "dejavu-mono-bold-italic.ttf",
    standard: "Courier-BoldOblique",
  },
} as const satisfies Record<
  string,
  { family: string; file: string; standard: string }
>;

export type PdfFaceRole = keyof typeof FACES;

/** Every face, in one array — the order registration and loading walk. */
export const PDF_FACES = Object.values(FACES) as readonly {
  family: string;
  file: string;
  standard: string;
}[];

/**
 * The `fontFamily` value for each role. THIS is what a stylesheet names.
 *
 * `PDF_FONT.bold` rather than `"Helvetica-Bold"`: the string is an
 * implementation detail of this file, and a stylesheet that spells it out is a
 * stylesheet that keeps the WinAnsi bug when this table changes.
 */
export const PDF_FONT = {
  body: FACES.body.family,
  bold: FACES.bold.family,
  italic: FACES.italic.family,
  boldItalic: FACES.boldItalic.family,
  mono: FACES.mono.family,
  monoBold: FACES.monoBold.family,
  monoItalic: FACES.monoItalic.family,
  monoBoldItalic: FACES.monoBoldItalic.family,
} as const satisfies Record<PdfFaceRole, string>;

/** Reads one face's bytes. The browser fetches; the server reads a file. */
export type PdfFontLoader = (file: string) => Promise<Uint8Array>;

/**
 * `bytes` as a `data:` URL.
 *
 * A data URL rather than the URL itself, because the load has to be OBSERVABLE:
 * `Font.register` defers fetching until layout, and a face that fails there
 * takes the whole download down instead of degrading. Reading the bytes first
 * is what lets a failure choose the standard-14 fallback while there is still
 * time. `btoa` is global in both browsers and Node.
 */
function toDataUrl(bytes: Uint8Array): string {
  // Chunked, because `String.fromCharCode(...bytes)` on an 80 KB face is
  // 80,000 arguments in one call — enough to overflow the stack.
  const CHUNK = 4096;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return `data:font/ttf;base64,${btoa(binary)}`;
}

/**
 * Registration is per registry object and happens ONCE.
 *
 * `Font.register` APPENDS a source to a family; registering twice would leave a
 * dead duplicate behind on every second download. A `WeakMap` keyed on the
 * registry memoizes it without a module-level flag a test would have to reset.
 */
const registrations = new WeakMap<PdfFontRegistry, Promise<boolean>>();

/**
 * Register the Unicode faces on `Font`, reading their bytes through `load`.
 *
 * Resolves `true` when the shipped faces are in use and `false` when every face
 * fell back to its standard-14 family — that is, to the behaviour under the
 * standard-14 faces: a document with corrupt arrows rather than no document.
 *
 * ALL OR NOTHING. Every face is read BEFORE anything is registered, so one
 * missing file cannot leave a document set half in DejaVu and half in
 * Helvetica — two faces at two different heights on one page.
 */
export function registerPdfFonts(
  Font: PdfFontRegistry,
  load: PdfFontLoader
): Promise<boolean> {
  const existing = registrations.get(Font);
  if (existing) return existing;

  const registration = register(Font, load);
  registrations.set(Font, registration);
  return registration;
}

async function register(
  Font: PdfFontRegistry,
  load: PdfFontLoader
): Promise<boolean> {
  try {
    const sources = await Promise.all(
      PDF_FACES.map(async (face) => [face, await load(face.file)] as const)
    );
    for (const [face, bytes] of sources) {
      Font.register({ family: face.family, src: toDataUrl(bytes) });
    }
    return true;
  } catch {
    // THE FALLBACK IS AN ALIAS, NOT A REGISTRATION, and the difference is
    // content. `Font.register({ family: "EFDoc", src: "Helvetica" })` looks
    // equivalent and is not: it makes a family whose face is a DIFFERENT object
    // from the `Helvetica` that `@react-pdf/layout` appends to every font
    // stack, and `fontSubstitution` in `@react-pdf/textkit` starts a new run
    // the moment the picked font changes — so a character neither face has (an
    // arrow, say) does not corrupt, it SWALLOWS THE REST OF THE RUN. "A → B"
    // arrives as "A ".
    //
    // Pointing the family at the SAME `FontFamily` object the built-in name
    // resolves to makes the two entries in that stack identical, which is
    // exactly the shape a document had under the standard-14 faces. The degrade
    // is then today's file, byte for byte — corrupt arrows and all — rather than
    // a new failure mode invented for the unhappy path.
    const families = Font.getRegisteredFonts();
    for (const face of PDF_FACES) {
      families[face.family] = families[face.standard];
    }
    return false;
  }
}
