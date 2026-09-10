export interface PeopleToolbarDraft {
  query: string;
  value: string;
  submitted: string[];
  navigation: number;
}

/** An older toolbar response acknowledges a submission, not the latest keystroke. */
export function reconcilePeopleToolbarDraft(
  draft: PeopleToolbarDraft,
  query: string,
  search: string
): PeopleToolbarDraft {
  const own = draft.submitted.indexOf(query);
  return own >= 0
    ? { ...draft, query, submitted: draft.submitted.slice(own + 1) }
    : { query, value: search, submitted: [], navigation: draft.navigation + 1 };
}
