# PDF document fonts (#398)

These eight TTFs are the ONLY font asset the app ships. They exist for one
reason: `@react-pdf/renderer`'s standard-14 fonts (Helvetica, Courier) carry
**WinAnsi encoding only**, and a character outside WinAnsi is written with the
WRONG GLYPH rather than failing — `→` arrives as `’`, `↓` as `“`, `✓` as a
control byte and box drawing as NUL. The browser's own ⌘P output has never had
that problem, so the downloaded PDF and the printed page disagreed.

They are loaded by `src/lib/documents/pdf/fonts.ts`, from this app's own origin
(`/fonts/<file>`) in the browser and from `public/fonts/` on disk on the server.
Nothing else references them; the SCREEN is set in Geist (`src/app/layout.tsx`).

## Provenance

| | |
|---|---|
| Family | DejaVu Sans / DejaVu Sans Mono |
| Version | 2.37 |
| Source | `https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip` |
| SHA-256 of that zip | `7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a` |
| Licence | Bitstream Vera + Arev, see `LICENSE.txt` (permissive; redistribution allowed) |

DejaVu was picked over a Helvetica-metric clone (Liberation Sans) because
`@react-pdf/renderer` does NOT fall back across families per glyph: one face has
to cover everything, and DejaVu is the widely-redistributable family that covers
arrows, box drawing, block elements, geometric shapes and dingbats.

## How these files were made

Subset with `fonttools` (`pyftsubset`), which is why each face is ~60–85 KB
instead of ~700 KB. To regenerate after a version bump, unzip the release above
and run this over the eight source faces:

```sh
RANGES="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0192,U+02C6,U+02DC,\
U+2000-206F,U+20A0-20BF,U+2116,U+2117,U+2122,U+212E,U+2190-21FF,\
U+2202,U+2206,U+2211,U+2212,U+2215,U+221A,U+221E,U+2248,U+2260,U+2264,U+2265,\
U+2500-257F,U+2580-259F,U+25A0-25FF,\
U+2600-2603,U+260E,U+2610-2612,U+263A,U+2660-2667,U+266A-266D,U+26A0,U+26A1,\
U+2713-2718,U+2726,U+2727,U+2744,U+2794,U+279C,U+27A1"

pyftsubset ttf/DejaVuSans.ttf --output-file=dejavu-sans.ttf \
  --unicodes="$RANGES" --layout-features='*' --name-IDs='*' \
  --no-hinting --notdef-outline
```

The mapping from source face to shipped file:

| source | shipped as |
|---|---|
| `DejaVuSans.ttf` | `dejavu-sans.ttf` |
| `DejaVuSans-Bold.ttf` | `dejavu-sans-bold.ttf` |
| `DejaVuSans-Oblique.ttf` | `dejavu-sans-italic.ttf` |
| `DejaVuSans-BoldOblique.ttf` | `dejavu-sans-bold-italic.ttf` |
| `DejaVuSansMono.ttf` | `dejavu-mono.ttf` |
| `DejaVuSansMono-Bold.ttf` | `dejavu-mono-bold.ttf` |
| `DejaVuSansMono-Oblique.ttf` | `dejavu-mono-italic.ttf` |
| `DejaVuSansMono-BoldOblique.ttf` | `dejavu-mono-bold-italic.ttf` |

`--layout-features='*'` keeps GSUB/GPOS, so kerning survives; dropping them saved
only ~36 KB across all eight and cost the spacing.

`--no-hinting` is safe here because a PDF is laid out at real coordinates, not
snapped to a screen pixel grid.

## The one gap the subset does NOT close

Upstream **DejaVu Sans Mono Oblique** and **Bold Oblique** have no `✓` (U+2713),
`✗` (U+2717) or `⚠` (U+26A0) — that is a hole in the source faces, not in the
subset. Every other combination carries all three: prose in any emphasis, and a
code block, which is upright mono.

What it costs is worth stating exactly, because it is not a missing-glyph box.
`@react-pdf/layout` appends `Helvetica` to every font stack and
`fontSubstitution` in `@react-pdf/textkit` ends a run at the first character
nothing in that stack can draw — so an ITALIC inline-code span holding one of
those three loses that character AND THE REST OF THE SPAN.

That is the renderer's standing behaviour, not something these files introduce:
it is what the standard-14 faces do today wherever no font in the stack has the
character at all (CJK, emoji). What this asset changes is how few characters
are left in that set. `src/lib/documents/pdf/fonts.test.ts` pins both halves —
which faces are missing which code points, and where the drawn run stops.
