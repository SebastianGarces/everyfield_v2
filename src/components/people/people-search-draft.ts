export interface PeopleSearchDraft {
  query: string;
  value: string;
  submitted: string[];
  navigation: number;
}

/** An older search response acknowledges a submission, not the latest keystroke. */
export function reconcilePeopleSearchDraft(
  draft: PeopleSearchDraft,
  query: string,
  search: string
): PeopleSearchDraft {
  const own = draft.submitted.indexOf(query);
  return own >= 0
    ? { ...draft, query, submitted: draft.submitted.slice(own + 1) }
    : { query, value: search, submitted: [], navigation: draft.navigation + 1 };
}
