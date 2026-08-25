/**
 * The first desktop visit begins expanded; after that the existing cookie is
 * authoritative. Unknown values fail closed to collapsed rather than silently
 * overwriting a preference with an invented state.
 */
export function sidebarDefaultOpen(cookieValue: string | undefined): boolean {
  return cookieValue === undefined || cookieValue === "true";
}
