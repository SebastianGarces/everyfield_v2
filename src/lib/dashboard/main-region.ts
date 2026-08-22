/**
 * The id on the `(dashboard)` layout's `<main>`.
 *
 * A fact about the dashboard shell, so it lives beside it rather than inside the
 * settings registry — the layout would otherwise import six lucide icons and six
 * gate closures to read one string.
 *
 * It exists for the settings modal, which focuses this element when it closes.
 * Settings is usually opened from an item inside the avatar dropdown, and that
 * item is gone by the time the modal closes, so Radix's restore-to-trigger lands
 * on `<body>` and a keyboard reader has to tab from the top of the document.
 */
export const DASHBOARD_MAIN_ID = "dashboard-main";
