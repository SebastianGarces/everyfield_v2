// ============================================================================
// People — the sentences that depend on the reader's seat (AS-020).
//
// The copy lives beside the feature that owns it, and the RULE lives once, in
// `@/lib/auth/read-only-surfaces`: `CAPABILITY_MATCHED_SUBTITLES` in that
// module's test carries a row per surface, pins both branches by equality, and
// asserts the page passes the matching capability in. A new module of this shape
// without a row there fails the scan.
//
// WHY A MODULE AND NOT A TERNARY IN THE PAGE: the repo's harness runs
// `src/**/*.test.ts` under node:test with no DOM, so copy inside a `.tsx` is
// copy no test can read.
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
 * that already hides all four controls from them.
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
export function peopleDirectorySubtitle(canWrite: boolean): string {
  return canWrite
    ? "Manage your contacts and pipeline"
    : "Your plant's contacts, and where each one is in the pipeline";
}
