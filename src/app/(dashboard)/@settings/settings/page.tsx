import type { Metadata } from "next";

import { SettingsSurface } from "@/components/settings/settings-surface";
import { DEFAULT_SETTINGS_SECTION } from "@/lib/settings/sections";

// ============================================================================
// `/settings` with no section, COLD — the sibling of `[section]/page.tsx` here
// and of `(.)settings/page.tsx` beside it (#640, #646).
//
// It renders rather than redirects to `/settings/account`, because this URL is
// in sent mail, in bookmarks and in `OVERSIGHT_CONSENT_SURFACES`: a bounce would
// put a redirect in front of every one of them to save a file three lines long.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <SettingsSurface sectionId={DEFAULT_SETTINGS_SECTION} overlaid={false} />
  );
}
