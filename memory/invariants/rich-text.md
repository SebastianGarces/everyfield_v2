# Rich Text — Stored HTML & the Sanitiser

Why and how, for the Rich Text rules in [`../invariants.md`](../invariants.md). A message body (COM-017) and a task description (T-021) share every module below, which is the point: a second editor or a second sanitiser is the bug this domain exists to prevent.

**Source:** `src/lib/rich-text/sanitize.ts` (the sanitiser and `sanitizeUrl`), `format.ts` (the door, `richTextToPlainText`, `isRichTextEmpty`), `email-segments.ts` (the RSVP splitter), `src/lib/communication/merge.ts` (substitution), `src/lib/tasks/descriptions.ts` (the task write gate), `src/components/shared/rich-text-editor.tsx` and `rich-text.tsx`, `src/lib/email/components/communication-email.tsx`

## The server is the gate, and there is one of everything

- The SERVER sanitises before the insert, because every export of the compose action is a POSTable endpoint that never saw the toolbar. The editor's paste-time pass is a courtesy.
- ONE sanitiser, `sanitizeRichText`, allow-list only: nine elements, `href` on `<a>` the only surviving attribute. Never a second sanitiser, never a regex that "strips script tags".
- A body is sanitised in exactly ONE place per surface, and `RichText` is the ONE read-only renderer, owning the sanitise AND the merge. Sanitising before handing it over corrupts the output; a hand-rolled `dangerouslySetInnerHTML` is a second copy of the component and of the prose classes, which have exactly TWO spellings — the app's voice, and the email preview's, which mimics the recipient's inline styles.

## Idempotence, and the entities that make it hard

- `sanitizeRichText` is IDEMPOTENT as a correctness requirement: its input already carries `&`, `<`, `>` and U+00A0 encoded by innerHTML serialisation, and one body is sanitised 2–4 times on the way to a recipient. Text nodes are DECODED before being re-escaped; escaping raw source text delivers `Bob &amp; Sue &lt;3`, differently wrong on every surface.
- `&nbsp;` becomes the U+00A0 CHARACTER, which `escapeHtml` leaves alone; re-emitting `&nbsp;` puts back the `&` the next pass escapes. `decodeHtmlEntities` still flattens it for URLs, which is what lets `URL_NOISE` catch `java&nbsp;script:`. Two callers, two rules, one decoder.

## URLs: vetted before substitution, so a token decides neither half of the origin

- A URL is vetted by `sanitizeUrl` AFTER entity-decoding and control-character stripping, or `javascript:` walks in spelled `&#106;avascript:`. A refused href unwraps the anchor and keeps the text.
- Vetting runs BEFORE merge substitution, so a `{{token}}` may decide NEITHER the SCHEME nor the AUTHORITY of an href: `<a href="{{first_name}}">` becomes `href="javascript:alert(1)"`, and `<a href="/{{first_name}}">` renders the protocol-relative `//evil.example/phish`. `sanitizeUrl` REFUSES a decoded URL containing `{{` unless the scheme is already fixed by what precedes it — `https?:`/`mailto:`/`tel:`, or a leading `/` — AND refuses `^/\s*\{\{`. Never move the token checks after the scheme check, and never escape the value instead: the value is not the problem, the POSITION is.
- **A BACKSLASH IS A SLASH.** Every WHATWG URL parser folds `\` into `/` for an http(s) base, so both refusals above were written in a character the attacker did not have to use: `\\evil.example` resolves to `https://evil.example/`, and `/\{{first_name}}` walks past `^/\s*\{\{` and past the `startsWith("/")` escape hatch. `sanitizeUrl` refuses any decoded URL containing `\`, IMMEDIATELY after `decoded` is built and BEFORE the four checks below it, because every one spells its rule with `/`. A refusal, not a fold — `%5C` is a real backslash and is untouched. Do not add a fifth special case further down.

## One door in, one door out

