// ============================================================================
// Ministry Teams — the sentences that depend on the reader's seat (AS-020).
//
// Same shape and same reason as `src/lib/people/presentation.ts` and
// `src/lib/communication/presentation.ts`: the harness has no DOM, so copy
// inside a `.tsx` is copy no test can read, and a capability-conditional
// sentence has no literal for the repo-wide subtitle scan to check — it is
// tested here, on both branches, instead.
//
// `membership-copy.ts` next door holds the two SEAT REFUSALS an assignment can
// produce, which the service throws and the dialog reads back. These are the
// page's own header. Two different jobs, so two files rather than one drawer of
// unrelated strings.
//
// Keep it free of `@/db` and of anything a client component cannot import.
// ============================================================================

/**
 * The Ministry Teams list's subtitle (#668).
 *
 * The old line was "Organize, staff, and track your ministry teams" for every
 * seat — three verbs, of which a plant Member holds the third. Creating a team,
 * adding and removing members, assigning a role and setting a leader are all
 * `teams.write` (ADMIN_PLUS), and `TeamsDashboard` already hides every one of
 * those controls from a Member. The header underneath the h1 went on asking.
 *
 * The FRD's third exception — a team leader writing on their own team — cannot
 * ship yet and does not change this sentence: `ministry_teams.leader_id`
 * references `persons.id` and a session names a `users.id`, so no surface can
 * ask "am I this team's leader?" until AS-013's account-to-person link lands.
 * Every teams write therefore sits at `teams.write` for everybody, and one
 * boolean is the whole truth of this page today.
 *
 * WHAT THE MEMBER GETS keeps the one verb that was theirs. Tracking is reading:
 * the team cards, the staffing summary, and the health and org-chart pages next
 * door are all open to them, so the sentence describes the page they actually
 * have.
 */
export const TEAMS_SUBTITLE_FOR_A_READER =
  "Your plant's ministry teams, and how each one is staffed";

export function teamsListSubtitle(canWrite: boolean): string {
  return canWrite
    ? "Organize, staff, and track your ministry teams"
    : TEAMS_SUBTITLE_FOR_A_READER;
}
