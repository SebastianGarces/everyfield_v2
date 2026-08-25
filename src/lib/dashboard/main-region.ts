/**
 * The id on the `(dashboard)` layout's `<main>`.
 *
 * A fact about the dashboard shell, so it lives beside it rather than inside the
 * settings registry — the layout would otherwise import six lucide icons and six
 * gate closures to read one string.
 *
 * It is the skip-link destination. Settings uses the narrower page-content
 * target below so closing the dialog resumes after contextual navigation.
 */
export const DASHBOARD_MAIN_ID = "dashboard-main";

/**
 * The focus target after Settings closes. It follows page context in DOM order,
 * so the next Tab reaches the route's content instead of re-entering breadcrumb
 * navigation or page actions.
 */
export const DASHBOARD_PAGE_CONTENT_ID = "dashboard-page-content";
