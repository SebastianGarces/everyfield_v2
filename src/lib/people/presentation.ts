// ============================================================================
// People — the sentences that depend on the reader's seat (AS-020).
//
// The third module of this shape, after `src/lib/communication/presentation.ts`
// and `src/lib/meetings/copy.ts`, and it exists for their reason: the repo's
// harness runs `src/**/*.test.ts` under node:test with no DOM, so copy that
// lives inside a `.tsx` is copy no test can read. A capability-conditional
// sentence also cannot be a string literal in the page, which is what moves it
// out of the repo-wide subtitle scan and under this module's own test, where
// BOTH branches get checked instead of only the one a literal could show.
//
// Keep it free of `@/db` and of anything a client component cannot import.
// ============================================================================

/**
 * The People directory's subtitle (#668).
 *
 * The old line was "Manage your contacts and pipeline" for every seat. Every
 * write on this page — import, quick add, Add Person, the per-row edits, the
 * pipeline's drag — is `people.write` (ADMIN_PLUS), so a plant Member was being
 * told to manage a directory the server refuses them every write on, on a page
 * that already hides all five controls from them.
 *
 * "Manage" is softer than "Send" or "Schedule", which is exactly why it
 * survived two passes of this sweep: it names no single write, so it reads as
 * description until you ask who may do it. It is a write verb, and it is in
 * `WRITE_IMPERATIVES` now.
 *
 * WHAT THE MEMBER GETS names what the page IS for them. The directory, the
 * pipeline board, search, the filters and the view toggle are all reads, and
 * Export stays too (`exportPeopleAction` is `read`) — so this is a page a
 * Member uses, not one they are locked out of, and the sentence says so rather
 * than going quiet.
 */
export const PEOPLE_SUBTITLE_FOR_A_READER =
  "Your plant's contacts, and where each one is in the pipeline";

export function peopleDirectorySubtitle(canWrite: boolean): string {
  return canWrite
    ? "Manage your contacts and pipeline"
    : PEOPLE_SUBTITLE_FOR_A_READER;
}
