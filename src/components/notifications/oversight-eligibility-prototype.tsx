"use client";

import { useSyncExternalStore } from "react";

import { PrototypeSwitcher } from "@/components/prototype-switcher";

// ============================================================================
// ⚠️ PROTOTYPE — DISPOSABLE. Delete this file with the ruling on PR #369.
//
// The ruling of 2026-08-09 settled WHAT: an oversight reader stops being
// offered live toggles for the five categories `OVERSIGHT_ELIGIBLE_CATEGORIES`
// never serves them. It deliberately left HOW un-ruled, because there are three
// defensible presentations and reading about them is a poor way to choose.
//
// So all four states ship together behind the switcher and are picked by
// operating them on the preview:
//
//   now — AS BUILT. The contradiction itself: five rows that render, accept a
//         click, save, and change nothing that reaches the reader. It is the
//         DEFAULT so the problem is what you see first, and each variant is
//         judged against it rather than against a description of it.
//   a   — HIDE. The ineligible rows are not rendered at all.
//   b   — DISABLE. The rows stay, greyed, switches inert, with one line saying
//         what does arrive instead.
//   c   — LABEL. The rows stay at full weight with a token on each and inert
//         switches — the category is named, its unavailability is stated.
//
// The DERIVATION is not a prototype and does not live here: `row.eligible` and
// `view.ineligibleNote` come from the server view model
// (`buildPreferenceMatrixView`), which reads the delivery allow-list. Whichever
// presentation wins, that stays; only the branch that consumes it goes.
//
// TO STRIP: delete this file, the `⚠️ PROTOTYPE` blocks in
// `preference-matrix.tsx`, and the switcher + init script in
// `src/app/(dashboard)/settings/page.tsx`.
// ============================================================================

export const OVERSIGHT_ELIGIBILITY_ATTRIBUTE = "data-oversight-elig-proto";
export const OVERSIGHT_ELIGIBILITY_STORAGE_KEY = "oversight-elig-proto";

/** `now` first: the switcher's fallback is `ids[0]`, and as-built is the default. */
export const OVERSIGHT_ELIGIBILITY_IDS = ["now", "a", "b", "c"] as const;

export type OversightEligibilityVariant =
  (typeof OVERSIGHT_ELIGIBILITY_IDS)[number];

/** Variant C's token. The whole of what C is, so it lives with C. */
export const INELIGIBLE_ROLE_LABEL = "Not available for your role";

function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [OVERSIGHT_ELIGIBILITY_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function readVariant(): OversightEligibilityVariant {
  const value = document.documentElement.getAttribute(
    OVERSIGHT_ELIGIBILITY_ATTRIBUTE
  );
  return (OVERSIGHT_ELIGIBILITY_IDS as readonly string[]).includes(value ?? "")
    ? (value as OversightEligibilityVariant)
    : "now";
}

/**
 * The active variant, read from `<html>` — external state, so it is read as one.
 *
 * The candidates differ in BEHAVIOUR (an inert switch is not a CSS variant of a
 * live one), so the usual ancestor-selector trick from the switcher's header
 * cannot carry these. The server snapshot is `"now"`, which is also the default,
 * so the first paint and the hydration render agree.
 */
export function useOversightEligibilityVariant(): OversightEligibilityVariant {
  return useSyncExternalStore(subscribe, readVariant, () => "now" as const);
}

export function OversightEligibilityPrototypeSwitcher() {
  return (
    <PrototypeSwitcher
      attribute={OVERSIGHT_ELIGIBILITY_ATTRIBUTE}
      storageKey={OVERSIGHT_ELIGIBILITY_STORAGE_KEY}
      label="#369 rows"
      options={[
        {
          id: "now",
          label: "As built",
          hint: "Today: five rows that save and change nothing you receive.",
        },
        {
          id: "a",
          label: "A · Hide",
          hint: "The rows you are never served are not shown.",
        },
        {
          id: "b",
          label: "B · Disable",
          hint: "Rows stay, greyed and inert, with one line on what does arrive.",
        },
        {
          id: "c",
          label: "C · Label",
          hint: "Rows stay at full weight, each carrying a token, switches inert.",
        },
      ]}
    />
  );
}