- ONE door converts a stored value for reading or editing: `toRichTextHtml`. It sanitises markup and converts legacy plain text, which is what makes "no migration" true.
- Its markup-vs-prose test is a PARSER's, never a shape's, because the wrong answer DELETES: matching any `<word …>` sends legacy prose to the sanitiser, so "Bring the \<signed lease\> and the keys" reads back as "Bring the  and the keys". A value is markup only when it opens a REAL element (`KNOWN_HTML_TAGS`) and that tag is FINISHED — void, or closed later in the string.
- Nothing this product WRITES may be tag-free: the editor emits `sanitizeEditorHtml` (sanitise, then wrap a bare run in `<p>`). The plain-text branch exists only for pre-feature rows, and escaped text cannot be told from typed text, so a tag-free value is escaped twice and `Q & A` reaches an inbox as `Q &amp; A`. Paste is the one caller that sanitises inline, because a `<p>` at the caret splits the author's paragraph.
- `toRichTextHtml` is IDEMPOTENT over its own output, and the message door and the task door must answer the SAME markup for one body — otherwise one has been hardened alone.

## Merge substitution

- Substitution is `renderTemplate(html, escapeMergeValues(data))` — one implementation, only the VALUES escaped, so a person named `Bobby <script>` is a name. Send path, preview and detail page run those two steps in that order; a surface running one shows a different email from the one that went out.
- **A DECORATION OVER A BODY IS TEXT-NODE-AWARE, because the body is markup.** A string-wide `replace` pilling unresolved tokens lands INSIDE an `href` — a token in a path with a fixed scheme is deliberately allowed — and the browser closes the attribute at the span's own quote, so for exactly the case the pill exists to catch the planter sees a garbled link and NO warning. `highlightUnresolvedMergeTokens` splits on `(<[^>]*>)` and rewrites only the even pieces; the subject arrives escaped, so one rule serves both halves of the preview.

## Two columns, two shapes

- `communications.body` is the FLATTENED plain text and `body_html` the markup. `body` is what message SEARCH reads, so markup there makes a search for "we are excited" miss `we <strong>are</strong> excited`. `message_templates` carries the same pair with a `Textarea` editor, so a template writes prose to `body` and leaves `body_html` NULL — a legacy shape, not a dead column.
- `richTextToPlainText` breaks a line at a block tag's OPENING as well as its closing, because a block both ends a line and starts one: with no `</p>` between typed prose and a following `<ul>`, closing-tags-only flattens to "…and keys- Checklist". The doubled breaks are absorbed by the `\n{3,}` collapse already ending the chain.
- ONE read expression everywhere: `bodyHtml ?? body`, handed to `toRichTextHtml`. A reader that takes `body` alone loses the formatting.

## The email artefacts and the RSVP split

- The RSVP placeholders live in `src/lib/email/rsvp-placeholders.ts`, imported by both the template and the splitter — the splitter may not import the template it feeds, which is a cycle that loads as `undefined`.
- `parseRichEmailBody` lives in `email-segments.ts` beside the sanitiser and the door, because it is a string operation with no JSX; under `src/components/` it made the email template depend on `components`. It declares neither decision it needs: `VOID_TAGS` from `./sanitize`, `isRichTextEmpty` from `./format`.
- It cuts at the RSVP token by CLOSING every element open at that point and RE-OPENING them after the buttons, never by slicing at the raw offset — so each segment is balanced alone (each is its own `dangerouslySetInnerHTML`) and their concatenation is balanced too.
- TWO MEDIA, TWO RULES, one each: `parseRichEmailBody` for the HTML half, `parseBody` for text/plain, which matches the token ANYWHERE on a line because the flattener writes `- ` before a list item. They differ because their INPUTS differ, not because one is an exception. They are two COMPONENTS, not one with a nullable body, over a shared `EmailShell` and `RsvpButtons`; neither body prop is optional and no caller passes both.

## Block structure and emptiness

- A sanitised body never nests a block inside a `<p>`: `<div>` UNWRAPS when it holds a block child (a contentEditable wraps every list it makes in one, and `<p><ul>…</ul></p>` is invalid), and an opening `<p>`/`<ul>`/`<ol>` implicitly closes an open `<p>`.
- `isRichTextEmpty`, not `.trim()`, decides whether a body is blank. An emptied contentEditable leaves `<p><br></p>`, which is truthy and sends a blank email.

The two task-description rules — `normalizeTaskDescription` as the one write gate, and `description` meaning the stored HTML with `descriptionPreview` beside it — live in [`tasks.md`](tasks.md).
