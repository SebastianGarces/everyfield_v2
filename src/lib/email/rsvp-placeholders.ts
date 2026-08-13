// RSVP placeholder tokens used to mark where the confirm/decline buttons go.
//
// The merge engine substitutes these in place of the real URLs, and the email
// template (and the compose preview) turn them into styled buttons. They live
// in their own module so both the template and the body splitter that feeds it
// can name them without importing each other.
//
// They deliberately contain no character `escapeHtml` would touch: the body is
// HTML now, and merge VALUES are escaped on the way in (`escapeMergeValues`),
// so a token that escaped would never be found again.
export const CONFIRM_PLACEHOLDER = "__EF_CONFIRM__";
export const DECLINE_PLACEHOLDER = "__EF_DECLINE__";
